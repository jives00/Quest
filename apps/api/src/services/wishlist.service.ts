// ---------------------------------------------------------------------------
// Steam wishlist sync — Steam is the system of record.
// ---------------------------------------------------------------------------
// Mirrors a user's Steam wishlist into the `wishlist` status:
//   - resolves each wishlisted appid to a canonical game (reusing the same
//     matcher the owned-library sync uses), materializing a row when needed;
//   - gives newly-wishlisted games status `wishlist`;
//   - clears the status of games that fell off the Steam wishlist — but ONLY
//     games that have a steam_appid mapping. Manually-added, non-Steam wishlist
//     entries are left untouched, since Steam can't speak to those.
//
// A game that is already owned (status backlog/playing/completed/skipped) is
// never dragged back to `wishlist`: Steam keeps games on the wishlist after you
// buy them, and ownership is the stronger signal.
// ---------------------------------------------------------------------------

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import { getWishlist } from './steam.client';
import { fetchAppDetails } from './steam-store.client';
import { resolveExternalId } from './matching.service';
import { setStatus } from './status.service';

const STEAM_PC_PLATFORM_ID = 6; // IGDB platform id for PC (Windows)
const STORE_DELAY_MS = 400; // pace storefront calls when naming new appids

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WishlistSyncResult {
  /** Total items on the Steam wishlist. */
  total: number;
  /** Games given status `wishlist` this run. */
  added: number;
  /** Games whose `wishlist` status was cleared (fell off the Steam wishlist). */
  removed: number;
}

async function findGameIdByAppId(appId: string): Promise<number | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT game_id FROM external_game_ids WHERE source = 'steam_appid' AND external_id = ? LIMIT 1`,
    [appId],
  );
  return rows.length ? (rows[0].game_id as number) : null;
}

/**
 * Sync one Steam account's wishlist into the `wishlist` status.
 * Returns counts. Throws only on a hard failure (e.g. wishlist fetch error).
 */
export async function syncSteamWishlist(
  userId: number,
  steamId64: string,
): Promise<WishlistSyncResult> {
  const pool = getPool();
  const items = await getWishlist(steamId64);

  // Resolve every wishlisted appid to a canonical game id.
  const targetGameIds = new Set<number>();
  for (const item of items) {
    const appid = String(item.appId);
    let gameId = await findGameIdByAppId(appid);
    if (gameId == null) {
      // New appid — fetch its store name so IGDB matching has a real title, and
      // its release state so an unannounced game is not matched to an older
      // game of the same name (a wishlist is mostly unreleased games, so this
      // is the common case here rather than an edge case).
      const details = await fetchAppDetails(appid);
      const title = details?.name ?? `Steam App ${appid}`;
      const res = await resolveExternalId({
        source: 'steam_appid',
        externalId: appid,
        title,
        platformId: STEAM_PC_PLATFORM_ID,
        unreleased: details?.comingSoon ?? false,
      });
      await sleep(STORE_DELAY_MS);
      if (!res) continue;
      gameId = res.gameId;
    }
    targetGameIds.add(gameId);
  }

  // Games currently sitting on `wishlist`, flagged by Steam-resolvability.
  const [memberRows] = await pool.query<RowDataPacket[]>(
    `SELECT gs.game_id AS gameId,
            EXISTS (SELECT 1 FROM external_game_ids e
                     WHERE e.game_id = gs.game_id AND e.source = 'steam_appid') AS hasSteam
       FROM game_status gs
      WHERE gs.user_id = ? AND gs.status = 'wishlist'`,
    [userId],
  );
  const currentMembers = new Map<number, boolean>(
    memberRows.map((r) => [r.gameId as number, Boolean(r.hasSteam)]),
  );

  // Owned games are excluded outright: Steam leaves a game on the wishlist
  // after purchase, and dragging it back from Unplayed would undo the
  // Wishlist → Unplayed transition on every poll.
  const [ownedRows] = await pool.query<RowDataPacket[]>(
    `SELECT game_id AS gameId FROM ownership WHERE user_id = ?`,
    [userId],
  );
  const owned = new Set<number>(ownedRows.map((r) => r.gameId as number));

  let added = 0;
  for (const gameId of targetGameIds) {
    if (currentMembers.has(gameId) || owned.has(gameId)) continue;
    await setStatus(userId, gameId, 'wishlist', 'ownership_sync');
    added++;
  }

  // Clear Steam-backed games that dropped off the wishlist (Steam = source of
  // truth). Leave non-Steam manual entries alone.
  let removed = 0;
  for (const [gameId, hasSteam] of currentMembers) {
    if (hasSteam && !targetGameIds.has(gameId)) {
      // Off the Steam wishlist without being owned means you changed your
      // mind, not that you bought it — clear the status rather than inventing
      // one. Absence of a row is the resting state.
      await pool.query(
        `DELETE FROM game_status WHERE user_id = ? AND game_id = ? AND status = 'wishlist'`,
        [userId, gameId],
      );
      // No status_changes row: there is no status to report having moved to,
      // and claiming 'skipped' here would put a decision in your mouth that
      // Steam made.
      removed++;
    }
  }

  return { total: items.length, added, removed };
}
