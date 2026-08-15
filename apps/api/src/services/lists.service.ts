import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../db';
import { steamCapsuleUrl } from './steam.client';

export interface ListRow {
  id: number;
  slug: string;
  name: string;
  kind: 'system' | 'platform' | 'custom';
  systemKey: string | null;
  platform: string | null;
  sortOrder: number;
  itemCount: number;
}

export interface ListGameRow {
  id: number;
  title: string;
  coverPath: string | null;
  /** Wide store capsule art, when one can be resolved. Null falls back to coverPath. */
  capsulePath: string | null;
  matchStatus: string;
  status: string;
  sortOrder: number;
  firstReleaseDate: string | null;
  metacritic: number | null;
  hltbMainExtraHours: number | null;
  hltbMainHours: number | null;
  hltbCompletionistHours: number | null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

/** All lists for the user, with item counts.
 *  Platform lists: count is derived from ownership (not list_items). */
export async function getUserLists(userId: number): Promise<ListRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       l.id,
       l.slug,
       l.name,
       l.kind,
       l.system_key AS systemKey,
       l.platform,
       l.sort_order AS sortOrder,
       CASE
         WHEN l.kind = 'platform' THEN (
           SELECT COUNT(DISTINCT o.game_id)
             FROM ownership o
            WHERE o.user_id = l.user_id AND o.platform = l.platform
         )
         WHEN l.system_key = 'vr' THEN (
           SELECT COUNT(*) FROM games WHERE vr_supported = 1
         )
         ELSE (
           SELECT COUNT(*) FROM list_items li WHERE li.list_id = l.id
         )
       END AS itemCount
     FROM lists l
     WHERE l.user_id = ?
     ORDER BY l.sort_order, l.id`,
    [userId],
  );
  return rows.map(r => ({
    id: r.id as number,
    slug: r.slug as string,
    name: r.name as string,
    kind: r.kind as 'system' | 'platform' | 'custom',
    systemKey: r.systemKey as string | null,
    platform: r.platform as string | null,
    sortOrder: r.sortOrder as number,
    itemCount: Number(r.itemCount),
  }));
}

/** Games in a list.
 *  Platform lists: membership from ownership, ordered by sort_title.
 *  System/custom lists: from list_items ordered by sort_order. */
export async function getListGames(userId: number, listId: number): Promise<ListGameRow[]> {
  const pool = getPool();

  // First resolve the list row to know its kind/platform/system_key
  const [listRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, kind, platform, system_key AS systemKey FROM lists WHERE id = ? AND user_id = ?`,
    [listId, userId],
  );
  if (!listRows.length) return [];
  const list = listRows[0];

  if (list.systemKey === 'vr') {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id, g.title, g.cover_path AS coverPath, g.match_status AS matchStatus,
              COALESCE(gs.status, 'unplayed') AS status, 0 AS sortOrder,
              g.first_release_date AS firstReleaseDate, g.metacritic,
              g.hltb_main_extra_hours AS hltbMainExtraHours,
              g.hltb_main_hours AS hltbMainHours,
              g.hltb_completionist_hours AS hltbCompletionistHours,
              g.capsule_path AS capsulePath,
              (SELECT e.external_id FROM external_game_ids e
                WHERE e.game_id = g.id AND e.source = 'steam_appid' LIMIT 1) AS steamAppId
         FROM games g
         LEFT JOIN game_status gs ON gs.game_id = g.id AND gs.user_id = ?
        WHERE g.vr_supported = 1
        ORDER BY g.sort_title, g.title`,
      [userId],
    );
    return rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      coverPath: r.coverPath as string | null,
      matchStatus: r.matchStatus as string,
      status: r.status as string,
      sortOrder: 0,
      firstReleaseDate: r.firstReleaseDate as string | null,
      metacritic: r.metacritic != null ? Number(r.metacritic) : null,
      hltbMainExtraHours: r.hltbMainExtraHours != null ? Number(r.hltbMainExtraHours) : null,
      hltbMainHours: r.hltbMainHours != null ? Number(r.hltbMainHours) : null,
      hltbCompletionistHours: r.hltbCompletionistHours != null ? Number(r.hltbCompletionistHours) : null,
      // Stored capsule wins; the derived Steam URL is a zero-cost guess that
      // only resolves for older apps. Deliberately no hero fallback — heroes
      // are 3.10 against a capsule's 2.14, so they crop badly in the slot.
      capsulePath:
        (r.capsulePath as string | null) ??
        steamCapsuleUrl(r.steamAppId as string | null),
    }));
  }

  if (list.kind === 'platform') {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id, g.title, g.cover_path AS coverPath, g.match_status AS matchStatus,
              COALESCE(gs.status, 'unplayed') AS status, 0 AS sortOrder,
              g.first_release_date AS firstReleaseDate, g.metacritic,
              g.hltb_main_extra_hours AS hltbMainExtraHours,
              g.hltb_main_hours AS hltbMainHours,
              g.hltb_completionist_hours AS hltbCompletionistHours,
              g.capsule_path AS capsulePath,
              (SELECT e.external_id FROM external_game_ids e
                WHERE e.game_id = g.id AND e.source = 'steam_appid' LIMIT 1) AS steamAppId
         FROM games g
         JOIN ownership o ON o.game_id = g.id AND o.user_id = ? AND o.platform = ?
         LEFT JOIN game_status gs ON gs.game_id = g.id AND gs.user_id = ?
        ORDER BY g.sort_title, g.title`,
      [userId, list.platform, userId],
    );
    return rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      coverPath: r.coverPath as string | null,
      matchStatus: r.matchStatus as string,
      status: r.status as string,
      sortOrder: 0,
      firstReleaseDate: r.firstReleaseDate as string | null,
      metacritic: r.metacritic != null ? Number(r.metacritic) : null,
      hltbMainExtraHours: r.hltbMainExtraHours != null ? Number(r.hltbMainExtraHours) : null,
      hltbMainHours: r.hltbMainHours != null ? Number(r.hltbMainHours) : null,
      hltbCompletionistHours: r.hltbCompletionistHours != null ? Number(r.hltbCompletionistHours) : null,
      // Stored capsule wins; the derived Steam URL is a zero-cost guess that
      // only resolves for older apps. Deliberately no hero fallback — heroes
      // are 3.10 against a capsule's 2.14, so they crop badly in the slot.
      capsulePath:
        (r.capsulePath as string | null) ??
        steamCapsuleUrl(r.steamAppId as string | null),
    }));
  }

  // System or custom: from list_items
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT g.id, g.title, g.cover_path AS coverPath, g.match_status AS matchStatus,
            COALESCE(gs.status, 'unplayed') AS status, li.sort_order AS sortOrder,
            g.first_release_date AS firstReleaseDate, g.metacritic,
            g.hltb_main_extra_hours AS hltbMainExtraHours,
            g.hltb_main_hours AS hltbMainHours,
            g.hltb_completionist_hours AS hltbCompletionistHours,
            g.capsule_path AS capsulePath,
            (SELECT e.external_id FROM external_game_ids e
              WHERE e.game_id = g.id AND e.source = 'steam_appid' LIMIT 1) AS steamAppId
       FROM list_items li
       JOIN games g ON g.id = li.game_id
       LEFT JOIN game_status gs ON gs.game_id = g.id AND gs.user_id = ?
       JOIN lists l ON l.id = li.list_id
      WHERE li.list_id = ? AND l.user_id = ?
      ORDER BY li.sort_order, g.sort_title`,
    [userId, listId, userId],
  );
  return rows.map(r => ({
    id: r.id as number,
    title: r.title as string,
    coverPath: r.coverPath as string | null,
    matchStatus: r.matchStatus as string,
    status: r.status as string,
    sortOrder: r.sortOrder as number,
    firstReleaseDate: r.firstReleaseDate as string | null,
    metacritic: r.metacritic != null ? Number(r.metacritic) : null,
    hltbMainExtraHours: r.hltbMainExtraHours != null ? Number(r.hltbMainExtraHours) : null,
    hltbMainHours: r.hltbMainHours != null ? Number(r.hltbMainHours) : null,
    hltbCompletionistHours: r.hltbCompletionistHours != null ? Number(r.hltbCompletionistHours) : null,
    // Stored capsule wins; the derived Steam URL is a zero-cost guess that
    // only resolves for older apps. Deliberately no hero fallback — heroes
    // are 3.10 against a capsule's 2.14, so they crop badly in the slot.
    capsulePath:
      (r.capsulePath as string | null) ??
      steamCapsuleUrl(r.steamAppId as string | null),
  }));
}

/** Create a custom list. Returns the new list id. */
export async function createCustomList(userId: number, name: string): Promise<number> {
  const pool = getPool();
  let slug = slugify(name);

  // Deduplicate slug if needed
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT slug FROM lists WHERE user_id = ? AND slug LIKE ?`,
    [userId, `${slug}%`],
  );
  if (existing.length > 0) {
    const existingSlugs = new Set(existing.map(r => r.slug as string));
    if (existingSlugs.has(slug)) {
      slug = `${slug}-${Date.now()}`;
    }
  }

  const [maxRow] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(sort_order), 99) + 1 AS next_order FROM lists WHERE user_id = ?`,
    [userId],
  );
  const sortOrder = Number(maxRow[0]?.next_order ?? 100);

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO lists (user_id, slug, name, kind, sort_order) VALUES (?, ?, ?, 'custom', ?)`,
    [userId, slug, name, sortOrder],
  );
  return res.insertId;
}

