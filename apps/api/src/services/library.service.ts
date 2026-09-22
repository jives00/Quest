import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { DEFAULT_SYNCED_STATUS, type SystemKey } from '@quest/types';
import { getPool } from '../db';
import { PLATFORM_LABELS, type Platform } from '../platforms';
import { getStatus, logStatusChange } from './status.service';

export type { Platform };
export type { SystemKey };

// Backlog and Wishlist used to live here as lists *and* as a status-shaped
// concept. They are statuses now; lists are classification only.
const SYSTEM_LISTS: { key: SystemKey; name: string; sort: number }[] = [
  { key: 'replay', name: 'Replay', sort: 2 },
  { key: 'vr', name: 'VR', sort: 3 },
  { key: 'endless', name: 'Endless', sort: 4 },
];

/** Seed the undeletable system lists for a user (idempotent). Called from
 *  ensureAdminUser so a fresh install always has Replay/VR/Endless. */
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

export async function getListIdBySystemKey(userId: number, key: SystemKey): Promise<number | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM lists WHERE user_id = ? AND kind = 'system' AND system_key = ? LIMIT 1`,
    [userId, key],
  );
  return rows.length ? (rows[0].id as number) : null;
}

export async function isInList(listId: number, gameId: number): Promise<boolean> {
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
 * Record ownership of a game on a platform (idempotent). Ensures the
 * per-platform list exists, and files anything newly acquired under Backlog.
 * Used by both the poller and the manual ownership toggle.
 *
 * "Newly acquired" is load-bearing. This runs for every owned game on every
 * poll, so keying the default off "has no status" would re-file the entire
 * back catalogue into Backlog on the next sync. It keys off whether the
 * ownership row was actually inserted (mysql reports affectedRows 1 for an
 * insert, 2 for an ON DUPLICATE KEY update), so a library that predates this
 * change keeps its blank status until you say otherwise.
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

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO ownership (user_id, game_id, platform, acquired_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE acquired_at = COALESCE(ownership.acquired_at, VALUES(acquired_at))`,
    [userId, gameId, platform, acquiredAt ?? null],
  );
  const firstTimeOnThisPlatform = res.affectedRows === 1;

  await ensurePlatformList(userId, platform);

  const previous = await getStatus(userId, gameId);

  // Wishlist → Backlog (automatic transition #1). Buying it is the signal.
  if (previous === 'wishlist') {
    await pool.query(
      `UPDATE game_status SET status = ? WHERE user_id = ? AND game_id = ?`,
      [DEFAULT_SYNCED_STATUS, userId, gameId],
    );
    await logStatusChange(userId, gameId, previous, DEFAULT_SYNCED_STATUS, 'ownership_sync');
    console.log(`Wishlist→Backlog: game ${gameId} (now owned on ${platform})`);
    return;
  }

  // Anything genuinely new to the library also lands in Backlog. Guarded on
  // the insert so a re-sync of an existing game never resurrects a status you
  // cleared, and an owned-elsewhere game picked up on a second platform isn't
  // dragged back either.
  if (firstTimeOnThisPlatform && previous === null) {
    const [owned] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM ownership WHERE user_id = ? AND game_id = ? AND platform <> ? LIMIT 1`,
      [userId, gameId, platform],
    );
    if (owned.length) return;

    await pool.query(
      `INSERT IGNORE INTO game_status (user_id, game_id, status) VALUES (?, ?, ?)`,
      [userId, gameId, DEFAULT_SYNCED_STATUS],
    );
    await logStatusChange(userId, gameId, null, DEFAULT_SYNCED_STATUS, 'ownership_sync');
  }
}

/**
 * Auto-advance play status to 'playing' on first detected activity (automatic
 * transition #2). Runs from no status, 'backlog' or 'skipped' — playing
 * something you'd written off is exactly the case worth catching. Never moves
 * a game backward, and never sets 'completed': that is always a manual
 * judgment call, with no achievement-percentage or playtime heuristic.
 */
export async function autoAdvanceToPlaying(userId: number, gameId: number): Promise<void> {
  const previous = await getStatus(userId, gameId);
  if (previous !== null && previous !== 'skipped' && previous !== 'backlog') return;

  await getPool().query<ResultSetHeader>(
    `INSERT INTO game_status (user_id, game_id, status, started_at)
     VALUES (?, ?, 'playing', NOW())
     ON DUPLICATE KEY UPDATE
       status = IF(status IN ('skipped', 'backlog'), 'playing', status),
       started_at = COALESCE(started_at, NOW())`,
    [userId, gameId],
  );

  await logStatusChange(userId, gameId, previous, 'playing', 'playtime');
}
