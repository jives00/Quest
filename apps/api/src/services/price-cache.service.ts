// ---------------------------------------------------------------------------
// Price cache — read-through storage for storefront lookups.
//
// Every upstream provider is rate-limited or scrape-paced, and the wishlist
// asks for one price per row per page load. Without this, a 30-game wishlist
// would hammer NEXARDA and queststoredb on every single visit.
// ---------------------------------------------------------------------------

import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../db';
import type { PriceSource } from '../price-sources';

/** How long a stored price counts as fresh. Storefront prices move daily at most. */
export const PRICE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedPrice {
  current: { price: number; regular: number; cut: number; shop: string; url: string } | null;
  lowest: { price: number } | null;
  fetchedAt: Date;
}

/** The provider-shaped payload written into the cache. */
export interface PricePayload {
  current: { price: number; regular: number; cut: number; shop: string; url: string } | null;
  lowest: { price: number } | null;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read whatever is stored, fresh or not. Callers decide what to do with a
 * stale row — serving one beats showing nothing when the upstream is down.
 */
export async function readCachedPrice(
  gameId: number,
  source: PriceSource,
  country: string,
): Promise<CachedPrice | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT price, regular, cut, shop, url, lowest, fetched_at AS fetchedAt
       FROM game_prices
      WHERE game_id = ? AND source = ? AND country = ?`,
    [gameId, source, country],
  );
  const r = rows[0];
  if (!r) return null;

  const price = toNumber(r.price);
  const lowest = toNumber(r.lowest);
  return {
    current:
      price != null
        ? {
            price,
            regular: toNumber(r.regular) ?? price,
            cut: Number(r.cut ?? 0),
            shop: (r.shop as string | null) ?? '',
            url: (r.url as string | null) ?? '',
          }
        : null,
    lowest: lowest != null ? { price: lowest } : null,
    fetchedAt: new Date(r.fetchedAt as string),
  };
}

export function isFresh(entry: CachedPrice, ttlMs = PRICE_TTL_MS): boolean {
  return Date.now() - entry.fetchedAt.getTime() < ttlMs;
}

export async function writeCachedPrice(
  gameId: number,
  source: PriceSource,
  country: string,
  payload: PricePayload,
): Promise<void> {
  await getPool().query<ResultSetHeader>(
    `INSERT INTO game_prices
       (game_id, source, country, price, regular, cut, shop, url, lowest, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       price = VALUES(price), regular = VALUES(regular), cut = VALUES(cut),
       shop = VALUES(shop), url = VALUES(url), lowest = VALUES(lowest),
       fetched_at = NOW()`,
    [
      gameId,
      source,
      country,
      payload.current?.price ?? null,
      payload.current?.regular ?? null,
      payload.current?.cut ?? null,
      payload.current?.shop ?? null,
      payload.current?.url ?? null,
      payload.lowest?.price ?? null,
    ],
  );
}

/** Wishlisted games across all users, for the background refresh sweep. */
export async function getWishlistedGameIds(): Promise<{ userId: number; gameId: number }[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT DISTINCT l.user_id AS userId, li.game_id AS gameId
       FROM lists l
       JOIN list_items li ON li.list_id = l.id
      WHERE l.system_key = 'wishlist'`,
  );
  return rows.map((r) => ({ userId: r.userId as number, gameId: r.gameId as number }));
}
