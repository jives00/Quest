import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import {
  isSteamEnabled,
  getPlayerSummary,
  getOwnedGames,
  getRecentlyPlayedGames,
  getPlayerAchievements,
  getSchemaForGame,
} from './steam.client';
import { resolveExternalId } from './matching.service';
import { recordOwnership, autoAdvanceToPlaying } from './library.service';
import { applyPlaytimeDelta, upsertAchievements } from './sessions.service';
import { syncSteamWishlist } from './wishlist.service';
import {
  updateNowPlaying,
  clearNowPlaying,
  getCurrentNowPlayingSource,
} from './now-playing.service';

const PRESENCE_INTERVAL_MS = 90_000; // ~90s
const LIBRARY_INTERVAL_MS = 15 * 60_000; // ~15min
const WISHLIST_INTERVAL_MS = 60 * 60_000; // ~1h
const STEAM_PC_PLATFORM_ID = 6; // IGDB platform id for PC (Windows)

let presenceTimer: NodeJS.Timeout | null = null;
let libraryTimer: NodeJS.Timeout | null = null;
let wishlistTimer: NodeJS.Timeout | null = null;

interface SteamAccount {
  id: number;
  userId: number;
  steamId64: string;
}

// ---------------------------------------------------------------------------
// Account + health helpers
// ---------------------------------------------------------------------------

async function getEnabledSteamAccounts(userId?: number): Promise<SteamAccount[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, steam_id64 FROM platform_accounts
      WHERE platform = 'steam' AND enabled = 1 AND steam_id64 IS NOT NULL
        ${userId != null ? 'AND user_id = ?' : ''}`,
    userId != null ? [userId] : [],
  );
  return rows.map(r => ({
    id: r.id as number,
    userId: r.user_id as number,
    steamId64: r.steam_id64 as string,
  }));
}

async function setHealth(
  accountId: number,
  health: 'green' | 'amber' | 'red',
  error: string | null,
  markSynced: boolean,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE platform_accounts
        SET health = ?, last_error = ?
            ${markSynced ? ', last_synced_at = NOW()' : ''}
      WHERE id = ?`,
    [health, error, accountId],
  );
}

async function findGameIdByAppId(appId: number): Promise<number | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT game_id FROM external_game_ids WHERE source = 'steam_appid' AND external_id = ? LIMIT 1`,
    [String(appId)],
  );
  return rows.length ? (rows[0].game_id as number) : null;
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

async function syncSteamAchievements(
  account: SteamAccount,
  gameId: number,
  appId: number,
): Promise<void> {
  const player = await getPlayerAchievements(account.steamId64, appId);
  if (!player.length) return; // no achievements / private stats

  const schema = await getSchemaForGame(appId);
  const meta = new Map(schema.map(s => [s.apiName, s]));

  await upsertAchievements(
    account.userId,
    gameId,
    'steam',
    player.map(a => {
      const m = meta.get(a.apiName);
      return {
        apiName: a.apiName,
        name: m?.displayName ?? a.name ?? a.apiName,
        icon: m?.icon ?? null,
        achieved: a.achieved,
        unlockedAt: a.unlockTime ? new Date(a.unlockTime * 1000) : null,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Sync units
// ---------------------------------------------------------------------------

async function syncPresence(account: SteamAccount): Promise<void> {
  const summary = await getPlayerSummary(account.steamId64);
  if (summary.gameId) {
    const resolved = await resolveExternalId({
      source: 'steam_appid',
      externalId: summary.gameId,
      title: summary.gameExtraInfo ?? `Steam App ${summary.gameId}`,
      platformId: STEAM_PC_PLATFORM_ID,
    });
    if (!resolved) return;
    await updateNowPlaying(account.userId, resolved.gameId, 'steam');
    await autoAdvanceToPlaying(account.userId, resolved.gameId);
  } else {
    // Only clear if Steam owns the slot (don't stomp PSN now-playing later).
    if ((await getCurrentNowPlayingSource(account.userId)) === 'steam') {
      await clearNowPlaying(account.userId);
    }
  }
}

async function syncLibrary(account: SteamAccount): Promise<void> {
  const owned = await getOwnedGames(account.steamId64);

  // Multiple Steam appids can resolve to one canonical game (a game + its demo,
  // regional SKUs, mis-merges). Aggregate playtime PER GAME before diffing so the
  // appids sum into one total instead of fighting over the single playtime_totals
  // row (which otherwise re-emits a phantom session every poll).
  const byGame = new Map<number, { minutes: number; lastPlayed: number | null }>();
  for (const g of owned) {
    const resolved = await resolveExternalId({
      source: 'steam_appid',
      externalId: String(g.appId),
      title: g.name,
      platformId: STEAM_PC_PLATFORM_ID,
    });
    if (!resolved) continue;
    const { gameId } = resolved;
    const agg = byGame.get(gameId) ?? { minutes: 0, lastPlayed: null };
    agg.minutes += g.playtimeForeverMin;
    if (g.playtimeLastPlayed && (!agg.lastPlayed || g.playtimeLastPlayed > agg.lastPlayed)) {
      agg.lastPlayed = g.playtimeLastPlayed;
    }
    byGame.set(gameId, agg);
  }

  for (const [gameId, agg] of byGame) {
    const acquired = agg.lastPlayed ? new Date(agg.lastPlayed * 1000) : null;
    await recordOwnership(account.userId, gameId, 'steam', acquired);
    await applyPlaytimeDelta(account.userId, gameId, 'steam', agg.minutes);
  }

  // Sync achievements only for recently-played games (bounds API calls).
  const recent = await getRecentlyPlayedGames(account.steamId64);
  for (const r of recent) {
    const gameId = await findGameIdByAppId(r.appId);
    if (gameId) {
      try {
        await syncSteamAchievements(account, gameId, r.appId);
      } catch (err) {
        console.error(`Steam achievements sync failed for app ${r.appId}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Loop runners
