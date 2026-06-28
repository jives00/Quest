import { FastifyInstance, FastifyRequest } from 'fastify';
import { ResultSetHeader } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function customOwnershipRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  app.post<{ Body: { gameId?: number; platformId?: number } }>(
    '/custom-ownership',
    auth,
    async (request, reply) => {
      const { gameId, platformId } = request.body ?? {};
      if (!Number.isInteger(gameId) || (gameId ?? 0) <= 0) {
        return reply.status(400).send({ error: 'gameId must be a positive integer' });
      }
      if (!Number.isInteger(platformId) || (platformId ?? 0) <= 0) {
        return reply.status(400).send({ error: 'platformId must be a positive integer' });
      }
      const uid = userId(request);
      // Verify the platform belongs to this user
      const pool = getPool();
      const [rows] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
        `SELECT id FROM user_platforms WHERE id = ? AND user_id = ?`,
        [platformId, uid],
      );
      if (!rows.length) return reply.status(404).send({ error: 'Platform not found' });

      await pool.query(
        `INSERT IGNORE INTO custom_ownership (user_id, game_id, platform_id) VALUES (?, ?, ?)`,
        [uid, gameId, platformId],
      );
      return reply.status(201).send({ gameId, platformId });
    },
  );

  app.delete<{ Params: { gameId: string; platformId: string } }>(
    '/custom-ownership/:gameId/:platformId',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      const platformId = Number(request.params.platformId);
      if (!Number.isInteger(gameId) || gameId <= 0 || !Number.isInteger(platformId) || platformId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId or platformId' });
      }
      const [res] = await getPool().query<ResultSetHeader>(
        `DELETE FROM custom_ownership WHERE user_id = ? AND game_id = ? AND platform_id = ?`,
        [userId(request), gameId, platformId],
      );
      if (res.affectedRows === 0) return reply.status(404).send({ error: 'Ownership not found' });
      return { deleted: true };
    },
  );
}
