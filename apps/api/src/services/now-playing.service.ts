import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import type { Platform } from '../platforms';

export const DEFAULT_USER_ID = 1;
export const NOW_PLAYING_STALE_MINUTES = 5;

export type Source = Platform;

/** Upsert now-playing. Preserves `since` while the same game stays active; resets
 *  it when the game changes. Bumps `updated_at` every call (the staleness guard). */
export async function updateNowPlaying(
  userId: number,
  gameId: number,
  source: Source,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO now_playing (user_id, game_id, source, since, updated_at)
     VALUES (?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       since = IF(game_id = VALUES(game_id), since, NOW()),
       game_id = VALUES(game_id),
       source = VALUES(source),
       updated_at = NOW()`,
    [userId, gameId, source],
  );
}

export async function clearNowPlaying(userId: number): Promise<void> {
  await getPool().query(`DELETE FROM now_playing WHERE user_id = ?`, [userId]);
}

/** The source currently recorded as now-playing within the staleness window, or
 *  null. Lets a poller decide whether it owns the slot before clearing it. */
export async function getCurrentNowPlayingSource(userId: number): Promise<Source | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT source FROM now_playing
      WHERE user_id = ? AND updated_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [userId, NOW_PLAYING_STALE_MINUTES],
  );
  return (rows[0]?.source as Source) ?? null;
}

export interface NowPlaying {
  gameId: number;
  platform: Source;
  since: string;
  title: string;
  coverPath: string | null;
  heroPath: string | null;
}

/** Current now-playing for the web dashboard (null when nothing fresh). */
export async function getNowPlaying(userId: number): Promise<NowPlaying | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT np.game_id, np.source, np.since, g.title, g.cover_path, g.hero_path
       FROM now_playing np
       JOIN games g ON g.id = np.game_id
      WHERE np.user_id = ? AND np.updated_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [userId, NOW_PLAYING_STALE_MINUTES],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    gameId: r.game_id as number,
    platform: r.source as Source,
    since: r.since as string,
    title: r.title as string,
    coverPath: r.cover_path as string | null,
    heroPath: r.hero_path as string | null,
  };
}
