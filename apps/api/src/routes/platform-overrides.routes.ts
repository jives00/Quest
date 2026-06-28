import { FastifyInstance, FastifyRequest } from 'fastify';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';
import { ALL_PLATFORMS } from '../platforms';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function platformOverridesRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  app.get('/platform-overrides', auth, async (request) => {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT platform, name, icon FROM user_platform_overrides WHERE user_id = ?`,
      [userId(request)],
    );
    return rows;
  });

  app.put<{ Params: { platform: string }; Body: { name?: string | null; icon?: string | null } }>(
    '/platform-overrides/:platform',
    auth,
    async (request, reply) => {
      const { platform } = request.params;
      if (!(ALL_PLATFORMS as string[]).includes(platform)) {
        return reply.status(400).send({ error: 'Unknown platform' });
      }
      const name = request.body?.name != null ? request.body.name.trim() || null : null;
      const icon = request.body?.icon != null ? request.body.icon.trim() || null : null;
      await getPool().query(
        `INSERT INTO user_platform_overrides (user_id, platform, name, icon)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), icon = VALUES(icon)`,
        [userId(request), platform, name, icon],
      );
      return { updated: true };
    },
  );

  app.delete<{ Params: { platform: string } }>(
    '/platform-overrides/:platform',
    auth,
    async (request, reply) => {
      const { platform } = request.params;
      await getPool().query(
        `DELETE FROM user_platform_overrides WHERE user_id = ? AND platform = ?`,
        [userId(request), platform],
      );
      return { deleted: true };
    },
  );
}
