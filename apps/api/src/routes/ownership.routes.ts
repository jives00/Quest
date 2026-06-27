import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';
import { recordOwnership } from '../services/library.service';
import { ALL_PLATFORMS, type Platform } from '../platforms';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

const VALID_PLATFORMS: readonly string[] = ALL_PLATFORMS;

export async function ownershipRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // POST /ownership — record ownership of a game on a platform
  app.post<{ Body: { gameId?: number; platform?: string } }>(
    '/ownership',
    auth,
    async (request, reply) => {
      const { gameId, platform } = request.body ?? {};
      if (!Number.isInteger(gameId) || (gameId ?? 0) <= 0) {
        return reply.status(400).send({ error: 'gameId must be a positive integer' });
      }
      if (!platform || !(VALID_PLATFORMS as readonly string[]).includes(platform)) {
        return reply.status(400).send({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` });
      }
      // Clear any suppression so the platform is no longer blocked from syncing
      await getPool().query(
        `DELETE FROM ownership_suppressions WHERE user_id = ? AND game_id = ? AND platform = ?`,
        [userId(request), gameId, platform],
      );
      await recordOwnership(userId(request), gameId!, platform as Platform);
      return reply.status(201).send({ gameId, platform });
    },
  );

  // DELETE /ownership/:gameId/:platform — remove ownership
  app.delete<{ Params: { gameId: string; platform: string } }>(
    '/ownership/:gameId/:platform',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      const { platform } = request.params;
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      if (!(VALID_PLATFORMS as readonly string[]).includes(platform)) {
        return reply.status(400).send({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` });
      }
      const [res] = await getPool().query<import('mysql2/promise').ResultSetHeader>(
        `DELETE FROM ownership WHERE user_id = ? AND game_id = ? AND platform = ?`,
        [userId(request), gameId, platform],
      );
      if (res.affectedRows === 0) return reply.status(404).send({ error: 'Ownership not found' });
      // Suppress this platform so pollers don't re-add it automatically
      await getPool().query(
        `INSERT IGNORE INTO ownership_suppressions (user_id, game_id, platform) VALUES (?, ?, ?)`,
        [userId(request), gameId, platform],
      );
      return { deleted: true };
    },
  );
}
