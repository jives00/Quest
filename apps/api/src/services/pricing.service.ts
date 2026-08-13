// ---------------------------------------------------------------------------
// Pricing preferences — global source priority + per-game overrides, and the
// resolver that decides which storefront a given game's price comes from.
// ---------------------------------------------------------------------------

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import { ALL_PLATFORMS, type Platform } from '../platforms';
import {
  DEFAULT_PRICE_PRIORITY,
  IMPLEMENTED_PRICE_SOURCES,
  PLATFORM_PRICE_SOURCE,
  byPriority,
  isPriceSource,
  normalizePriority,
  priceSourceFromIgdbPlatform,
  type PriceSource,
} from '../price-sources';

export interface ResolvedPriceSource {
  /** The source to price from, or null when the game maps to no known store. */
  source: PriceSource | null;
  /** Sources this game is actually available on, in priority order. */
  candidates: PriceSource[];
  /** True when a per-game override picked the source. */
  overridden: boolean;
  /** False when the chosen source has no provider implemented yet. */
  supported: boolean;
}

// ---------------------------------------------------------------------------
// Global priority
// ---------------------------------------------------------------------------

export async function getPricePriority(userId: number): Promise<PriceSource[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT source FROM user_price_priority WHERE user_id = ? ORDER BY sort_order`,
    [userId],
  );
  if (!rows.length) return [...DEFAULT_PRICE_PRIORITY];
  // normalizePriority backfills any source added since the row was written.
  return normalizePriority(rows.map((r) => r.source as string));
}

export async function setPricePriority(
  userId: number,
  order: unknown,
): Promise<PriceSource[]> {
  const normalized = normalizePriority(order);
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM user_price_priority WHERE user_id = ?`, [userId]);
    await conn.query(
      `INSERT INTO user_price_priority (user_id, source, sort_order) VALUES ${normalized
        .map(() => '(?, ?, ?)')
        .join(', ')}`,
      normalized.flatMap((s, i) => [userId, s, i]),
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Per-game overrides
// ---------------------------------------------------------------------------

export async function getPriceSourceOverrides(
  userId: number,
): Promise<{ gameId: number; title: string; source: PriceSource }[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT o.game_id AS gameId, g.title, o.source
       FROM game_price_source_overrides o
       JOIN games g ON g.id = o.game_id
      WHERE o.user_id = ?
      ORDER BY g.sort_title, g.title`,
    [userId],
  );
  return rows
    .filter((r) => isPriceSource(r.source))
    .map((r) => ({
      gameId: r.gameId as number,
      title: r.title as string,
      source: r.source as PriceSource,
    }));
}

export async function getPriceSourceOverride(
  userId: number,
  gameId: number,
): Promise<PriceSource | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT source FROM game_price_source_overrides WHERE user_id = ? AND game_id = ?`,
    [userId, gameId],
  );
  const source = rows[0]?.source as string | undefined;
  return isPriceSource(source) ? source : null;
}

export async function setPriceSourceOverride(
  userId: number,
  gameId: number,
  source: PriceSource,
): Promise<void> {
  await getPool().query(
    `INSERT INTO game_price_source_overrides (user_id, game_id, source)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE source = VALUES(source)`,
    [userId, gameId, source],
  );
}

export async function clearPriceSourceOverride(userId: number, gameId: number): Promise<void> {
  await getPool().query(
    `DELETE FROM game_price_source_overrides WHERE user_id = ? AND game_id = ?`,
    [userId, gameId],
  );
}

// ---------------------------------------------------------------------------
// Candidate detection
// ---------------------------------------------------------------------------

/**
 * Which sources this game could be priced from, unordered.
 *
 * Three signals, unioned:
 *  - ownership rows (the user already has it somewhere)
 *  - external_game_ids (a store id was matched)
 *  - games.platforms, the IGDB availability list — the only signal that exists
 *    for a wishlisted game the user does not own yet, which is the common case.
 */
export async function getGamePriceCandidates(
  userId: number,
  gameId: number,
): Promise<PriceSource[]> {
  const pool = getPool();
  const found = new Set<PriceSource>();

  const [ownRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT platform FROM ownership WHERE user_id = ? AND game_id = ?`,
    [userId, gameId],
  );
  for (const r of ownRows) {
    const p = r.platform as Platform;
    if (ALL_PLATFORMS.includes(p)) found.add(PLATFORM_PRICE_SOURCE[p]);
  }

  const [idRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT source FROM external_game_ids WHERE game_id = ?`,
    [gameId],
  );
  for (const r of idRows) {
    const s = r.source as string;
    if (s === 'steam_appid') found.add('pc');
    else if (s.startsWith('psn')) found.add('psn');
    else if (s === 'xbox') found.add('xbox');
    else if (s === 'meta_quest') found.add('meta');
    else if (s === 'epic' || s === 'gog') found.add('pc');
  }

  const [gameRows] = await pool.query<RowDataPacket[]>(
    `SELECT platforms FROM games WHERE id = ?`,
    [gameId],
  );
  const raw = gameRows[0]?.platforms;
  if (raw != null) {
    // The column is JSON; mysql2 may hand back a parsed array or a string.
    let names: unknown = raw;
    if (typeof raw === 'string') {
      try {
        names = JSON.parse(raw);
      } catch {
        names = [];
      }
    }
    if (Array.isArray(names)) {
      for (const n of names) {
        if (typeof n !== 'string') continue;
        const s = priceSourceFromIgdbPlatform(n);
        if (s) found.add(s);
      }
    }
  }

  return [...found];
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Decide which source prices this game.
 *
 * An override always wins, even when the game does not look available there —
 * the user said so explicitly, and IGDB platform data is incomplete often
 * enough that second-guessing would be worse than honoring it.
 */
export async function resolvePriceSource(
  userId: number,
  gameId: number,
): Promise<ResolvedPriceSource> {
  const [priority, override, candidates] = await Promise.all([
    getPricePriority(userId),
    getPriceSourceOverride(userId, gameId),
    getGamePriceCandidates(userId, gameId),
  ]);

  const ordered = [...candidates].sort(byPriority(priority));

  const source = override ?? ordered[0] ?? null;
  return {
    source,
    candidates: ordered,
    overridden: override != null,
    supported: source != null && IMPLEMENTED_PRICE_SOURCES.includes(source),
  };
}
