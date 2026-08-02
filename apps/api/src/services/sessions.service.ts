import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import { autoAdvanceToPlaying } from './library.service';
import type { PollSource } from '../platforms';

// ---------------------------------------------------------------------------
// Session reconstruction (the core cross-platform algorithm)
//
// Extracted from steam-poll.service.ts in Phase 2 so PSN/Xbox reuse it verbatim.
// Every polling source diffs a cumulative playtime snapshot the same way:
//  - First sync (no snapshot): record baseline, emit NO session (historical
//    lifetime time has no date — don't invent one).
//  - Positive delta that fits its accrual window: emit a derived session ending at
//    the moment the source says play last happened, update total, auto-advance
//    status Unplayed → Playing.
//  - Positive delta that can't fit: treat it like a first sync — update total,
//    emit NO session, log the anomaly.
//  - Negative/zero delta: clamp (no session), still update total so the next diff
//    is correct; log negatives as anomalies.
//
// Two things make the "does it fit" test correct, and both matter:
//
//  1. The window is measured from `last_progress_at` (the last time we ACCOUNTED
//     for playtime), not `last_synced_at` (which every poll rewrites). Upstreams
//     flush cumulative playtime in bursts far larger than one poll interval — a
//     two-hour sitting can land in a single diff — so charging a delta against one
//     poll interval rejected ordinary play. It silently discarded ~48% of real
//     playtime (measured against Steam's own playtime_2weeks), and because the
//     totals below are a straight copy of the upstream number they stayed correct
//     the whole time, which is what hid the bug.
//
//  2. The session is stamped ending at `lastPlayedAt` — when the source says play
//     actually happened — not at poll time. A burst flushed hours late otherwise
//     lands on the wrong day in every stats/history view.
// ---------------------------------------------------------------------------

// No single derived session is credible past this. The window test alone can't
// catch a title that newly resolved to this game and folded its whole lifetime
// total into one diff when the row has sat idle long enough for that total to
// "fit" — a stale row's window grows without bound, this doesn't.
const MAX_DERIVED_SESSION_MIN = 24 * 60;

export async function applyPlaytimeDelta(
  userId: number,
  gameId: number,
  source: PollSource,
  newTotalMin: number,
  lastPlayedAt?: Date | null,
): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT total_minutes, last_synced_at, last_progress_at FROM playtime_totals
      WHERE user_id = ? AND game_id = ? AND source = ?`,
    [userId, gameId, source],
  );

  if (!rows.length) {
    // Baseline. Everything up to now is accounted for by definition, so the first
    // real delta is charged against the window starting here.
    await pool.query(
      `INSERT INTO playtime_totals (user_id, game_id, source, total_minutes, last_synced_at, last_progress_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [userId, gameId, source, newTotalMin],
    );
    return;
  }

  const prev = rows[0].total_minutes as number;
  const delta = newTotalMin - prev;

  if (delta > 0) {
    const now = new Date();
    // Pre-036 rows have no progress marker; last_synced_at is the best stand-in.
    const accountedThrough =
      (rows[0].last_progress_at as Date | null) ?? (rows[0].last_synced_at as Date | null);

    // Trust the source's "last played" for placement, but never let a skewed
    // upstream clock stamp a session in the future.
    const endedAt =
      lastPlayedAt && lastPlayedAt.getTime() <= now.getTime() ? lastPlayedAt : now;

    // Minutes that could plausibly have been played in the unaccounted window.
    // A negative window (source reports play older than what we've already
    // accounted for) collapses to 0, which correctly rejects the delta.
    const windowMin = accountedThrough
      ? Math.max(0, Math.round((endedAt.getTime() - accountedThrough.getTime()) / 60_000))
      : delta;
    const budgetMin = Math.min(windowMin, MAX_DERIVED_SESSION_MIN);

    if (delta > budgetMin) {
      // Can't be real play in this window — a title newly resolved to this game and
      // folded in its whole lifetime total, or the upstream returned a bad
      // cumulative read (which self-corrects via the delta<0 clamp below). Either
      // way the delta carries no usable date, so emit no session, exactly as a
      // first sync does. The playtime is not lost — the total still updates, and
      // year stats spread that untracked remainder across the years it belongs to.
      console.warn(
        `${source} playtime anomaly: game ${gameId} total jumped ${prev}→${newTotalMin} ` +
          `(+${delta}min) but only ${budgetMin}min of unaccounted window since ` +
          `${accountedThrough?.toISOString() ?? 'never'} — recording total without a session`,
      );
    } else {
      await pool.query(
        `INSERT INTO play_sessions
           (user_id, game_id, source, started_at, ended_at, duration_min, derived)
         VALUES (?, ?, ?, DATE_SUB(?, INTERVAL ? MINUTE), ?, ?, 1)`,
        [userId, gameId, source, endedAt, delta, endedAt, delta],
      );
    }
    // Advance the marker on both paths: the minutes are in the total either way, so
    // a later delta must not be allowed to claim this window a second time.
    await pool.query(
      `UPDATE playtime_totals SET total_minutes = ?, last_synced_at = NOW(), last_progress_at = ?
        WHERE user_id = ? AND game_id = ? AND source = ?`,
      [newTotalMin, endedAt, userId, gameId, source],
    );
    await autoAdvanceToPlaying(userId, gameId);
  } else {
    if (delta < 0) {
      console.warn(
        `${source} playtime anomaly: game ${gameId} total dropped ${prev}→${newTotalMin} (clamped, no session)`,
      );
    }
    // No progress — leave last_progress_at alone so the window keeps accruing.
    await pool.query(
      `UPDATE playtime_totals SET total_minutes = ?, last_synced_at = NOW()
        WHERE user_id = ? AND game_id = ? AND source = ?`,
      [newTotalMin, userId, gameId, source],
    );
  }
}

// ---------------------------------------------------------------------------
// Achievement upsert (shared by every source that reports unlock state)
//
// Definitions are global per game (INSERT IGNORE keeps the first writer's text);
// user unlock rows carry the timestamp that seeds the play-history timeline.
// `unlockedAt` is a JS Date (or null for "earned, no timestamp").
// ---------------------------------------------------------------------------

export interface AchievementUpsert {
  apiName: string;
  name: string;
  icon: string | null;
  achieved: boolean;
  unlockedAt: Date | null;
}

export async function upsertAchievements(
  userId: number,
  gameId: number,
  source: PollSource,
  achievements: AchievementUpsert[],
): Promise<void> {
  if (!achievements.length) return;
  const pool = getPool();

  for (const a of achievements) {
    await pool.query(
      `INSERT IGNORE INTO achievements (game_id, source, api_name, name, icon)
       VALUES (?, ?, ?, ?, ?)`,
      [gameId, source, a.apiName, a.name, a.icon],
    );
    if (a.achieved) {
      await pool.query(
        `INSERT INTO user_achievements (user_id, game_id, api_name, unlocked_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE unlocked_at = VALUES(unlocked_at)`,
        [userId, gameId, a.apiName, a.unlockedAt],
      );
    }
  }
}