/** Rename a custom list (blocks system/platform). */
export async function renameList(userId: number, listId: number, name: string): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT kind FROM lists WHERE id = ? AND user_id = ?`,
    [listId, userId],
  );
  if (!rows.length) throw Object.assign(new Error('List not found'), { statusCode: 404 });
  if (rows[0].kind !== 'custom') throw Object.assign(new Error('Only custom lists can be renamed'), { statusCode: 403 });
  await pool.query(`UPDATE lists SET name = ? WHERE id = ?`, [name, listId]);
}

/** Delete a custom list (blocks system/platform). */
export async function deleteList(userId: number, listId: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT kind FROM lists WHERE id = ? AND user_id = ?`,
    [listId, userId],
  );
  if (!rows.length) throw Object.assign(new Error('List not found'), { statusCode: 404 });
  if (rows[0].kind !== 'custom') throw Object.assign(new Error('Only custom lists can be deleted'), { statusCode: 403 });
  await pool.query(`DELETE FROM lists WHERE id = ?`, [listId]);
}

/** Add a game to a list (blocks platform and VR lists). */
export async function addGameToList(userId: number, listId: number, gameId: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT kind, system_key AS systemKey FROM lists WHERE id = ? AND user_id = ?`,
    [listId, userId],
  );
  if (!rows.length) throw Object.assign(new Error('List not found'), { statusCode: 404 });
  if (rows[0].kind === 'platform') throw Object.assign(new Error('Platform lists are read-only (derived from ownership)'), { statusCode: 403 });
  if (rows[0].systemKey === 'vr') throw Object.assign(new Error('VR list is derived — toggle VR from the game detail page'), { statusCode: 403 });
  await pool.query(
    `INSERT IGNORE INTO list_items (list_id, game_id) VALUES (?, ?)`,
    [listId, gameId],
  );
}

/** Remove a game from a list (blocks platform and VR lists). */
export async function removeGameFromList(userId: number, listId: number, gameId: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT kind, system_key AS systemKey FROM lists WHERE id = ? AND user_id = ?`,
    [listId, userId],
  );
  if (!rows.length) throw Object.assign(new Error('List not found'), { statusCode: 404 });
  if (rows[0].kind === 'platform') throw Object.assign(new Error('Platform lists are read-only (derived from ownership)'), { statusCode: 403 });
  if (rows[0].systemKey === 'vr') throw Object.assign(new Error('VR list is derived — toggle VR from the game detail page'), { statusCode: 403 });
  await pool.query(
    `DELETE FROM list_items WHERE list_id = ? AND game_id = ?`,
    [listId, gameId],
  );
}

/** Reorder list items by assigning sort_order from the provided gameId array. */
export async function reorderList(userId: number, listId: number, gameIds: number[]): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT kind FROM lists WHERE id = ? AND user_id = ?`,
    [listId, userId],
  );
  if (!rows.length) throw Object.assign(new Error('List not found'), { statusCode: 404 });
  if (rows[0].kind === 'platform') throw Object.assign(new Error('Platform lists are read-only'), { statusCode: 403 });

  for (let i = 0; i < gameIds.length; i++) {
    await pool.query(
      `UPDATE list_items SET sort_order = ? WHERE list_id = ? AND game_id = ?`,
      [i, listId, gameIds[i]],
    );
  }
}
