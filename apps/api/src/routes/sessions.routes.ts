import { FastifyInstance, FastifyRequest } from 'fastify';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function sessionsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /sessions?page=&limit= — recent sessions joined to game title/cover
  app.get<{ Querystring: { page?: string; limit?: string } }>(
    '/sessions',
    auth,
    async (request) => {
      const uid = userId(request);
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '20', 10) || 20));
      const offset = (page - 1) * limit;

      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ps.id, ps.game_id AS gameId, g.title AS gameTitle, g.cover_path AS gameCoverPath,
                ps.source, ps.started_at AS startedAt, ps.ended_at AS endedAt,
                ps.duration_min AS durationMin, ps.derived
           FROM play_sessions ps
           JOIN games g ON g.id = ps.game_id
          WHERE ps.user_id = ?
          ORDER BY ps.started_at DESC
          LIMIT ? OFFSET ?`,
        [uid, limit, offset],
      );

      return rows.map(r => ({
        id: r.id as number,
        gameId: r.gameId as number,
        gameTitle: r.gameTitle as string,
        gameCoverPath: r.gameCoverPath as string | null,
        source: r.source as string,
        startedAt: r.startedAt as string,
        endedAt: r.endedAt as string,
        durationMin: r.durationMin as number,
        derived: Boolean(r.derived),
      }));
    },
  );

  // PATCH /sessions/:id — edit start/end times, recompute duration; does NOT touch playtime_totals
  app.patch<{
    Params: { id: string };
    Body: { startedAt?: string; endedAt?: string };
  }>('/sessions/:id', auth, async (request, reply) => {
    const sessionId = Number(request.params.id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return reply.status(400).send({ error: 'Invalid sessionId' });
    }
    const uid = userId(request);
    const { startedAt, endedAt } = request.body ?? {};

    if (!startedAt && !endedAt) {
      return reply.status(400).send({ error: 'At least one of startedAt or endedAt is required' });
    }

    const pool = getPool();
    // Fetch existing to fill in any unspecified fields
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT started_at, ended_at FROM play_sessions WHERE id = ? AND user_id = ?`,
      [sessionId, uid],
    );
    if (!existing.length) return reply.status(404).send({ error: 'Session not found' });

    const newStart = startedAt ?? (existing[0].started_at as string);
    const newEnd = endedAt ?? (existing[0].ended_at as string);

    const startMs = new Date(newStart).getTime();
    const endMs = new Date(newEnd).getTime();
    if (isNaN(startMs) || isNaN(endMs)) {
      return reply.status(400).send({ error: 'Invalid date format' });
    }
    if (endMs <= startMs) {
      return reply.status(400).send({ error: 'endedAt must be after startedAt' });
    }
    const durationMin = Math.round((endMs - startMs) / 60000);

    await pool.query(
      `UPDATE play_sessions
          SET started_at = ?, ended_at = ?, duration_min = ?, derived = FALSE
        WHERE id = ? AND user_id = ?`,
      [newStart, newEnd, durationMin, sessionId, uid],
    );

    return { id: sessionId, startedAt: newStart, endedAt: newEnd, durationMin };
  });

  // DELETE /sessions/:id
  app.delete<{ Params: { id: string } }>('/sessions/:id', auth, async (request, reply) => {
    const sessionId = Number(request.params.id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return reply.status(400).send({ error: 'Invalid sessionId' });
    }
    const [res] = await getPool().query<ResultSetHeader>(
      `DELETE FROM play_sessions WHERE id = ? AND user_id = ?`,
      [sessionId, userId(request)],
    );
    if (res.affectedRows === 0) return reply.status(404).send({ error: 'Session not found' });
    return { deleted: true };
  });

  // POST /sessions/merge — merge sessions into one spanning session (does NOT touch playtime_totals)
  app.post<{ Body: { ids?: number[] } }>('/sessions/merge', auth, async (request, reply) => {
    const { ids } = request.body ?? {};
    if (!Array.isArray(ids) || ids.length < 2 || ids.some(id => !Number.isInteger(id) || id <= 0)) {
      return reply.status(400).send({ error: 'ids must be an array of at least 2 positive integers' });
    }

    const uid = userId(request);
    const pool = getPool();

    // Fetch the sessions — must all belong to the user and the same game
    const placeholders = ids.map(() => '?').join(',');
    const [sessions] = await pool.query<RowDataPacket[]>(
      `SELECT id, game_id, source, started_at, ended_at, duration_min
         FROM play_sessions
        WHERE id IN (${placeholders}) AND user_id = ?`,
      [...ids, uid],
    );

    if (sessions.length !== ids.length) {
      return reply.status(404).send({ error: 'One or more sessions not found' });
    }

    const gameIds = new Set(sessions.map(s => s.game_id as number));
    if (gameIds.size > 1) {
      return reply.status(400).send({ error: 'All sessions must belong to the same game' });
    }

    const gameId = sessions[0].game_id as number;
    const source = sessions[0].source as string;

    // min start, max end, sum of duration
    let minStart = sessions[0].started_at as string;
    let maxEnd = sessions[0].ended_at as string;
    let totalDuration = 0;

    for (const s of sessions) {
      if (s.started_at < minStart) minStart = s.started_at as string;
      if (s.ended_at > maxEnd) maxEnd = s.ended_at as string;
      totalDuration += s.duration_min as number;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Insert the merged session
      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO play_sessions (user_id, game_id, source, started_at, ended_at, duration_min, derived)
         VALUES (?, ?, ?, ?, ?, ?, FALSE)`,
        [uid, gameId, source, minStart, maxEnd, totalDuration],
      );
      const mergedId = res.insertId;

      // Delete the originals
      await conn.query(
        `DELETE FROM play_sessions WHERE id IN (${placeholders}) AND user_id = ?`,
        [...ids, uid],
      );

      await conn.commit();
      return { mergedId, gameId, startedAt: minStart, endedAt: maxEnd, durationMin: totalDuration };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });
}
