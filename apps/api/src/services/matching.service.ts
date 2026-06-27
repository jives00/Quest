import { RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';
import { getPool } from '../db';
import {
  searchGames as igdbSearch,
  getGameById as igdbGetById,
  coverUrl,
  IgdbGame,
} from './igdb.client';
import { searchGames as rawgSearch, isRawgEnabled } from './rawg.client';
import { getBestHeroUrl, isSteamGridDbEnabled } from './steamgriddb.client';

// ---------------------------------------------------------------------------
// Confidence threshold — the SINGLE source of truth governing every match
// decision: live-poller auto-match, provisional-sweep auto-promote, and
// cross-platform duplicate detection. Dice-coefficient similarity in [0,1].
// ---------------------------------------------------------------------------
export const MATCH_CONFIDENCE_THRESHOLD = 0.85;

export type ExternalSource =
  | 'igdb'
  | 'steam_appid'
  | 'psn_concept'
  | 'rawg'
  | 'xbox'
  | 'epic'
  | 'gog'
  | 'meta_quest';
export type { Platform } from '../platforms';

export interface ResolveInput {
  source: Exclude<ExternalSource, 'igdb'>; // platform id being resolved
  externalId: string;
  title: string; // platform-reported title (fallback for provisional rows)
  platformId?: number; // IGDB platform id filter (6 = PC, 167 = PS5)
}

export interface ResolveResult {
  gameId: number;
  matchStatus: 'matched' | 'provisional' | 'manual';
  created: boolean;
}

// ---------------------------------------------------------------------------
// Title normalization + fuzzy similarity (dependency-free)
// ---------------------------------------------------------------------------

/** Light normalization for comparing two titles. Conservative: keeps words like
 *  "remastered"/"remake" so editions stay distinguishable for merge review. */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EDITION_NOISE =
  /\b(goty|game of the year|deluxe|definitive|ultimate|complete|standard|gold|premium|enhanced|special|collectors?|anniversary|edition|bundle|pack|remaster(ed)?)\b/g;

/** Heavier normalization used only when building an IGDB/RAWG search query from a
 *  noisy storefront title (strips edition/marketing words to find the base game). */
function normalizeForSearch(raw: string): string {
  return normalizeTitle(raw).replace(EDITION_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

function bigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    map.set(bg, (map.get(bg) ?? 0) + 1);
  }
  return map;
}

/** Sørensen–Dice coefficient over character bigrams. Returns [0,1]. */
export function similarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const ba = bigrams(na);
  const bb = bigrams(nb);
  let intersection = 0;
  for (const [bg, count] of ba) {
    const other = bb.get(bg);
    if (other) intersection += Math.min(count, other);
  }
  const total = na.length - 1 + (nb.length - 1);
  return (2 * intersection) / total;
}

/** Score IGDB/RAWG candidates against a query; return best with its score. */
function bestMatch<T extends { name: string }>(
  query: string,
  candidates: T[],
): { candidate: T; score: number } | null {
  let best: { candidate: T; score: number } | null = null;
  for (const c of candidates) {
    const score = similarity(query, c.name);
    if (!best || score > best.score) best = { candidate: c, score };
  }
  return best;
}

// ---------------------------------------------------------------------------
// VR platform detection
// ---------------------------------------------------------------------------

const VR_PLATFORM_NAMES = new Set([
  'SteamVR', 'PlayStation VR', 'PlayStation VR2',
  'Oculus Quest', 'Oculus Rift', 'Oculus Go',
  'Meta Quest 2', 'Meta Quest 3',
  'HTC Vive', 'Windows Mixed Reality', 'Valve Index',
  'Gear VR', 'Google Cardboard', 'Daydream', 'Pico',
]);

function detectVrFromPlatforms(platforms?: Array<{ name: string }>): boolean {
  return platforms?.some(p => VR_PLATFORM_NAMES.has(p.name)) ?? false;
}

// ---------------------------------------------------------------------------
// Game row writers
// ---------------------------------------------------------------------------

function igdbDateToSql(unix?: number): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString().slice(0, 10); // YYYY-MM-DD
}

export function deriveSortTitle(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, '').trim();
}

/** Upsert a canonical game from full IGDB metadata. Returns the games.id.
 *  cover_path stores the IGDB CDN URL directly (no local file management in v1). */
