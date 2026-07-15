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
//  - Positive delta: emit a derived session (best-effort timestamps), update total,
//    auto-advance status Unplayed → Playing.
//  - Negative/zero delta: clamp (no session), still update total so the next diff
//    is correct; log negatives as anomalies.
// ---------------------------------------------------------------------------

export async function applyPlaytimeDelta(
  userId: number,
  gameId: number,
  source: PollSource,
  newTotalMin: number,
): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT total_minutes, last_synced_at FROM playtime_totals WHERE user_id = ? AND game_id = ? AND source = ?`,
    [userId, gameId, source],
  );

  if (!rows.length) {
    await pool.query(
      `INSERT INTO playtime_totals (user_id, game_id, source, total_minutes, last_synced_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [userId, gameId, source, newTotalMin],
    );
    return;
  }

  const prev = rows[0].total_minutes as number;
  const lastSyncedAt = rows[0].last_synced_at as Date | null;
  const delta = newTotalMin - prev;

  if (delta > 0) {
    // A derived session can't represent more playtime than the wall-clock time that
    // actually elapsed since the last successful sync — cap it there. Without this,
    // a title newly resolving to a game it wasn't matched to before (folding in that
    // entry's whole lifetime total in one diff) or a transient bad read from an
    // upstream API (cumulative total briefly inflated, then self-corrects on the next
    // poll via the delta<0 clamp below) both get recorded as one multi-hour session on
    // a day the game wasn't even played.
    const elapsedMin = lastSyncedAt
      ? Math.max(0, Math.round((Date.now() - lastSyncedAt.getTime()) / 60_000))
      : delta;
    const sessionMin = Math.min(delta, elapsedMin);
    if (sessionMin < delta) {
      console.warn(
        `${source} playtime anomaly: game ${gameId} total jumped ${prev}→${newTotalMin} ` +
          `(+${delta}min) but only ${elapsedMin}min elapsed since last sync — session clamped to ${sessionMin}min`,
      );
    }
    await pool.query(
      `INSERT INTO play_sessions
         (user_id, game_id, source, started_at, ended_at, duration_min, derived)
       VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE), NOW(), ?, 1)`,
      [userId, gameId, source, sessionMin, sessionMin],
    );
    await pool.query(
      `UPDATE playtime_totals SET total_minutes = ?, last_synced_at = NOW()
        WHERE user_id = ? AND game_id = ? AND source = ?`,
      [newTotalMin, userId, gameId, source],
    );
    await autoAdvanceToPlaying(userId, gameId);
  } else {
    if (delta < 0) {
      console.warn(
        `${source} playtime anomaly: game ${gameId} total dropped ${prev}→${newTotalMin} (clamped, no session)`,
      );
    }
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
