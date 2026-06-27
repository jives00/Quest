import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../db';
import { PLATFORM_LABELS, type Platform } from '../platforms';

export type { Platform };
export type SystemKey = 'backlog' | 'wishlist' | 'replay' | 'vr';

const SYSTEM_LISTS: { key: SystemKey; name: string; sort: number }[] = [
  { key: 'backlog', name: 'Backlog', sort: 0 },
  { key: 'wishlist', name: 'Wishlist', sort: 1 },
  { key: 'replay', name: 'Replay', sort: 2 },
  { key: 'vr', name: 'VR', sort: 3 },
];

/** Seed the three undeletable system lists for a user (idempotent). Called from
 *  ensureAdminUser so a fresh install always has Backlog/Wishlist/Replay. */
export async function seedSystemLists(userId: number): Promise<void> {
  const pool = getPool();
  for (const l of SYSTEM_LISTS) {
    await pool.query(
      `INSERT IGNORE INTO lists (user_id, slug, name, kind, system_key, sort_order)
       VALUES (?, ?, ?, 'system', ?, ?)`,
      [userId, l.key, l.name, l.key, l.sort],
    );
  }
}

/** Ensure the auto-derived per-platform list row exists (membership itself is
 *  computed by query, not stored as list_items). Idempotent. */
export async function ensurePlatformList(userId: number, platform: Platform): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT IGNORE INTO lists (user_id, slug, name, kind, platform, sort_order)
     VALUES (?, ?, ?, 'platform', ?, ?)`,
    [userId, `platform-${platform}`, PLATFORM_LABELS[platform], platform, 10],
  );
}

async function getListIdBySystemKey(userId: number, key: SystemKey): Promise<number | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM lists WHERE user_id = ? AND kind = 'system' AND system_key = ? LIMIT 1`,
    [userId, key],
  );
  return rows.length ? (rows[0].id as number) : null;
}

async function isInList(listId: number, gameId: number): Promise<boolean> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM list_items WHERE list_id = ? AND game_id = ? LIMIT 1`,
    [listId, gameId],
  );
  return rows.length > 0;
}

export async function addToList(listId: number, gameId: number): Promise<void> {
  await getPool().query(
    `INSERT IGNORE INTO list_items (list_id, game_id) VALUES (?, ?)`,
    [listId, gameId],
  );
}

export async function removeFromList(listId: number, gameId: number): Promise<void> {
  await getPool().query(
    `DELETE FROM list_items WHERE list_id = ? AND game_id = ?`,
    [listId, gameId],
  );
}

/**
 * Record ownership of a game on a platform (idempotent). Ensures the per-platform
 * list exists, and applies the one deliberate auto list-mutation: a Wishlist game
 * that becomes owned auto-moves Wishlist → Backlog (a fulfilled wish is a backlog
 * item by definition). Used by both the poller and the manual ownership toggle.
 */
export async function recordOwnership(
  userId: number,
  gameId: number,
  platform: Platform,
  acquiredAt?: Date | null,
): Promise<void> {
  const pool = getPool();

  const [suppressed] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM ownership_suppressions WHERE user_id = ? AND game_id = ? AND platform = ? LIMIT 1`,
    [userId, gameId, platform],
  );
  if (suppressed.length) return;

  await pool.query(
    `INSERT INTO ownership (user_id, game_id, platform, acquired_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE acquired_at = COALESCE(ownership.acquired_at, VALUES(acquired_at))`,
    [userId, gameId, platform, acquiredAt ?? null],
  );

  await ensurePlatformList(userId, platform);

  // Wishlist → Backlog auto-move (the single automatic list mutation).
  const wishlistId = await getListIdBySystemKey(userId, 'wishlist');
  if (wishlistId && (await isInList(wishlistId, gameId))) {
    const backlogId = await getListIdBySystemKey(userId, 'backlog');
    if (backlogId) {
      await addToList(backlogId, gameId);
      await removeFromList(wishlistId, gameId);
      console.log(`Wishlist→Backlog: game ${gameId} (now owned on ${platform})`);
    }
  }
}

/**
 * Auto-advance play status to 'playing' on first detected activity. Flips
 * 'unplayed' → 'playing' only; never moves a game backward or sets
 * beaten/completed/dropped (those are manual judgment calls).
 */
export async function autoAdvanceToPlaying(userId: number, gameId: number): Promise<void> {
  await getPool().query<ResultSetHeader>(
    `INSERT INTO game_status (user_id, game_id, status, started_at)
     VALUES (?, ?, 'playing', NOW())
     ON DUPLICATE KEY UPDATE
       status = IF(status = 'unplayed', 'playing', status),
       started_at = COALESCE(started_at, NOW())`,
    [userId, gameId],
  );
}
