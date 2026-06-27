import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../db';

// Play history = manual log (this table) UNION mined signals (sessions + achievement
// unlock timestamps + status terminal dates), assembled at read time into one
// chronological per-game timeline.

export type HistoryPrecision = 'exact' | 'day' | 'month' | 'year' | 'era';
export type HistoryStatus = 'playing' | 'completed' | 'other';

export interface PlayHistoryEntry {
  id: number;
  gameId: number;
  occurredStart: string | null;
  occurredEnd: string | null;
  precision: HistoryPrecision;
  status: HistoryStatus | null;
  platform: string | null;
  note: string | null;
}

export interface CreateHistoryInput {
  gameId: number;
  occurredStart?: string | null;
  occurredEnd?: string | null;
  precision?: HistoryPrecision;
  status?: HistoryStatus | null;
  platform?: string | null;
  note?: string | null;
}

// ---------------------------------------------------------------------------
// Manual play_history CRUD
// ---------------------------------------------------------------------------

export async function createHistory(userId: number, input: CreateHistoryInput): Promise<number> {
  const [res] = await getPool().query<ResultSetHeader>(
    `INSERT INTO play_history
       (user_id, game_id, occurred_start, occurred_end, \`precision\`, status, platform, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      input.gameId,
      input.occurredStart ?? null,
      input.occurredEnd ?? null,
      input.precision ?? 'year',
      input.status ?? null,
      input.platform ?? null,
      input.note ?? null,
    ],
  );
  return res.insertId;
}

export async function updateHistory(
  userId: number,
  id: number,
  input: Partial<CreateHistoryInput>,
): Promise<boolean> {
  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, unknown> = {
    occurred_start: input.occurredStart,
    occurred_end: input.occurredEnd,
    '`precision`': input.precision,
    status: input.status,
    platform: input.platform,
    note: input.note,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      values.push(val);
    }
  }
  if (!fields.length) return false;
  values.push(userId, id);
  const [res] = await getPool().query<ResultSetHeader>(
    `UPDATE play_history SET ${fields.join(', ')} WHERE user_id = ? AND id = ?`,
    values,
  );
  return res.affectedRows > 0;
}

export async function deleteHistory(userId: number, id: number): Promise<boolean> {
  const [res] = await getPool().query<ResultSetHeader>(
    `DELETE FROM play_history WHERE user_id = ? AND id = ?`,
    [userId, id],
  );
  return res.affectedRows > 0;
}

async function listManual(userId: number, gameId: number): Promise<PlayHistoryEntry[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT id, game_id, occurred_start, occurred_end, \`precision\`, status, platform, note
       FROM play_history WHERE user_id = ? AND game_id = ?
      ORDER BY occurred_start DESC, id DESC`,
    [userId, gameId],
  );
  return rows.map(r => ({
    id: r.id as number,
    gameId: r.game_id as number,
    occurredStart: r.occurred_start as string | null,
    occurredEnd: r.occurred_end as string | null,
    precision: r.precision as HistoryPrecision,
    status: r.status as HistoryStatus | null,
    platform: r.platform as string | null,
    note: r.note as string | null,
  }));
}

// ---------------------------------------------------------------------------
// Unified per-game timeline
// ---------------------------------------------------------------------------

export type TimelineKind = 'session' | 'achievement' | 'manual' | 'status';

export interface TimelineItem {
  kind: TimelineKind;
  /** ISO date(time) the event is anchored to; null only for era-precision manual rows. */
  at: string | null;
  source: string | null;
  /** session: minutes played. achievement: count unlocked that day. */
  value: number | null;
  status: string | null;
  note: string | null;
  precision: HistoryPrecision | null;
  occurredEnd: string | null;
  manualId: number | null;
}

/**
 * Assemble the full timeline for one game:
 *  - play_sessions (each session),
 *  - user_achievements clustered by calendar day (one item per day, count),
 *  - play_history manual rows,
 *  - game_status.finished_at as a terminal marker.
 * Sorted newest-first; manual era rows (no date) sink to the end.
 */
export async function getGameTimeline(userId: number, gameId: number): Promise<TimelineItem[]> {
  const pool = getPool();
  const items: TimelineItem[] = [];

  const [sessions] = await pool.query<RowDataPacket[]>(
    `SELECT started_at, duration_min, source FROM play_sessions
      WHERE user_id = ? AND game_id = ? ORDER BY started_at DESC`,
    [userId, gameId],
  );
  for (const s of sessions) {
    items.push({
      kind: 'session',
      at: s.started_at as string,
      source: s.source as string,
      value: s.duration_min as number,
      status: null, note: null, precision: null, occurredEnd: null, manualId: null,
    });
  }

  const [achDays] = await pool.query<RowDataPacket[]>(
    `SELECT DATE(CONVERT_TZ(unlocked_at, '+00:00', 'America/Chicago')) AS day, COUNT(*) AS n FROM user_achievements
      WHERE user_id = ? AND game_id = ? AND unlocked_at IS NOT NULL
      GROUP BY DATE(CONVERT_TZ(unlocked_at, '+00:00', 'America/Chicago')) ORDER BY day DESC`,
    [userId, gameId],
  );
  for (const a of achDays) {
    items.push({
      kind: 'achievement',
      at: a.day as string,
      source: null,
      value: Number(a.n),
      status: null, note: null, precision: null, occurredEnd: null, manualId: null,
    });
  }

  for (const m of await listManual(userId, gameId)) {
    items.push({
      kind: 'manual',
      at: m.occurredStart,
      source: m.platform,
      value: null,
      status: m.status,
      note: m.note,
      precision: m.precision,
      occurredEnd: m.occurredEnd,
      manualId: m.id,
    });
  }

  const [statusRows] = await pool.query<RowDataPacket[]>(
    `SELECT status, finished_at FROM game_status
      WHERE user_id = ? AND game_id = ? AND finished_at IS NOT NULL`,
    [userId, gameId],
  );
  for (const s of statusRows) {
    items.push({
      kind: 'status',
      at: s.finished_at as string,
      source: null,
      value: null,
      status: s.status as string,
      note: null, precision: null, occurredEnd: null, manualId: null,
    });
  }

  // Newest first; null dates (era-precision memories) sink to the bottom.
  items.sort((a, b) => {
    if (!a.at) return 1;
    if (!b.at) return -1;
    return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
  });
  return items;
}
