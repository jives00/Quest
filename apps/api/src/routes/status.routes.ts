import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

const VALID_STATUSES = ['unplayed', 'playing', 'completed', 'other'] as const;
type GameStatusValue = (typeof VALID_STATUSES)[number];

const FINISHED_STATUSES: GameStatusValue[] = ['completed'];

export async function statusRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // PUT /status/:gameId — upsert game_status
  app.put<{ Params: { gameId: string }; Body: { status?: string } }>(
    '/status/:gameId',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const { status } = request.body ?? {};
      if (!status || !(VALID_STATUSES as readonly string[]).includes(status)) {
        return reply.status(400).send({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }

      const uid = userId(request);
      const pool = getPool();

      const isFinished = FINISHED_STATUSES.includes(status as GameStatusValue);

      await pool.query(
        `INSERT INTO game_status (user_id, game_id, status, started_at, finished_at)
         VALUES (?, ?, ?, IF(? = 'playing', NOW(), NULL), IF(? = 'completed', NOW(), NULL))
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           started_at = IF(status = 'unplayed' AND VALUES(status) = 'playing', NOW(), started_at),
           finished_at = IF(VALUES(status) = 'completed' AND finished_at IS NULL, NOW(), finished_at)`,
        [uid, gameId, status, status, status],
      );

      if (status === 'completed') {
        await pool.query(
          `INSERT INTO game_completions (user_id, game_id, completed_at, source) VALUES (?, ?, NOW(), 'status_change')`,
          [uid, gameId],
        );
      }

      return { gameId, status };
    },
  );

  // DELETE /status/:gameId — reset to unplayed
  app.delete<{ Params: { gameId: string } }>('/status/:gameId', auth, async (request, reply) => {
    const gameId = Number(request.params.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return reply.status(400).send({ error: 'Invalid gameId' });
    }
    await getPool().query(
      `DELETE FROM game_status WHERE user_id = ? AND game_id = ?`,
      [userId(request), gameId],
    );
    return { deleted: true };
  });
}
