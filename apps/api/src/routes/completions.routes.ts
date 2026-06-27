import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';
import { maybePopulateHltbPlaytime } from '../services/games.service';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function completionsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /games/:gameId/completions
  app.get<{ Params: { gameId: string } }>(
    '/games/:gameId/completions',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const [rows] = await getPool().query<import('mysql2/promise').RowDataPacket[]>(
        `SELECT id, completed_at AS completedAt, source
         FROM game_completions
         WHERE user_id = ? AND game_id = ?
         ORDER BY completed_at DESC`,
        [userId(request), gameId],
      );
      return rows;
    },
  );

  // POST /games/:gameId/completions — add manual completion
  app.post<{ Params: { gameId: string }; Body: { completedAt?: string } }>(
    '/games/:gameId/completions',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }

      const uid = userId(request);
      const { completedAt } = request.body ?? {};
      const ts = completedAt ? new Date(completedAt) : new Date();
      if (isNaN(ts.getTime())) {
        return reply.status(400).send({ error: 'Invalid completedAt date' });
      }

      const [res] = await getPool().query<import('mysql2/promise').ResultSetHeader>(
        `INSERT INTO game_completions (user_id, game_id, completed_at, source)
         VALUES (?, ?, ?, 'manual')`,
        [uid, gameId, ts],
      );

      // Best-effort: populate playtime from HLTB if nothing is tracked yet
      maybePopulateHltbPlaytime(uid, gameId).catch((err) =>
        console.error('HLTB playtime auto-populate failed:', err),
      );

      return reply.status(201).send({ id: res.insertId, completedAt: ts.toISOString(), source: 'manual' });
    },
  );

  // DELETE /completions/:id — delete a specific completion entry
  app.delete<{ Params: { id: string } }>(
    '/completions/:id',
    auth,
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.status(400).send({ error: 'Invalid id' });
      }
      const [res] = await getPool().query<import('mysql2/promise').ResultSetHeader>(
        `DELETE FROM game_completions WHERE id = ? AND user_id = ?`,
        [id, userId(request)],
      );
      if (res.affectedRows === 0) return reply.status(404).send({ error: 'Completion not found' });
      return { deleted: true };
    },
  );
}
