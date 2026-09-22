import { RowDataPacket } from 'mysql2/promise';
import { GameStatus, StatusChangeSource } from '@quest/types';
import { getPool } from '../db';

/**
 * Status writes, in one place so every path -- the manual PUT, the ownership
 * sync, the playtime auto-advance -- records the same audit row and applies the
 * same completion rule.
 */

export async function getStatus(userId: number, gameId: number): Promise<GameStatus | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT status FROM game_status WHERE user_id = ? AND game_id = ? LIMIT 1`,
    [userId, gameId],
  );
  return rows.length ? (rows[0].status as GameStatus) : null;
}

/** Audit row for the activity feed. Silent no-op when nothing actually moved. */
export async function logStatusChange(
  userId: number,
  gameId: number,
  from: GameStatus | null,
  to: GameStatus,
  source: StatusChangeSource,
): Promise<void> {
  if (from === to) return;
  await getPool().query(
    `INSERT INTO status_changes (user_id, game_id, from_status, to_status, source)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, gameId, from, to, source],
  );
}

/**
 * Set a status and record the move.
 *
 * A completion row is written on every transition *into* Completed from a
 * non-Completed status -- not "only if none exists yet". The old rule silently
 * dropped the second playthrough of a replay (Completed -> Backlog -> Playing
 * -> Completed), which is the whole point of the Replay list.
 */
export async function setStatus(
  userId: number,
  gameId: number,
  status: GameStatus,
  source: StatusChangeSource = 'manual',
): Promise<{ previous: GameStatus | null }> {
  const pool = getPool();
  const previous = await getStatus(userId, gameId);

  await pool.query(
    `INSERT INTO game_status (user_id, game_id, status, started_at, finished_at)
     VALUES (?, ?, ?, IF(? = 'playing', NOW(), NULL), IF(? = 'completed', NOW(), NULL))
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       started_at = IF(VALUES(status) = 'playing' AND started_at IS NULL, NOW(), started_at),
       finished_at = IF(VALUES(status) = 'completed' AND finished_at IS NULL, NOW(), finished_at)`,
    [userId, gameId, status, status, status],
  );

  if (status === 'completed' && previous !== 'completed') {
    await pool.query(
      `INSERT INTO game_completions (user_id, game_id, completed_at, source)
       VALUES (?, ?, NOW(), 'status_change')`,
      [userId, gameId],
    );
  }

  await logStatusChange(userId, gameId, previous, status, source);
  return { previous };
}
