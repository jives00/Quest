import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../db';
import {
  searchGames as igdbSearch,
  getGameById as igdbGetById,
  coverUrl,
  IgdbGame,
} from './igdb.client';
import { upsertGameFromIgdb, deriveSortTitle, setHeroArt } from './matching.service';
import {
  searchGame as sgdbSearch,
  getGrid as sgdbGetGrid,
  getHeroArt as sgdbGetHero,
  isSteamGridDbEnabled,
} from './steamgriddb.client';
import { searchGames as rawgSearch, isRawgEnabled } from './rawg.client';
import { fetchAppDetails, fetchReviewSummary } from './steam-store.client';
import { getSteamDbAchievementGroups, getGameAchievementsV1, getPlayerAchievements } from './steam.client';
import { searchHltb, isHltbEnabled } from './hltb.client';
import { lookupGameId, getPriceOverview, isItadEnabled } from './itad.client';
export { isItadEnabled } from './itad.client';

// ---------------------------------------------------------------------------
// IGDB search — returns normalized list, does NOT persist
// ---------------------------------------------------------------------------

export interface GameSearchResult {
  igdbId: number;
  name: string;
  year: number | null;
  coverUrl: string | null;
  platforms: string[];
}

export async function searchIgdbGames(query: string): Promise<GameSearchResult[]> {
  const results = await igdbSearch(query, { limit: 30 });
  return results.map((g: IgdbGame) => ({
    igdbId: g.id,
    name: g.name,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
    coverUrl: g.cover ? coverUrl(g.cover.image_id) : null,
    platforms: g.platforms?.map(p => p.name) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Materialize a game from IGDB (POST /games body { igdbId })
// ---------------------------------------------------------------------------

export async function materializeGame(igdbId: number): Promise<number> {
  const g = await igdbGetById(igdbId);
  if (!g) throw new Error(`IGDB game ${igdbId} not found`);
  const gameId = await upsertGameFromIgdb(g);
  await setHeroArt(gameId, g.name);
  return gameId;
}

// ---------------------------------------------------------------------------
// Game detail aggregate
// ---------------------------------------------------------------------------

export interface GameDetail {
  id: number;
  igdbId: number | null;
  matchStatus: string;
  title: string;
  sortTitle: string | null;
  firstReleaseDate: string | null;
  summary: string | null;
  genres: string[];
  tags: string[];
  platforms: string[];
  coverPath: string | null;
  heroPath: string | null;
  hltbMainHours: number | null;
  hltbMainExtraHours: number | null;
  hltbCompletionistHours: number | null;
  metacritic: number | null;
  playtime: Array<{ source: string; totalMin: number }>;
  lifetimeMin: number;
  sessions: Array<{
    id: number;
    source: string;
    startedAt: string;
    endedAt: string;
    durationMin: number;
    derived: boolean;
  }>;
  achievements: Array<{
    apiName: string;
    name: string;
    icon: string | null;
    unlockedAt: string | null;
  }>;
  achievementTotal: number;
  achievementEarned: number;
  status: string | null;
  rating: number | null;
  notes: string | null;
  ownership: string[];
  lists: number[];
  // --- Enrichment fields ---
  steamAppId: string | null;
  controllerSupport: 'none' | 'partial' | 'full' | null;
  steamReviewDesc: string | null;
  steamReviewPct: number | null;
  steamReviewCount: number | null;
  metacriticUrl: string | null;
  hidden: boolean;
  inWishlist: boolean;
  itadEnabled: boolean;
  vrSupported: boolean;
}

/** mysql2 auto-parses JSON columns into JS arrays; guard against double-parsing. */
function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === 'string' && val.length) {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function getGameDetail(userId: number, gameId: number): Promise<GameDetail | null> {
  const pool = getPool();

  // Core game row (including enrichment columns)
  const [gameRows] = await pool.query<RowDataPacket[]>(
    `SELECT g.id, g.igdb_id, g.match_status, g.title, g.sort_title, g.first_release_date,
            g.summary, g.genres, g.tags, g.platforms, g.cover_path, g.hero_path,
            g.hltb_main_hours, g.hltb_main_extra_hours, g.hltb_completionist_hours, g.metacritic,
            g.steam_review_desc, g.steam_review_pct, g.steam_review_count,
            g.controller_support, g.metacritic_url, g.vr_supported,
            (SELECT e.external_id FROM external_game_ids e
               WHERE e.game_id = g.id AND e.source = 'steam_appid' LIMIT 1) AS steam_app_id,
            EXISTS (SELECT 1 FROM hidden_games h
                    WHERE h.user_id = ? AND h.game_id = g.id) AS is_hidden
       FROM games g WHERE g.id = ?`,
    [userId, gameId],
  );
  if (!gameRows.length) return null;
  const g = gameRows[0];

  // Playtime totals per source
  const [ptRows] = await pool.query<RowDataPacket[]>(
    `SELECT source, total_minutes, last_synced_at
       FROM playtime_totals WHERE user_id = ? AND game_id = ?`,
    [userId, gameId],
  );
  const playtime = ptRows.map(r => ({
    source: r.source as string,
    totalMin: r.total_minutes as number,
  }));

  // Sessions (most recent first)
  const [sessRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, source, started_at, ended_at, duration_min, derived
       FROM play_sessions
      WHERE user_id = ? AND game_id = ?
      ORDER BY started_at DESC
      LIMIT 100`,
    [userId, gameId],
  );
  const sessions = sessRows.map(r => ({
    id: r.id as number,
    source: r.source as string,
    startedAt: r.started_at as string,
    endedAt: r.ended_at as string,
    durationMin: r.duration_min as number,
    derived: Boolean(r.derived),
  }));

  // Achievements — prefer steam > psn > any other source when multiple exist
  const [achRows] = await pool.query<RowDataPacket[]>(
    `SELECT a.api_name, a.name, a.description, a.is_hidden, a.icon,
            a.global_pct, a.dlc_app_id, a.dlc_app_name, ua.unlocked_at
       FROM achievements a
       LEFT JOIN user_achievements ua
         ON ua.game_id = a.game_id AND ua.api_name = a.api_name AND ua.user_id = ?
      WHERE a.game_id = ?
        AND a.source = COALESCE(
          (SELECT 'steam' FROM achievements WHERE game_id = ? AND source = 'steam' LIMIT 1),
          (SELECT 'psn'   FROM achievements WHERE game_id = ? AND source = 'psn'   LIMIT 1),
          (SELECT source  FROM achievements WHERE game_id = ?                       LIMIT 1)
        )
      ORDER BY (ua.unlocked_at IS NOT NULL) DESC, a.name`,
    [userId, gameId, gameId, gameId, gameId],
  );
  const achievements = achRows.map(r => ({
    apiName: r.api_name as string,
    name: r.name as string,
    description: r.description as string | null,
    isHidden: Boolean(r.is_hidden),
    icon: r.icon as string | null,
    globalPct: r.global_pct != null ? Number(r.global_pct) : null,
    dlcAppId: r.dlc_app_id as number | null,
    dlcAppName: r.dlc_app_name as string | null,
    unlockedAt: r.unlocked_at as string | null,
  }));
  const achievementTotal = achievements.length;
  const achievementEarned = achievements.filter(a => a.unlockedAt).length;

  // Game status
  const [statusRows] = await pool.query<RowDataPacket[]>(
    `SELECT status FROM game_status WHERE user_id = ? AND game_id = ?`,
    [userId, gameId],
  );
  const status = statusRows.length ? (statusRows[0].status as string) : null;

  // Rating
  const [ratingRows] = await pool.query<RowDataPacket[]>(
    `SELECT rating FROM ratings WHERE user_id = ? AND game_id = ?`,
    [userId, gameId],
  );
  const rating = ratingRows.length ? (ratingRows[0].rating as number) : null;

  // Notes
  const [noteRows] = await pool.query<RowDataPacket[]>(
    `SELECT body FROM notes WHERE user_id = ? AND game_id = ?`,
    [userId, gameId],
  );
  const notes = noteRows.length ? (noteRows[0].body as string) : null;

  // Ownership
  const [ownRows] = await pool.query<RowDataPacket[]>(
    `SELECT platform, acquired_at FROM ownership WHERE user_id = ? AND game_id = ?`,
    [userId, gameId],
  );
  const ownership = ownRows.map(r => r.platform as string);

  // List membership (system + custom via list_items; platform lists derived from ownership)
  const [listRows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, l.name, l.slug, l.kind
       FROM lists l
       JOIN list_items li ON li.list_id = l.id
      WHERE l.user_id = ? AND li.game_id = ?`,
    [userId, gameId],
  );
  // Per-platform lists are derived — check ownership
  const [platformListRows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, l.name, l.slug, l.kind
       FROM lists l
       JOIN ownership o ON o.platform = l.platform AND o.user_id = l.user_id
      WHERE l.user_id = ? AND o.game_id = ? AND l.kind = 'platform'`,
    [userId, gameId],
  );
  const lists = [
    ...listRows.map(r => r.id as number),
    ...platformListRows.map(r => r.id as number),
  ];

  // Determine wishlist membership from system list with slug 'wishlist'
  const [wishlistRows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id FROM lists l
      JOIN list_items li ON li.list_id = l.id
     WHERE l.user_id = ? AND l.slug = 'wishlist' AND li.game_id = ?
     LIMIT 1`,
    [userId, gameId],
  );
  const inWishlist = wishlistRows.length > 0;

  return {
    id: g.id as number,
    igdbId: g.igdb_id as number | null,
    matchStatus: g.match_status as string,
    title: g.title as string,
    sortTitle: g.sort_title as string | null,
    firstReleaseDate: g.first_release_date as string | null,
    summary: g.summary as string | null,
    genres: toStringArray(g.genres),
    tags: toStringArray(g.tags),
    platforms: toStringArray(g.platforms),
    coverPath: g.cover_path as string | null,
    heroPath: g.hero_path as string | null,
    hltbMainHours: g.hltb_main_hours != null ? Number(g.hltb_main_hours) : null,
    hltbMainExtraHours: g.hltb_main_extra_hours != null ? Number(g.hltb_main_extra_hours) : null,
    hltbCompletionistHours: g.hltb_completionist_hours != null ? Number(g.hltb_completionist_hours) : null,
    metacritic: g.metacritic != null ? Number(g.metacritic) : null,
    playtime,
    lifetimeMin: 0,
    sessions,
    achievements,
    achievementTotal,
    achievementEarned,
    status,
    rating,
    notes,
    ownership,
    lists,
    // enrichment
    steamAppId: (g.steam_app_id as string | null) ?? null,
    controllerSupport: (g.controller_support as 'none' | 'partial' | 'full' | null) ?? null,
    steamReviewDesc: (g.steam_review_desc as string | null) ?? null,
    steamReviewPct: g.steam_review_pct != null ? Number(g.steam_review_pct) : null,
    steamReviewCount: g.steam_review_count != null ? Number(g.steam_review_count) : null,
    metacriticUrl: (g.metacritic_url as string | null) ?? null,
    hidden: Boolean(g.is_hidden),
    inWishlist,
    itadEnabled: isItadEnabled(),
    vrSupported: Boolean(g.vr_supported),
  };
}

// ---------------------------------------------------------------------------
// Manual metadata editing
// ---------------------------------------------------------------------------

export interface GameMetadataPatch {
  title?: string;
  sortTitle?: string | null;
  summary?: string | null;
  coverPath?: string | null;
  heroPath?: string | null;
  firstReleaseDate?: string | null; // YYYY-MM-DD
  metacritic?: number | null;
  hltbMainHours?: number | null;
  hltbMainExtraHours?: number | null;
  hltbCompletionistHours?: number | null;
  genres?: string[];
  tags?: string[];
}

/**
 * Apply a user's manual metadata edits to a game row. Only the provided fields
 * are touched. Editing always flips match_status to 'manual' so the daily
 * backfill sweep (which only re-resolves 'provisional' rows) never clobbers the
 * user's edits. Returns true if the row existed.
 */
export async function updateGameMetadata(
  gameId: number,
  patch: GameMetadataPatch,
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title === '') throw new Error('title cannot be empty');
    sets.push('title = ?');
    params.push(title);
    // Auto-derive sort_title from new title only when not explicitly provided
    if (patch.sortTitle === undefined) {
      sets.push('sort_title = ?');
      params.push(deriveSortTitle(title));
    }
  }
  if (patch.sortTitle !== undefined) {
    const st = patch.sortTitle === null ? null : patch.sortTitle.trim() || null;
    sets.push('sort_title = ?');
    params.push(st);
  }
  if (patch.summary !== undefined) {
    sets.push('summary = ?');
    params.push(patch.summary === null ? null : String(patch.summary));
  }
  if (patch.coverPath !== undefined) {
    sets.push('cover_path = ?');
    params.push(patch.coverPath || null);
  }
  if (patch.heroPath !== undefined) {
    sets.push('hero_path = ?');
    params.push(patch.heroPath || null);
  }
  if (patch.firstReleaseDate !== undefined) {
    sets.push('first_release_date = ?');
    params.push(patch.firstReleaseDate || null);
  }
  if (patch.metacritic !== undefined) {
    sets.push('metacritic = ?');
    params.push(patch.metacritic == null ? null : Math.max(0, Math.min(100, Math.round(patch.metacritic))));
  }
  if (patch.hltbMainHours !== undefined) {
    sets.push('hltb_main_hours = ?');
    params.push(patch.hltbMainHours == null ? null : Number(patch.hltbMainHours));
  }
  if (patch.hltbMainExtraHours !== undefined) {
    sets.push('hltb_main_extra_hours = ?');
    params.push(patch.hltbMainExtraHours == null ? null : Number(patch.hltbMainExtraHours));
  }
  if (patch.hltbCompletionistHours !== undefined) {
    sets.push('hltb_completionist_hours = ?');
    params.push(patch.hltbCompletionistHours == null ? null : Number(patch.hltbCompletionistHours));
  }
  if (patch.genres !== undefined) {
    sets.push('genres = CAST(? AS JSON)');
    params.push(JSON.stringify(patch.genres.map(s => s.trim()).filter(Boolean)));
  }
  if (patch.tags !== undefined) {
    sets.push('tags = CAST(? AS JSON)');
    params.push(JSON.stringify(patch.tags.map(s => s.trim()).filter(Boolean)));
  }

  if (sets.length === 0) return true; // nothing to change

  // Lock the row to the user's edits so the backfill sweep leaves it alone.
  sets.push("match_status = 'manual'");

  params.push(gameId);
  const [res] = await getPool().query<ResultSetHeader>(
    `UPDATE games SET ${sets.join(', ')} WHERE id = ?`,
    params,
  );
  return res.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// Artwork candidates (for the metadata editor's image picker)
// ---------------------------------------------------------------------------

export interface ArtworkCandidates {
  grids: string[]; // portrait box-art (cover) options
  heroes: string[]; // wide landscape (hero banner) options
}

/**
 * Gather candidate artwork for a title. Grids/heroes come from SteamGridDB
 * (community art, ranked by score); RAWG's background_image is added as a hero
 * option. All sources degrade to empty when their API key is absent.
 */
export async function getArtworkCandidates(query: string): Promise<ArtworkCandidates> {
  const grids: string[] = [];
  const heroes: string[] = [];

  if (isSteamGridDbEnabled()) {
    try {
      const game = await sgdbSearch(query);
      if (game) {
        const [gridImgs, heroImgs] = await Promise.all([
          sgdbGetGrid(game.id),
          sgdbGetHero(game.id),
        ]);
        if (gridImgs) {
          grids.push(...[...gridImgs].sort((a, b) => b.score - a.score).slice(0, 24).map(i => i.url));
        }
        if (heroImgs) {
          heroes.push(...[...heroImgs].sort((a, b) => b.score - a.score).slice(0, 24).map(i => i.url));
        }
      }
    } catch (err) {
      console.error('SteamGridDB artwork lookup failed:', err);
    }
  }

  if (isRawgEnabled()) {
    try {
      const rawg = await rawgSearch(query, 5);
      // Only use the first result — results 2-5 are often wrong games that pollute hero options
      const best = rawg[0];
      if (best?.background_image && !heroes.includes(best.background_image)) {
        heroes.push(best.background_image);
      }
    } catch (err) {
      console.error('RAWG artwork lookup failed:', err);
    }
  }

  return { grids, heroes };
}

/** Look up a game's current title (used to seed artwork search). */
export async function getGameTitle(gameId: number): Promise<string | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT title FROM games WHERE id = ?`,
    [gameId],
  );
  return rows.length ? (rows[0].title as string) : null;
}

/** Permanently delete a game row (all user data cascades via FK). Returns true if a row was deleted.
 *  Snapshots the game's external IDs into ignored_external_ids first so sync pollers
 *  never re-import the game on the next run. */
export async function deleteGame(gameId: number): Promise<boolean> {
  const pool = getPool();

  // Collect external IDs before the cascade wipes them.
  const [extRows] = await pool.query<RowDataPacket[]>(
    `SELECT source, external_id FROM external_game_ids WHERE game_id = ?`,
    [gameId],
  );
  for (const row of extRows) {
    await pool.query(
      `INSERT IGNORE INTO ignored_external_ids (source, external_id) VALUES (?, ?)`,
      [row.source, row.external_id],
    );
  }

  const [res] = await pool.query<ResultSetHeader>(
    `DELETE FROM games WHERE id = ?`,
    [gameId],
  );
  return res.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// Enrichment — fetch Steam store data and optionally HLTB
// ---------------------------------------------------------------------------

/**
 * Enrich a game from external sources (Steam store + HLTB when enabled).
 * Never overwrites fields that were manually set (match_status = 'manual').
 * Returns true if the game was found and enrichment was attempted.
 */
export async function enrichGame(gameId: number, userId?: number): Promise<boolean> {
  const pool = getPool();

  // Look up the Steam app ID and current game state
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT g.title, g.match_status, g.metacritic, g.hltb_main_hours,
            g.hltb_main_extra_hours, g.hltb_completionist_hours,
            g.igdb_id, g.first_release_date, g.vr_manual,
            (SELECT e.external_id FROM external_game_ids e
               WHERE e.game_id = g.id AND e.source = 'steam_appid' LIMIT 1) AS steam_app_id
       FROM games g WHERE g.id = ?`,
    [gameId],
  );
  if (!rows.length) return false;

  const row = rows[0];
  const steamAppId = row.steam_app_id as string | null;
  const title = row.title as string;
  const isManual = row.match_status === 'manual';
  const vrManual = Boolean(row.vr_manual);
  const igdbId = row.igdb_id as number | null;
  const currentReleaseDate = row.first_release_date as string | null;

  const sets: string[] = [];
  const params: unknown[] = [];

  // Re-fetch release date from IGDB when it's unknown or still in the future
  if (igdbId && (!currentReleaseDate || new Date(currentReleaseDate) > new Date())) {
    try {
      const igdbGame = await igdbGetById(igdbId);
      if (igdbGame?.first_release_date) {
        const dateStr = new Date(igdbGame.first_release_date * 1000).toISOString().slice(0, 10);
        if (dateStr !== currentReleaseDate) {
          sets.push('first_release_date = ?');
          params.push(dateStr);
        }
      }
    } catch (err) {
      console.error('IGDB release date refresh failed:', err);
    }
  }

  if (steamAppId) {
    // Fetch both in parallel
    const [details, reviews] = await Promise.all([
      fetchAppDetails(steamAppId),
      fetchReviewSummary(steamAppId),
    ]);

    if (details) {
      if (details.controllerSupport !== null) {
        sets.push('controller_support = ?');
        params.push(details.controllerSupport);
      }
      // Only set Metacritic if not manually set
      if (!isManual && details.metacritic !== null && row.metacritic == null) {
        sets.push('metacritic = ?');
        params.push(details.metacritic);
      }
      if (details.metacriticUrl !== null) {
        sets.push('metacritic_url = ?');
        params.push(details.metacriticUrl);
      }
    }

    if (reviews) {
      sets.push('steam_review_desc = ?', 'steam_review_pct = ?', 'steam_review_count = ?');
      params.push(reviews.desc, reviews.pct, reviews.count);
    }

    if (!vrManual && details?.vrSupported) {
      sets.push('vr_supported = 1');
    }
  }

  // HLTB — only when enabled and main hours not yet set (or not manually set)
  if (isHltbEnabled() && (!isManual || row.hltb_main_hours == null)) {
    try {
      const hltb = await searchHltb(title);
      if (hltb) {
        if (hltb.mainStoryHours !== null && row.hltb_main_hours == null) {
          sets.push('hltb_main_hours = ?');
          params.push(hltb.mainStoryHours);
        }
        if (hltb.mainExtraHours !== null && row.hltb_main_extra_hours == null) {
          sets.push('hltb_main_extra_hours = ?');
          params.push(hltb.mainExtraHours);
        }
        if (hltb.completionistHours !== null && row.hltb_completionist_hours == null) {
          sets.push('hltb_completionist_hours = ?');
          params.push(hltb.completionistHours);
        }
      }
    } catch (err) {
      console.error('HLTB enrichment failed:', err);
    }
  }

  sets.push('store_fetched_at = NOW()');

  params.push(gameId);
  await pool.query<ResultSetHeader>(
    `UPDATE games SET ${sets.join(', ')} WHERE id = ?`,
    params,
  );

  // Achievement metadata + DLC grouping — best-effort, only when the game has
  // a Steam ID and achievements in the DB. Each step skipped silently on failure.
  if (steamAppId) {
    try {
      const [achRows] = await pool.query<RowDataPacket[]>(
        `SELECT api_name FROM achievements WHERE game_id = ?`,
        [gameId],
      );
      if (achRows.length > 0) {
        const appIdNum = Number(steamAppId);

        // Look up the user's Steam ID if we have a userId (for unlocked hidden achievement descriptions)
        let steamId64: string | null = null;
        if (userId) {
          const [accountRows] = await pool.query<RowDataPacket[]>(
            `SELECT steam_id64 FROM platform_accounts WHERE user_id = ? AND platform = 'steam' AND enabled = 1 LIMIT 1`,
            [userId],
          );
          steamId64 = (accountRows[0]?.steam_id64 as string | null) ?? null;
        }

        // IPlayerService/GetGameAchievements/v1 returns hidden descriptions + global % in one call
        const schema = await getGameAchievementsV1(appIdNum);
        const meta = new Map(schema.map(s => [s.apiName, s]));

        for (const row of achRows) {
          const apiName = row.api_name as string;
          const m = meta.get(apiName);
          await pool.query(
            `UPDATE achievements SET description = ?, is_hidden = ?, global_pct = ?
              WHERE game_id = ? AND api_name = ?`,
            [m?.description ?? null, m?.isHidden ? 1 : 0, m?.globalPct ?? null, gameId, apiName],
          );
        }

        // DLC grouping
        const dlcGroups = await getSteamDbAchievementGroups(appIdNum);
        for (const group of dlcGroups) {
          if (!group.dlcAppId || group.achievementApiNames.length === 0) continue;
          const placeholders = group.achievementApiNames.map(() => '?').join(', ');
          await pool.query(
            `UPDATE achievements SET dlc_app_id = ?, dlc_app_name = ?
              WHERE game_id = ? AND api_name IN (${placeholders})`,
            [group.dlcAppId, group.dlcAppName, gameId, ...group.achievementApiNames],
          );
        }
      }
    } catch (err) {
      console.error(`Achievement enrichment failed for game ${gameId}:`, err);
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Manual / HLTB playtime
// ---------------------------------------------------------------------------

/**
 * Auto-populate a game's playtime from HLTB when a completion is recorded.
 * Only fires when the game has no existing tracked playtime (any source other than 'hltb').
 * Uses the already-stored hltb_main_hours — won't make a live HLTB request.
 */
export async function maybePopulateHltbPlaytime(userId: number, gameId: number): Promise<void> {
  const pool = getPool();

  // Check if any real tracked playtime already exists (ignore prior hltb rows)
  const [[sumRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(total_minutes), 0) AS m
       FROM playtime_totals
      WHERE user_id = ? AND game_id = ? AND source != 'hltb' AND source != 'manual'`,
    [userId, gameId],
  );
  if (Number(sumRow.m) > 0) return;

  // Also skip if a manual entry already exists
  const [[manualRow]] = await pool.query<RowDataPacket[]>(
    `SELECT total_minutes FROM playtime_totals
      WHERE user_id = ? AND game_id = ? AND source = 'manual' LIMIT 1`,
    [userId, gameId],
  );
  if (manualRow) return;

  const [[gameRow]] = await pool.query<RowDataPacket[]>(
    `SELECT hltb_main_hours FROM games WHERE id = ?`,
    [gameId],
  );
  const hours = gameRow?.hltb_main_hours != null ? Number(gameRow.hltb_main_hours) : null;
  if (!hours || hours <= 0) return;

  const minutes = Math.round(hours * 60);
  await pool.query(
    `INSERT INTO playtime_totals (user_id, game_id, source, total_minutes, last_synced_at)
     VALUES (?, ?, 'hltb', ?, NOW())
     ON DUPLICATE KEY UPDATE total_minutes = VALUES(total_minutes), last_synced_at = NOW()`,
    [userId, gameId, minutes],
  );
}

/**
 * Set or clear a user's manual playtime entry for a game.
 * Setting manual time removes any 'hltb' auto-estimate so they don't double-count.
 * Passing null clears the manual entry (and re-exposes any hltb estimate if present).
 */
export async function setManualPlaytime(
  userId: number,
  gameId: number,
  minutes: number | null,
): Promise<void> {
  const pool = getPool();
  if (minutes === null) {
    await pool.query(
      `DELETE FROM playtime_totals WHERE user_id = ? AND game_id = ? AND source = 'manual'`,
      [userId, gameId],
    );
    return;
  }
  const clamped = Math.max(0, Math.round(minutes));
  // Remove hltb estimate since user is providing their own value
  await pool.query(
    `DELETE FROM playtime_totals WHERE user_id = ? AND game_id = ? AND source = 'hltb'`,
    [userId, gameId],
  );
  await pool.query(
    `INSERT INTO playtime_totals (user_id, game_id, source, total_minutes, last_synced_at)
     VALUES (?, ?, 'manual', ?, NOW())
     ON DUPLICATE KEY UPDATE total_minutes = VALUES(total_minutes), last_synced_at = NOW()`,
    [userId, gameId, clamped],
  );
}

// ---------------------------------------------------------------------------
// Hidden games
// ---------------------------------------------------------------------------

/**
 * Hide or unhide a game for the given user.
 */
export async function setHidden(userId: number, gameId: number, hidden: boolean): Promise<void> {
  const pool = getPool();
  if (hidden) {
    await pool.query(
      `INSERT IGNORE INTO hidden_games (user_id, game_id) VALUES (?, ?)`,
      [userId, gameId],
    );
  } else {
    await pool.query(
      `DELETE FROM hidden_games WHERE user_id = ? AND game_id = ?`,
      [userId, gameId],
    );
  }
}

// ---------------------------------------------------------------------------
// VR flag (manual override)
// ---------------------------------------------------------------------------

/** Set or clear the VR flag for a game. Sets vr_manual=1 so syncs don't overwrite. */
export async function setVr(gameId: number, vr: boolean): Promise<void> {
  await getPool().query(
    `UPDATE games SET vr_supported = ?, vr_manual = 1 WHERE id = ?`,
    [vr ? 1 : 0, gameId],
  );
}

// ---------------------------------------------------------------------------
// Wishlist price (ITAD)
// ---------------------------------------------------------------------------

export interface WishlistPrice {
  current: { price: number; shop: string; url: string } | null;
  lowest: { price: number } | null;
}

/**
 * Return current and historical low price for a wishlist game via ITAD.
 * Returns null when ITAD is disabled or lookup fails.
 */
export async function getWishlistPrice(
  gameId: number,
  country = 'US',
): Promise<WishlistPrice | null> {
  if (!isItadEnabled()) return null;

  const pool = getPool();

  // Look up steam appid and title
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT g.title,
            (SELECT e.external_id FROM external_game_ids e
               WHERE e.game_id = g.id AND e.source = 'steam_appid' LIMIT 1) AS steam_app_id
       FROM games g WHERE g.id = ?`,
    [gameId],
  );
  if (!rows.length) return null;

  const { title, steam_app_id: appid } = rows[0] as { title: string; steam_app_id: string | null };

  const itadId = await lookupGameId({ appid: appid ?? undefined, title });
  if (!itadId) return null;

  const overview = await getPriceOverview(itadId, country);
  return overview;
}