export async function upsertGameFromIgdb(g: IgdbGame): Promise<number> {
  const pool = getPool();
  const genres = g.genres?.map(x => x.name) ?? [];
  const platforms = g.platforms?.map(x => x.name) ?? [];
  const metacritic =
    g.aggregated_rating != null ? Math.round(g.aggregated_rating) : null;
  const cover = g.cover ? coverUrl(g.cover.image_id) : null;

  const vrSupported = detectVrFromPlatforms(g.platforms) ? 1 : 0;

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO games
       (igdb_id, match_status, title, sort_title, first_release_date, summary,
        genres, platforms, cover_path, metacritic, vr_supported, metadata_fetched_at)
     VALUES (?, 'matched', ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       match_status = IF(match_status = 'manual', 'manual', 'matched'),
       title = VALUES(title),
       sort_title = VALUES(sort_title),
       first_release_date = VALUES(first_release_date),
       summary = VALUES(summary),
       genres = VALUES(genres),
       platforms = VALUES(platforms),
       cover_path = COALESCE(VALUES(cover_path), cover_path),
       metacritic = COALESCE(VALUES(metacritic), metacritic),
       vr_supported = IF(vr_manual = 1, vr_supported, VALUES(vr_supported)),
       metadata_fetched_at = NOW(),
       id = LAST_INSERT_ID(id)`,
    [
      g.id,
      g.name,
      deriveSortTitle(g.name),
      igdbDateToSql(g.first_release_date),
      g.summary ?? null,
      JSON.stringify(genres),
      JSON.stringify(platforms),
      cover,
      metacritic,
      vrSupported,
    ],
  );
  const gameId = res.insertId;
  // Ensure the igdb external mapping exists too.
  await attachExternalId(gameId, 'igdb', String(g.id));
  return gameId;
}

/** Create a provisional (unmatched) game row from a storefront title. */
async function createProvisionalGame(title: string): Promise<number> {
  const pool = getPool();
  const sortTitle = deriveSortTitle(title);
  // Reuse an existing provisional row with the same normalized title so the several
  // platform ids one game can have (multiple Xbox titleIds, PS4+PS5 editions, etc.)
  // that all fail to match IGDB collapse onto ONE provisional row instead of spawning
  // a duplicate per id. Matched rows already dedup via the igdb_id UNIQUE constraint;
  // this gives provisional rows the equivalent guard.
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM games WHERE match_status = 'provisional' AND sort_title = ? LIMIT 1`,
    [sortTitle],
  );
  if (existing.length) return existing[0].id as number;

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO games (match_status, title, sort_title) VALUES ('provisional', ?, ?)`,
    [title, sortTitle],
  );
  return res.insertId;
}

export async function attachExternalId(
  gameId: number,
  source: ExternalSource,
  externalId: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT IGNORE INTO external_game_ids (game_id, source, external_id) VALUES (?, ?, ?)`,
    [gameId, source, externalId],
  );
}

