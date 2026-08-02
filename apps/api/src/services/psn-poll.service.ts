import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import {
  isPsnEnabled,
  getPlayedTitles,
  getPresence,
  getTrophyTitles,
  getTrophies,
} from './psn.client';
import { resolveExternalId } from './matching.service';
import { recordOwnership } from './library.service';
import { applyPlaytimeDelta, upsertAchievements } from './sessions.service';
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
// Guards against overlapping library syncs (boot run + timer + manual sync racing into
// duplicate provisional rows).
let libraryBusy = false;

interface PsnAccount {
  id: number;
  userId: number;
  npsso: string;
}

// ---------------------------------------------------------------------------
// Account + health helpers (mirror steam-poll)
// ---------------------------------------------------------------------------

async function getEnabledPsnAccounts(userId?: number): Promise<PsnAccount[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, npsso_token FROM platform_accounts
      WHERE platform = 'psn' AND enabled = 1 AND npsso_token IS NOT NULL
        ${userId != null ? 'AND user_id = ?' : ''}`,
    userId != null ? [userId] : [],
  );
  return rows.map(r => ({
    id: r.id as number,
    userId: r.user_id as number,
    npsso: r.npsso_token as string,
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

/** Normalized title key for matching trophy titles back to gamelist-created games. */
function titleKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const TROPHY_REFRESH_DAYS = 21;

/** Whether we already have PSN trophy rows for a game (gates the heavy per-title fetch). */
async function hasPsnAchievements(gameId: number): Promise<boolean> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT 1 FROM achievements WHERE game_id = ? AND source = 'psn' LIMIT 1`,
    [gameId],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Sync units
// ---------------------------------------------------------------------------

/**
 * Pull the PSN gamelist (real playDuration) → ownership + playtime deltas. Returns a
 * normalized-title → gameId map so the trophy pass can attach trophies to the games
 * created here (trophy titles carry no concept id to match on directly).
 */
async function syncLibrary(account: PsnAccount): Promise<Map<string, number>> {
  const titles = await getPlayedTitles(account.npsso);
  const nameToGame = new Map<string, number>();

  // Multiple PSN entries (PS4 + PS5 editions, demos, regional SKUs — often sharing one
  // concept id) can resolve to a single canonical game. Aggregate playtime PER GAME
  // before diffing so they sum into one total instead of fighting over the single
  // playtime_totals row (which otherwise re-emits a phantom session every poll).
  // Mirrors the Steam poller's per-game aggregation.
  const byGame = new Map<number, { minutes: number; lastPlayed: Date | null }>();
  for (const t of titles) {
    const resolved = await resolveExternalId({
      source: 'psn_concept',
      externalId: t.conceptId,
      title: t.name,
      platformId: IGDB_PLATFORM_HINT.psn,
    });
    if (!resolved) continue;
    const { gameId } = resolved;
    const agg = byGame.get(gameId) ?? { minutes: 0, lastPlayed: null };
    agg.minutes += t.playMinutes;
    const lp = t.lastPlayed ?? t.firstPlayed ?? null;
    if (lp && (!agg.lastPlayed || lp > agg.lastPlayed)) agg.lastPlayed = lp;
    byGame.set(gameId, agg);
    if (t.name) nameToGame.set(titleKey(t.name), gameId);
  }

  for (const [gameId, agg] of byGame) {
    await recordOwnership(account.userId, gameId, 'psn', agg.lastPlayed);
    // PSN reports cumulative minutes — feed the same session-reconstruction algorithm.
    await applyPlaytimeDelta(account.userId, gameId, 'psn', agg.minutes, agg.lastPlayed);
  }

  return nameToGame;
}

/**
 * Trophy titles are the comprehensive "games I've actually played" list — far more
 * complete than the play-history gamelist (which misses many played games, e.g.
 * Astro Bot). So we MATERIALIZE ownership from trophies, not just enrich: any trophy
 * title not already created by the gamelist becomes an owned PSN game (no playtime,
 * but with trophy progress). Games found by both keep their gamelist playtime.
 */
async function syncTrophies(account: PsnAccount, nameToGame: Map<string, number>): Promise<void> {
  const trophyTitles = await getTrophyTitles(account.npsso);

  for (const tt of trophyTitles) {
    let gameId = nameToGame.get(titleKey(tt.titleName));
    if (!gameId) {
      // Trophy-only game — create/match it and record PSN ownership. The
      // npCommunicationId is the stable external id under the psn_concept source.
      const r = await resolveExternalId({
        source: 'psn_concept',
        externalId: tt.npCommunicationId,
        title: tt.titleName,
        platformId: IGDB_PLATFORM_HINT.psn,
      });
      if (!r) continue;
      gameId = r.gameId;
      await recordOwnership(account.userId, gameId, 'psn', tt.lastUpdated);
      nameToGame.set(titleKey(tt.titleName), gameId);
    }

    // The per-title trophy fetch is the expensive call. Only do it when the title
    // changed recently, or we don't yet have its trophies — so steady-state polls
    // stay cheap while the first sync still backfills everything.
    const recentlyUpdated =
      tt.lastUpdated != null &&
      Date.now() - tt.lastUpdated.getTime() < TROPHY_REFRESH_DAYS * 86_400_000;
    if (!recentlyUpdated && (await hasPsnAchievements(gameId))) continue;

    try {
      const trophies = await getTrophies(account.npsso, tt.npCommunicationId, tt.npServiceName);
      await upsertAchievements(
        account.userId,
        gameId,
        'psn',
        trophies.map(tr => ({
          apiName: tr.apiName,
          name: tr.name,
          icon: tr.icon,
          achieved: tr.earned,
          unlockedAt: tr.earnedAt,
        })),
      );
    } catch (err) {
      console.error(`PSN trophy sync failed for ${tt.npCommunicationId}:`, err);
    }
  }
}

async function syncPresence(account: PsnAccount, nameToGame?: Map<string, number>): Promise<void> {
  const presence = await getPresence(account.npsso);
  if (presence.titleName) {
    // Resolve via the gamelist name map when available, else materialize by title.
    let gameId = nameToGame?.get(titleKey(presence.titleName));
    if (!gameId) {
      const r = await resolveExternalId({
        source: 'psn_concept',
        externalId: presence.titleId ?? presence.titleName,
        title: presence.titleName,
        platformId: IGDB_PLATFORM_HINT.psn,
      });
      if (!r) return;
      gameId = r.gameId;
    }
    await updateNowPlaying(account.userId, gameId, 'psn');
  } else if ((await getCurrentNowPlayingSource(account.userId)) === 'psn') {
    await clearNowPlaying(account.userId);
  }
}

// ---------------------------------------------------------------------------
// Loop runners
// ---------------------------------------------------------------------------

/** NPSSO expiry surfaces as an auth error — flip to red so the dashboard banner shows. */
function isAuthError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('NPSSO') || msg.includes('auth') || msg.includes('401');
}

