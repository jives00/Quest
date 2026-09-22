import { FastifyInstance, FastifyRequest } from 'fastify';
import { GAME_STATUSES, LEGACY_STATUS_ALIASES, isGameStatus } from '@quest/types';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';
import { setStatus } from '../services/status.service';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

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
      const raw = request.body?.status;

      // Tolerant window: Watchtower ships the API within ~5 min of a merge but
      // the phone only updates on an `apk-*` tag, so an older build is still
      // sending `other` until then. Coerce instead of 400-ing it. Drop the
      // alias (and this comment) once the new APK is installed.
      const status = raw && !isGameStatus(raw) ? LEGACY_STATUS_ALIASES[raw] : raw;

      if (!status || !isGameStatus(status)) {
        return reply
          .status(400)
          .send({ error: `status must be one of: ${GAME_STATUSES.join(', ')}` });
      }

      await setStatus(userId(request), gameId, status, 'manual');
      return { gameId, status };
    },
  );

  // DELETE /status/:gameId — clear the status entirely (back to no opinion)
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
