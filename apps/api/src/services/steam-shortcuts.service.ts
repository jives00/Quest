import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import { resolveExternalId } from './matching.service';
import { recordOwnership, autoAdvanceToPlaying } from './library.service';
import { updateNowPlaying, clearNowPlaying } from './now-playing.service';

// ---------------------------------------------------------------------------
// Non-Steam shortcuts ("Add a Non-Steam Game").
//
// Steam tracks these, but only where nothing server-side can reach: the Web API
// omits them from GetOwnedGames and hides them in GetPlayerSummaries, and the
// local files that DO hold their playtime (userdata/<id>/config/localconfig.vdf,
// keyed by the appid as a SIGNED int32) are only flushed when the Steam client
// exits. So the numbers here come from an agent on the gaming PC that times the
// process itself -- see tools/shortcut-watcher/.
//
// That makes this the one source with real start/end times rather than a
// cumulative snapshot, so it writes sessions directly instead of going through
// applyPlaytimeDelta's diff-and-reconstruct path.
//
// Everything is attributed to the 'steam' platform: Steam is what launched and
// measured it, and a separate platform would mean widening every per-table
// platform ENUM plus the label/list/UI surface for a handful of games.
// ---------------------------------------------------------------------------

const STEAM_PC_PLATFORM_ID = 6; // IGDB platform id for PC (Windows)

/** Below this a "session" is a mis-launch or a bounce off the title screen. */
const MIN_SESSION_MIN = 2;

/** No single reported session is credible past this — a watcher that was killed
 *  without firing its stop, then resumed, could otherwise bank a multi-day run. */
const MAX_SESSION_MIN = 12 * 60;

export interface ShortcutRef {
  /** Steam's local shortcut appid (unsigned 32-bit, from shortcuts.vdf). */
  appId: string;
  /** The shortcut's AppName — the only title we get, so it drives IGDB matching. */
  name: string;
}

async function resolveShortcut(ref: ShortcutRef): Promise<number | null> {
  const resolved = await resolveExternalId({
    source: 'steam_nonsteam',
    externalId: ref.appId,
    title: ref.name,
    platformId: STEAM_PC_PLATFORM_ID,
  });
  return resolved?.gameId ?? null;
}

/**
 * Heartbeat from the agent while a shortcut is running. Refreshes now-playing
 * (which goes stale after NOW_PLAYING_STALE_MINUTES, so the agent must keep
 * calling) and advances Unplayed → Playing on first sight.
 */
export async function markShortcutPlaying(
  userId: number,
  ref: ShortcutRef,
): Promise<{ gameId: number } | null> {
  const gameId = await resolveShortcut(ref);
  if (gameId == null) return null; // explicitly ignored external id

  await recordOwnership(userId, gameId, 'steam', null);
  await updateNowPlaying(userId, gameId, 'steam');
  await autoAdvanceToPlaying(userId, gameId);
  return { gameId };
}

export interface ShortcutSession extends ShortcutRef {
  startedAt: Date;
  endedAt: Date;
  /** Agent-generated, stable across retries — the dedupe key. */
  clientUid: string;
}

export type SessionOutcome =
  | { status: 'recorded'; gameId: number; minutes: number }
  | { status: 'duplicate'; gameId: number; minutes: number }
  | { status: 'too_short'; minutes: number }
  | { status: 'too_long'; minutes: number }
  | { status: 'ignored' };

/**
 * Record a completed session and release the now-playing slot.
 *
 * Idempotent on `clientUid`: a retry after a lost response is absorbed by the
 * unique index rather than banking the minutes twice, so the agent can retry
 * freely. The playtime total is only advanced when the INSERT actually took.
 */
export async function recordShortcutSession(
  userId: number,
  session: ShortcutSession,
): Promise<SessionOutcome> {
  const minutes = Math.round(
    (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000,
  );
  if (minutes < MIN_SESSION_MIN) return { status: 'too_short', minutes };
  if (minutes > MAX_SESSION_MIN) {
    console.warn(
      `steam_nonsteam: rejecting ${minutes}min session for "${session.name}" ` +
        `(appid ${session.appId}) — exceeds ${MAX_SESSION_MIN}min cap`,
    );
    return { status: 'too_long', minutes };
  }

  const gameId = await resolveShortcut(session);
  if (gameId == null) return { status: 'ignored' };

  const pool = getPool();
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO play_sessions
       (user_id, game_id, source, started_at, ended_at, duration_min, derived, client_uid)
     VALUES (?, ?, 'steam', ?, ?, ?, 0, ?)`,
    [userId, gameId, session.startedAt, session.endedAt, minutes, session.clientUid],
  );

  if (res.affectedRows === 0) {
    // Same uid already banked — a retry, not a second session.
    return { status: 'duplicate', gameId, minutes };
  }

  // The totals row is a running sum here, not a copy of an upstream counter, so
  // it is incremented. last_progress_at moves to the session end so a later
  // cumulative source (were one ever added) cannot re-claim this window.
  await pool.query(
    `INSERT INTO playtime_totals
       (user_id, game_id, source, total_minutes, last_synced_at, last_progress_at)
     VALUES (?, ?, 'steam', ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       total_minutes    = total_minutes + VALUES(total_minutes),
       last_synced_at   = NOW(),
       last_progress_at = GREATEST(COALESCE(last_progress_at, VALUES(last_progress_at)), VALUES(last_progress_at))`,
    [userId, gameId, minutes, session.endedAt],
  );

  await recordOwnership(userId, gameId, 'steam', null);
  await autoAdvanceToPlaying(userId, gameId);

  // Only release the slot if THIS game still holds it. Checking the source alone
  // would stomp a real Steam game the poller had since put there — the user may
  // already have started something else by the time a retried stop lands.
  const [np] = await pool.query<RowDataPacket[]>(
    `SELECT game_id FROM now_playing WHERE user_id = ?`,
    [userId],
  );
  if (np.length && (np[0].game_id as number) === gameId) {
    await clearNowPlaying(userId);
  }

  return { status: 'recorded', gameId, minutes };
}