// ---------------------------------------------------------------------------

async function runPresenceForAll(): Promise<void> {
  const accounts = await getEnabledSteamAccounts();
  for (const account of accounts) {
    try {
      await syncPresence(account);
    } catch (err) {
      console.error(`Steam presence poll failed (account ${account.id}):`, err);
      await setHealth(account.id, 'red', String(err), false);
    }
  }
}

async function runLibraryForAll(): Promise<void> {
  const accounts = await getEnabledSteamAccounts();
  for (const account of accounts) {
    try {
      await syncLibrary(account);
      await setHealth(account.id, 'green', null, true);
    } catch (err) {
      console.error(`Steam library poll failed (account ${account.id}):`, err);
      await setHealth(account.id, 'red', String(err), false);
    }
  }
}

async function runWishlistForAll(): Promise<void> {
  const accounts = await getEnabledSteamAccounts();
  for (const account of accounts) {
    try {
      const res = await syncSteamWishlist(account.userId, account.steamId64);
      if (res.added || res.removed) {
        console.log(
          `Steam wishlist synced (account ${account.id}): +${res.added} / -${res.removed} (${res.total} on Steam)`,
        );
      }
    } catch (err) {
      // Wishlist failures don't affect account health — they're a side feature.
      console.error(`Steam wishlist sync failed (account ${account.id}):`, err);
    }
  }
}

/** Manual immediate sync (POST /api/sync/steam) — presence + library + wishlist once. */
export async function runSteamSync(
  userId?: number,
): Promise<{ accounts: number; ok: boolean }> {
  const accounts = await getEnabledSteamAccounts(userId);
  let ok = true;
  for (const account of accounts) {
    try {
      await syncPresence(account);
      await syncLibrary(account);
      try {
        await syncSteamWishlist(account.userId, account.steamId64);
      } catch (err) {
        console.error(`Steam wishlist sync failed (account ${account.id}):`, err);
      }
      await setHealth(account.id, 'green', null, true);
    } catch (err) {
      ok = false;
      console.error(`Steam manual sync failed (account ${account.id}):`, err);
      await setHealth(account.id, 'red', String(err), false);
    }
  }
  return { accounts: accounts.length, ok };
}

export function startSteamPoller(): void {
  if (presenceTimer || libraryTimer) return;
  if (!isSteamEnabled()) {
    console.log('⏭️  Steam poller skipped — STEAM_API_KEY not set');
    return;
  }
  console.log('📡 Steam poller started');
  runPresenceForAll().catch(err => console.error('Steam presence poll error:', err));
  runLibraryForAll().catch(err => console.error('Steam library poll error:', err));
  runWishlistForAll().catch(err => console.error('Steam wishlist poll error:', err));
  presenceTimer = setInterval(() => {
    runPresenceForAll().catch(err => console.error('Steam presence poll error:', err));
  }, PRESENCE_INTERVAL_MS);
  libraryTimer = setInterval(() => {
    runLibraryForAll().catch(err => console.error('Steam library poll error:', err));
  }, LIBRARY_INTERVAL_MS);
  wishlistTimer = setInterval(() => {
    runWishlistForAll().catch(err => console.error('Steam wishlist poll error:', err));
  }, WISHLIST_INTERVAL_MS);
}

export function stopSteamPoller(): void {
  if (presenceTimer) clearInterval(presenceTimer);
  if (libraryTimer) clearInterval(libraryTimer);
  if (wishlistTimer) clearInterval(wishlistTimer);
  presenceTimer = null;
  libraryTimer = null;
  wishlistTimer = null;
}