async function findGameByExternalId(
  source: ExternalSource,
  externalId: string,
): Promise<number | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT game_id FROM external_game_ids WHERE source = ? AND external_id = ? LIMIT 1`,
    [source, externalId],
  );
  return rows.length ? (rows[0].game_id as number) : null;
}

// ---------------------------------------------------------------------------
// Core resolve flow
// ---------------------------------------------------------------------------

/** Find an IGDB game for a title via IGDB search, RAWG fallback for the query.
 *  Returns the chosen IGDB game + confidence, or null if nothing crosses noise. */
async function searchBestIgdb(
  title: string,
  platformId?: number,
): Promise<{ game: IgdbGame; score: number } | null> {
  const query = normalizeForSearch(title) || title;

  const igdbResults = await igdbSearch(query, { platformId, limit: 10 });
  const igdbBest = bestMatch(query, igdbResults);
  if (igdbBest && igdbBest.score >= MATCH_CONFIDENCE_THRESHOLD) {
    return { game: igdbBest.candidate, score: igdbBest.score };
  }

  // RAWG fallback: use RAWG only as a name-resolution aid. If RAWG returns a
  // strong name, re-query IGDB with that cleaner name to obtain a canonical row.
  if (isRawgEnabled()) {
    try {
      const rawgResults = await rawgSearch(query);
      const rawgBest = bestMatch(query, rawgResults.map(r => ({ name: r.name })));
      if (rawgBest && rawgBest.score >= MATCH_CONFIDENCE_THRESHOLD) {
        const reIgdb = await igdbSearch(rawgBest.candidate.name, { platformId, limit: 10 });
        const reBest = bestMatch(rawgBest.candidate.name, reIgdb);
        if (reBest && reBest.score >= MATCH_CONFIDENCE_THRESHOLD) {
          return { game: reBest.candidate, score: reBest.score };
        }
      }
    } catch (err) {
      console.error('RAWG fallback failed:', err);
    }
  }

  // Return the best IGDB candidate even if below threshold, so callers can log it.
  if (igdbBest) return { game: igdbBest.candidate, score: igdbBest.score };
  return null;
}

/**
 * Resolve a platform id (steam appid / psn concept) to a canonical games row.
 * 1. ignored_external_ids check → null (caller must skip this game).
 * 2. external_game_ids lookup → hit returns the game.
 * 3. miss → IGDB (+RAWG) search; if confidence ≥ threshold, upsert matched game.
 * 4. else → create a provisional row from the storefront title (playtime is
 *    never dropped) and flag it (match_status='provisional') for manual review.
 */
export async function resolveExternalId(input: ResolveInput): Promise<ResolveResult | null> {
  const pool = getPool();
  const [ignored] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM ignored_external_ids WHERE source = ? AND external_id = ? LIMIT 1`,
    [input.source, input.externalId],
  );
  if (ignored.length) return null;

  const existing = await findGameByExternalId(input.source, input.externalId);
  if (existing) {
    return { gameId: existing, matchStatus: await getMatchStatus(existing), created: false };
  }

  let chosen: { game: IgdbGame; score: number } | null = null;
  try {
    chosen = await searchBestIgdb(input.title, input.platformId);
  } catch (err) {
    console.error(`Matching: IGDB search failed for "${input.title}":`, err);
  }

  if (chosen && chosen.score >= MATCH_CONFIDENCE_THRESHOLD) {
    const gameId = await upsertGameFromIgdb(chosen.game);
    await attachExternalId(gameId, input.source, input.externalId);
    await setHeroArt(gameId, chosen.game.name);
    return { gameId, matchStatus: 'matched', created: true };
  }

  // Provisional fallback — capture playtime now, resolve later via sweep/UI.
  const gameId = await createProvisionalGame(input.title);
  await attachExternalId(gameId, input.source, input.externalId);
  await setHeroArt(gameId, input.title);
  if (chosen) {
    console.log(
      `Matching: "${input.title}" → provisional (best IGDB "${chosen.game.name}" score ${chosen.score.toFixed(2)} < ${MATCH_CONFIDENCE_THRESHOLD})`,
    );
  } else {
    console.log(`Matching: "${input.title}" → provisional (no IGDB candidate)`);
  }
  return { gameId, matchStatus: 'provisional', created: true };
}

/**
 * Best-effort hero banner from SteamGridDB for a game. `force` overwrites an existing
 * hero (used by Fix Match / rematch, where the game's identity just changed so the old
 * banner is stale); otherwise it only fills when missing. Never throws — art is
 * optional and must never block matching. No-op when STEAMGRIDDB_KEY is unset.
 */
export async function setHeroArt(gameId: number, title: string, force = false): Promise<void> {
  if (!isSteamGridDbEnabled()) return;
  try {
    const pool = getPool();
    if (!force) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT hero_path FROM games WHERE id = ?`,
        [gameId],
      );
      if (rows[0]?.hero_path) return; // already has art
    }
    const hero = await getBestHeroUrl(title);
    if (hero) {
      await pool.query(`UPDATE games SET hero_path = ? WHERE id = ?`, [hero, gameId]);
    }
  } catch (err) {
    console.error(`Hero art fetch failed for game ${gameId} ("${title}"):`, err);
  }
}

async function getMatchStatus(gameId: number): Promise<ResolveResult['matchStatus']> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT match_status FROM games WHERE id = ?`,
    [gameId],
  );
  return (rows[0]?.match_status as ResolveResult['matchStatus']) ?? 'provisional';
}

// ---------------------------------------------------------------------------
// Backfill sweep — daily re-resolution of provisional rows
// ---------------------------------------------------------------------------

/** Re-run matching against every provisional game; auto-promote high-confidence
 *  hits to matched, leave the rest for manual review. Returns count promoted. */
export async function runBackfillSweep(): Promise<{ checked: number; promoted: number }> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title FROM games WHERE match_status = 'provisional'`,
  );

  let promoted = 0;
  for (const row of rows) {
    const gameId = row.id as number;
    const title = row.title as string;
    try {
      const chosen = await searchBestIgdb(title);
      if (!chosen || chosen.score < MATCH_CONFIDENCE_THRESHOLD) continue;

      // Avoid colliding with an already-matched row for the same IGDB id:
      // if one exists, merge this provisional row into it; else promote in place.
      const [dupe] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM games WHERE igdb_id = ? AND id <> ? LIMIT 1`,
        [chosen.game.id, gameId],
      );
      if (dupe.length) {
        await mergeGames(1, dupe[0].id as number, gameId, 'backfill-sweep');
      } else {
        await applyIgdbMetadata(gameId, chosen.game);
        await setHeroArt(gameId, chosen.game.name);
      }
      promoted++;
    } catch (err) {
      console.error(`Backfill sweep failed for game ${gameId} ("${title}"):`, err);
    }
  }
  return { checked: rows.length, promoted };
}