async function runLibraryForAll(): Promise<void> {
  if (libraryBusy) {
    console.log('⏭️  PSN library sync already in progress — skipping this run');
    return;
  }
  libraryBusy = true;
  try {
    const accounts = await getEnabledPsnAccounts();
    for (const account of accounts) {
      try {
        const nameToGame = await syncLibrary(account);
        await syncTrophies(account, nameToGame);
        await setHealth(account.id, 'green', null, true);
      } catch (err) {
        console.error(`PSN library poll failed (account ${account.id}):`, err);
        await setHealth(account.id, isAuthError(err) ? 'red' : 'amber', String(err), false);
      }
    }
  } finally {
    libraryBusy = false;
  }
}

async function runPresenceForAll(): Promise<void> {
  const accounts = await getEnabledPsnAccounts();
  for (const account of accounts) {
    try {
      await syncPresence(account);
    } catch (err) {
      console.error(`PSN presence poll failed (account ${account.id}):`, err);
      if (isAuthError(err)) await setHealth(account.id, 'red', String(err), false);
    }
  }
}

/** Manual immediate sync (POST /api/sync/psn). */
export async function runPsnSync(userId?: number): Promise<{ accounts: number; ok: boolean }> {
  if (libraryBusy) {
    console.log('⏭️  PSN sync requested but a library sync is already running — skipping');
    return { accounts: 0, ok: true };
  }
  libraryBusy = true;
  try {
    return await runPsnSyncInner(userId);
  } finally {
    libraryBusy = false;
  }
}

async function runPsnSyncInner(userId?: number): Promise<{ accounts: number; ok: boolean }> {
  const accounts = await getEnabledPsnAccounts(userId);
  let ok = true;
  for (const account of accounts) {
    try {
      const nameToGame = await syncLibrary(account);
      await syncTrophies(account, nameToGame);
      await syncPresence(account, nameToGame);
      await setHealth(account.id, 'green', null, true);
    } catch (err) {
      ok = false;
      console.error(`PSN manual sync failed (account ${account.id}):`, err);
      await setHealth(account.id, isAuthError(err) ? 'red' : 'amber', String(err), false);
    }
  }
  return { accounts: accounts.length, ok };
}

export function startPsnPoller(): void {
  if (presenceTimer || libraryTimer) return;
  if (!isPsnEnabled()) {
    console.log('⏭️  PSN poller skipped — PSN_NPSSO not set');
    return;
  }
  console.log('📡 PSN poller started');
  runLibraryForAll().catch(err => console.error('PSN library poll error:', err));
  runPresenceForAll().catch(err => console.error('PSN presence poll error:', err));
  presenceTimer = setInterval(() => {
    runPresenceForAll().catch(err => console.error('PSN presence poll error:', err));
  }, PRESENCE_INTERVAL_MS);
  libraryTimer = setInterval(() => {
    runLibraryForAll().catch(err => console.error('PSN library poll error:', err));
  }, LIBRARY_INTERVAL_MS);
}

export function stopPsnPoller(): void {
  if (presenceTimer) clearInterval(presenceTimer);
  if (libraryTimer) clearInterval(libraryTimer);
  presenceTimer = null;
  libraryTimer = null;
}
