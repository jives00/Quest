import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import {
  isXboxEnabled,
  getTitleHistory,
  getPresence,
  getAchievements,
} from './xbox.client';
import { resolveExternalId } from './matching.service';
import { recordOwnership } from './library.service';
import { upsertAchievements } from './sessions.service';
import {
  updateNowPlaying,
  clearNowPlaying,
  getCurrentNowPlayingSource,
} from './now-playing.service';
import { IGDB_PLATFORM_HINT } from '../platforms';

const PRESENCE_INTERVAL_MS = 2 * 60_000; // ~2min
const LIBRARY_INTERVAL_MS = 15 * 60_000; // ~15min

let presenceTimer: NodeJS.Timeout | null = null;
let libraryTimer: NodeJS.Timeout | null = null;
// Guards against overlapping library syncs (boot run + 15-min timer + manual "Connect
// & sync" can otherwise race and create duplicate provisional rows for the same game).
let libraryBusy = false;

interface XboxAccount {
  id: number;
  userId: number;
  xuid: string;
}

async function getEnabledXboxAccounts(userId?: number): Promise<XboxAccount[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, xuid FROM platform_accounts
      WHERE platform = 'xbox' AND enabled = 1 AND xuid IS NOT NULL
        ${userId != null ? 'AND user_id = ?' : ''}`,
    userId != null ? [userId] : [],
  );
  return rows.map(r => ({
    id: r.id as number,
    userId: r.user_id as number,
    xuid: r.xuid as string,
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

function titleKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ---------------------------------------------------------------------------
// Sync units — Xbox contributes ownership + achievements (with timestamps).
// No minutes are available from Xbox, so there are no playtime deltas/sessions.
// ---------------------------------------------------------------------------

async function syncLibrary(account: XboxAccount): Promise<Map<string, number>> {
  const titles = await getTitleHistory();
  const nameToGame = new Map<string, number>();

  for (const t of titles) {
    if (!t.name) continue;
    const resolved = await resolveExternalId({
      source: 'xbox',
      externalId: t.titleId,
      title: t.name,
      platformId: IGDB_PLATFORM_HINT.xbox,
    });
    if (!resolved) continue;
    const { gameId } = resolved;
    await recordOwnership(account.userId, gameId, 'xbox', t.lastPlayed);
    nameToGame.set(titleKey(t.name), gameId);

    // Only fetch achievements when the title actually has some unlocked (bounds calls).
    if (t.currentAchievements > 0) {
      try {
        const achievements = await getAchievements(account.xuid, t.titleId);
        await upsertAchievements(account.userId, gameId, 'xbox', achievements);
      } catch (err) {
        console.error(`Xbox achievements sync failed for title ${t.titleId}:`, err);
      }
    }
  }

  return nameToGame;
}

async function syncPresence(account: XboxAccount, nameToGame?: Map<string, number>): Promise<void> {
  const presence = await getPresence(account.xuid);
  if (presence.titleName) {
    let gameId = nameToGame?.get(titleKey(presence.titleName));
    if (!gameId) {
      const r = await resolveExternalId({
        source: 'xbox',
        externalId: presence.titleId ?? presence.titleName,
        title: presence.titleName,
        platformId: IGDB_PLATFORM_HINT.xbox,
      });
      if (!r) return;
      gameId = r.gameId;
    }
    await updateNowPlaying(account.userId, gameId, 'xbox');
  } else if ((await getCurrentNowPlayingSource(account.userId)) === 'xbox') {
    await clearNowPlaying(account.userId);
  }
}

// ---------------------------------------------------------------------------
// Loop runners
// ---------------------------------------------------------------------------

async function runLibraryForAll(): Promise<void> {
  if (libraryBusy) {
    console.log('⏭️  Xbox library sync already in progress — skipping this run');
    return;
  }
  libraryBusy = true;
  try {
    const accounts = await getEnabledXboxAccounts();
    for (const account of accounts) {
      try {
        await syncLibrary(account);
        await setHealth(account.id, 'green', null, true);
      } catch (err) {
        console.error(`Xbox library poll failed (account ${account.id}):`, err);
        const isRateLimit = String(err).includes('429');
        await setHealth(account.id, isRateLimit ? 'amber' : 'red', String(err), false);
      }
    }
  } finally {
    libraryBusy = false;
  }
}

async function runPresenceForAll(): Promise<void> {
  const accounts = await getEnabledXboxAccounts();
  for (const account of accounts) {
    try {
      await syncPresence(account);
    } catch (err) {
      console.error(`Xbox presence poll failed (account ${account.id}):`, err);
    }
  }
}

/** Manual immediate sync (POST /api/sync/xbox). */
export async function runXboxSync(userId?: number): Promise<{ accounts: number; ok: boolean }> {
  if (libraryBusy) {
    console.log('⏭️  Xbox sync requested but a library sync is already running — skipping');
    return { accounts: 0, ok: true };
  }
  libraryBusy = true;
  try {
    return await runXboxSyncInner(userId);
  } finally {
    libraryBusy = false;
  }
}

async function runXboxSyncInner(userId?: number): Promise<{ accounts: number; ok: boolean }> {
  const accounts = await getEnabledXboxAccounts(userId);
  let ok = true;
  for (const account of accounts) {
    try {
      const nameToGame = await syncLibrary(account);
      await syncPresence(account, nameToGame);
      await setHealth(account.id, 'green', null, true);
    } catch (err) {
      ok = false;
      console.error(`Xbox manual sync failed (account ${account.id}):`, err);
      const isRateLimit = String(err).includes('429');
      await setHealth(account.id, isRateLimit ? 'amber' : 'red', String(err), false);
    }
  }
  return { accounts: accounts.length, ok };
}

export function startXboxPoller(): void {
  if (presenceTimer || libraryTimer) return;
  if (!isXboxEnabled()) {
    console.log('⏭️  Xbox poller skipped — OPENXBL_API_KEY not set');
    return;
  }
  console.log('📡 Xbox poller started');
  runLibraryForAll().catch(err => console.error('Xbox library poll error:', err));
  runPresenceForAll().catch(err => console.error('Xbox presence poll error:', err));
  presenceTimer = setInterval(() => {
    runPresenceForAll().catch(err => console.error('Xbox presence poll error:', err));
  }, PRESENCE_INTERVAL_MS);
  libraryTimer = setInterval(() => {
    runLibraryForAll().catch(err => console.error('Xbox library poll error:', err));
  }, LIBRARY_INTERVAL_MS);
}

export function stopXboxPoller(): void {
  if (presenceTimer) clearInterval(presenceTimer);
  if (libraryTimer) clearInterval(libraryTimer);
  presenceTimer = null;
  libraryTimer = null;
}
