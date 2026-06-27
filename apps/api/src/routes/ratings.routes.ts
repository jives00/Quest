import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function ratingsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // PUT /ratings/:gameId — upsert rating (1–10)
  app.put<{ Params: { gameId: string }; Body: { rating?: number } }>(
    '/ratings/:gameId',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const { rating } = request.body ?? {};
      if (!Number.isInteger(rating) || (rating ?? 0) < 1 || (rating ?? 0) > 10) {
        return reply.status(400).send({ error: 'rating must be an integer 1–10' });
      }
      await getPool().query(
        `INSERT INTO ratings (user_id, game_id, rating)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE rating = VALUES(rating), updated_at = NOW()`,
        [userId(request), gameId, rating],
      );
      return { gameId, rating };
    },
  );

  // DELETE /ratings/:gameId
  app.delete<{ Params: { gameId: string } }>('/ratings/:gameId', auth, async (request, reply) => {
    const gameId = Number(request.params.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return reply.status(400).send({ error: 'Invalid gameId' });
    }
    const [res] = await getPool().query<import('mysql2/promise').ResultSetHeader>(
      `DELETE FROM ratings WHERE user_id = ? AND game_id = ?`,
      [userId(request), gameId],
    );
    if (res.affectedRows === 0) return reply.status(404).send({ error: 'Rating not found' });
    return { deleted: true };
  });
}