/** Apply IGDB metadata onto an existing (provisional) row, promoting it to matched. */
async function applyIgdbMetadata(gameId: number, g: IgdbGame): Promise<void> {
  const pool = getPool();
  const genres = g.genres?.map(x => x.name) ?? [];
  const platforms = g.platforms?.map(x => x.name) ?? [];
  const metacritic = g.aggregated_rating != null ? Math.round(g.aggregated_rating) : null;
  const cover = g.cover ? coverUrl(g.cover.image_id) : null;

  await pool.query(
    `UPDATE games SET
       igdb_id = ?, match_status = 'matched', title = ?, sort_title = ?,
       first_release_date = ?, summary = ?, genres = CAST(? AS JSON),
       platforms = CAST(? AS JSON), cover_path = COALESCE(?, cover_path),
       metacritic = COALESCE(?, metacritic), metadata_fetched_at = NOW()
     WHERE id = ?`,
    [
      g.id,
      g.name,
      deriveSortTitle(g.name),
      igdbDateToSql(g.first_release_date),
      g.summary ?? null,
      JSON.stringify(genres),
      JSON.stringify(platforms),
      cover,
      metacritic,
      gameId,
    ],
  );
  await attachExternalId(gameId, 'igdb', String(g.id));
}

/** Manual override from the Settings review UI: attach a chosen IGDB game to a
 *  provisional row and mark it user-confirmed ('manual'). */
export async function manualMatch(gameId: number, igdbId: number): Promise<void> {
  const g = await igdbGetById(igdbId);
  if (!g) throw new Error(`IGDB game ${igdbId} not found`);
  await applyIgdbMetadata(gameId, g);
  await getPool().query(`UPDATE games SET match_status = 'manual' WHERE id = ?`, [gameId]);
  // Fix Match changed the game's identity — refresh the hero to the corrected title.
  await setHeroArt(gameId, g.name, true);
}

/** Raised by rematchGame when the target IGDB id is already attached to a
 *  different game row (the igdb_id UNIQUE constraint would otherwise throw).
 *  The route maps this to HTTP 409. */
export class RematchConflictError extends Error {
  constructor(public existingGameId: number, igdbId: number) {
    super(
      `IGDB game ${igdbId} is already matched to game ${existingGameId}. ` +
        `Merge the two from the duplicates view instead.`,
    );
    this.name = 'RematchConflictError';
  }
}

/**
 * Re-match an already-existing game row to a (corrected) IGDB game. Unlike
 * manualMatch this is invoked from the game detail page on any row — including
 * already-matched ones — to fix a wrong auto-match. Overwrites IGDB-sourced
 * metadata, preserves user artwork/tags (applyIgdbMetadata never touches
 * hero_path/tags and only COALESCEs cover_path), and marks the row 'manual'.
 */
