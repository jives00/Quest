import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function notesRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // PUT /notes/:gameId — upsert note body
  app.put<{ Params: { gameId: string }; Body: { body?: string } }>(
    '/notes/:gameId',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const { body: noteBody } = request.body ?? {};
      if (typeof noteBody !== 'string' || noteBody.trim() === '') {
        return reply.status(400).send({ error: 'body is required' });
      }
      await getPool().query(
        `INSERT INTO notes (user_id, game_id, body)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = NOW()`,
        [userId(request), gameId, noteBody],
      );
      return { gameId, body: noteBody };
    },
  );

  // DELETE /notes/:gameId
  app.delete<{ Params: { gameId: string } }>('/notes/:gameId', auth, async (request, reply) => {
    const gameId = Number(request.params.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return reply.status(400).send({ error: 'Invalid gameId' });
    }
    const [res] = await getPool().query<import('mysql2/promise').ResultSetHeader>(
      `DELETE FROM notes WHERE user_id = ? AND game_id = ?`,
      [userId(request), gameId],
    );
    if (res.affectedRows === 0) return reply.status(404).send({ error: 'Note not found' });
    return { deleted: true };
  });
}
