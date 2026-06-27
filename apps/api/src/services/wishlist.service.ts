// ---------------------------------------------------------------------------
// Steam wishlist sync — Steam is the system of record.
// ---------------------------------------------------------------------------
// Mirrors a user's Steam wishlist into the local "Wishlist" system list:
//   - resolves each wishlisted appid to a canonical game (reusing the same
//     matcher the owned-library sync uses), materializing a row when needed;
//   - adds newly-wishlisted games to the Wishlist list;
//   - removes games that fell off the Steam wishlist — but ONLY games that have
//     a steam_appid mapping. Manually-added, non-Steam wishlist entries are left
//     untouched, since Steam can't speak to those.
// ---------------------------------------------------------------------------

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import { getWishlist } from './steam.client';
import { fetchAppDetails } from './steam-store.client';
import { resolveExternalId } from './matching.service';
import { addToList, removeFromList, seedSystemLists } from './library.service';

const STEAM_PC_PLATFORM_ID = 6; // IGDB platform id for PC (Windows)
const STORE_DELAY_MS = 400; // pace storefront calls when naming new appids

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WishlistSyncResult {
  /** Total items on the Steam wishlist. */
  total: number;
  /** Games added to the local Wishlist list this run. */
  added: number;
  /** Games removed (fell off the Steam wishlist). */
  removed: number;
}

/** Resolve (and seed if missing) the user's Wishlist system list id. */
async function getWishlistListId(userId: number): Promise<number> {
  const pool = getPool();
  const find = async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM lists WHERE user_id = ? AND kind = 'system' AND system_key = 'wishlist' LIMIT 1`,
      [userId],
    );
    return rows.length ? (rows[0].id as number) : null;
  };
  let id = await find();
  if (id == null) {
    await seedSystemLists(userId);
    id = await find();
  }
  if (id == null) throw new Error('Wishlist system list could not be resolved');
  return id;
}

async function findGameIdByAppId(appId: string): Promise<number | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT game_id FROM external_game_ids WHERE source = 'steam_appid' AND external_id = ? LIMIT 1`,
    [appId],
  );
  return rows.length ? (rows[0].game_id as number) : null;
}

/**
 * Sync one Steam account's wishlist into the local Wishlist list.
 * Returns counts. Throws only on a hard failure (e.g. wishlist fetch error).
 */
export async function syncSteamWishlist(
  userId: number,
  steamId64: string,
): Promise<WishlistSyncResult> {
  const pool = getPool();
  const items = await getWishlist(steamId64);
  const wishlistListId = await getWishlistListId(userId);

  // Resolve every wishlisted appid to a canonical game id.
  const targetGameIds = new Set<number>();
  for (const item of items) {
    const appid = String(item.appId);
    let gameId = await findGameIdByAppId(appid);
    if (gameId == null) {
      // New appid — fetch its store name so IGDB matching has a real title.
      const details = await fetchAppDetails(appid);
      const title = details?.name ?? `Steam App ${appid}`;
      const res = await resolveExternalId({
        source: 'steam_appid',
        externalId: appid,
        title,
        platformId: STEAM_PC_PLATFORM_ID,
      });
      await sleep(STORE_DELAY_MS);
      if (!res) continue;
      gameId = res.gameId;
    }
    targetGameIds.add(gameId);
  }

  // Current Wishlist members, flagged by whether they're Steam-resolvable.
  const [memberRows] = await pool.query<RowDataPacket[]>(
    `SELECT li.game_id AS gameId,
            EXISTS (SELECT 1 FROM external_game_ids e
                     WHERE e.game_id = li.game_id AND e.source = 'steam_appid') AS hasSteam
       FROM list_items li
      WHERE li.list_id = ?`,
    [wishlistListId],
  );
  const currentMembers = new Map<number, boolean>(
    memberRows.map((r) => [r.gameId as number, Boolean(r.hasSteam)]),
  );

  // Add games newly on the Steam wishlist.
  let added = 0;
  for (const gameId of targetGameIds) {
    if (!currentMembers.has(gameId)) {
      await addToList(wishlistListId, gameId);
      added++;
    }
  }

  // Remove Steam-backed games that dropped off the wishlist (Steam = source of
  // truth). Leave non-Steam manual entries alone.
  let removed = 0;
  for (const [gameId, hasSteam] of currentMembers) {
    if (hasSteam && !targetGameIds.has(gameId)) {
      await removeFromList(wishlistListId, gameId);
      removed++;
    }
  }

  return { total: items.length, added, removed };
}