export async function rematchGame(gameId: number, igdbId: number): Promise<void> {
  const pool = getPool();
  const g = await igdbGetById(igdbId);
  if (!g) throw new Error(`IGDB game ${igdbId} not found`);

  const [dupe] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM games WHERE igdb_id = ? AND id <> ? LIMIT 1`,
    [igdbId, gameId],
  );
  if (dupe.length) throw new RematchConflictError(dupe[0].id as number, igdbId);

  await applyIgdbMetadata(gameId, g);
  await pool.query(`UPDATE games SET match_status = 'manual' WHERE id = ?`, [gameId]);
  // Fix Match changed the game's identity — refresh the hero to the corrected title.
  await setHeroArt(gameId, g.name, true);
}

// ---------------------------------------------------------------------------
// Cross-platform duplicate detection + merge
// ---------------------------------------------------------------------------

export interface DuplicateCandidate {
  gameA: { id: number; title: string; platforms: string[] };
  gameB: { id: number; title: string; platforms: string[] };
  score: number;
}

/** Detection-by-query: find pairs of distinct game rows the user has on
 *  DIFFERENT platforms whose titles fuzzy-match ≥ threshold (likely the same
 *  game split across Steam/PSN). Manual-confirm merge in the UI. */
export async function findDuplicateCandidates(userId: number): Promise<DuplicateCandidate[]> {
  const pool = getPool();
  // Games the user touches (owned or has playtime), with the platforms they appear on.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT g.id, g.title,
            GROUP_CONCAT(DISTINCT o.platform) AS platforms
       FROM games g
       JOIN (
         SELECT user_id, game_id, platform FROM ownership
         UNION
         SELECT user_id, game_id, source AS platform FROM playtime_totals
       ) up ON up.game_id = g.id
       LEFT JOIN ownership o ON o.game_id = g.id AND o.user_id = ?
      WHERE up.user_id = ?
      GROUP BY g.id, g.title`,
    [userId, userId],
  );

  // Load pairs the user has dismissed so we can skip them
  const [ignoredRows] = await pool.query<RowDataPacket[]>(
    `SELECT game1_id, game2_id FROM ignored_duplicates WHERE user_id = ?`,
    [userId],
  );
  const ignored = new Set(
    (ignoredRows as Array<{ game1_id: number; game2_id: number }>).map(
      r => `${Math.min(r.game1_id, r.game2_id)}-${Math.max(r.game1_id, r.game2_id)}`,
    ),
  );

  const games = rows.map(r => ({
    id: r.id as number,
    title: r.title as string,
    platforms: (r.platforms ? String(r.platforms).split(',') : []) as string[],
  }));

  const candidates: DuplicateCandidate[] = [];
  for (let i = 0; i < games.length; i++) {
    for (let j = i + 1; j < games.length; j++) {
      const a = games[i];
      const b = games[j];
      // require at least one differing platform between the two rows
      const sameSinglePlatform =
        a.platforms.length === 1 && b.platforms.length === 1 && a.platforms[0] === b.platforms[0];
      if (sameSinglePlatform) continue;
      const key = `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`;
      if (ignored.has(key)) continue;
      const score = similarity(a.title, b.title);
      if (score >= MATCH_CONFIDENCE_THRESHOLD) {
        candidates.push({ gameA: a, gameB: b, score });
      }
    }
  }
  return candidates.sort((x, y) => y.score - x.score);
}

/** Record that the user has confirmed two games are NOT duplicates. */
export async function ignoreDuplicatePair(userId: number, gameAId: number, gameBId: number): Promise<void> {
  const [g1, g2] = [Math.min(gameAId, gameBId), Math.max(gameAId, gameBId)];
  await getPool().query(
    `INSERT IGNORE INTO ignored_duplicates (user_id, game1_id, game2_id) VALUES (?, ?, ?)`,
    [userId, g1, g2],
  );
}

const MERGE_TABLES_UNIQUE_ON_GAME = [
  'playtime_totals',
  'ownership',
  'game_status',
  'ratings',
  'notes',
  'user_achievements',
  'achievements',
  'list_items',
  'now_playing',
];
const MERGE_TABLES_PLAIN = ['play_sessions', 'external_game_ids'];

/**
 * Merge loserId into winnerId: repoint all child rows to the winner, log the
 * operation, then delete the loser (FK CASCADE cleans any rows that couldn't
 * move due to a unique conflict). Always manual-confirm at the call site.
 * Pass userId 0 for system-initiated merges (e.g. backfill sweep).
 */
export async function mergeGames(
  userId: number,
  winnerId: number,
  loserId: number,
  reason = 'manual',
): Promise<void> {
  if (winnerId === loserId) throw new Error('Cannot merge a game into itself');
  const pool = getPool();
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const moved: Record<string, number> = {};

    // UPDATE IGNORE for tables with a unique constraint involving game_id —
    // rows that would collide with an existing winner row are left behind and
    // cleaned up by the cascade on delete.
    for (const table of MERGE_TABLES_UNIQUE_ON_GAME) {
      const [res] = await conn.query<ResultSetHeader>(
        `UPDATE IGNORE ${table} SET game_id = ? WHERE game_id = ?`,
        [winnerId, loserId],
      );
      moved[table] = res.affectedRows;
    }
    // Plain UPDATE for tables with no game-level unique constraint.
    for (const table of MERGE_TABLES_PLAIN) {
      const [res] = await conn.query<ResultSetHeader>(
        `UPDATE ${table} SET game_id = ? WHERE game_id = ?`,
        [winnerId, loserId],
      );
      moved[table] = res.affectedRows;
    }

    await conn.query<ResultSetHeader>(
      `INSERT INTO merge_log (user_id, winner_game_id, loser_game_id, moved)
       VALUES (?, ?, ?, CAST(? AS JSON))`,
      [userId, winnerId, loserId, JSON.stringify({ reason, ...moved })],
    );

    // Cascade removes any leftover loser child rows that couldn't be repointed.
    await conn.query(`DELETE FROM games WHERE id = ?`, [loserId]);

    await conn.commit();
    console.log(
      `Merged game ${loserId} → ${winnerId} (${reason}); moved ${JSON.stringify(moved)}`,
    );
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
