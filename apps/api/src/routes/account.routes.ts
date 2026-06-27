import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { findUserById, updateUsername, updatePassword } from '../services/auth.service';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function accountRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  app.get('/auth/me', auth, async (request, reply) => {
    const user = await findUserById(userId(request));
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return { id: user.id, username: user.username };
  });

  app.patch<{ Body: { newUsername?: string; currentPassword?: string; newPassword?: string } }>(
    '/auth/me',
    auth,
    async (request, reply) => {
      const uid = userId(request);
      const { newUsername, currentPassword, newPassword } = request.body ?? {};

      if (newUsername !== undefined) {
        const trimmed = newUsername.trim();
        if (!trimmed || trimmed.length < 2 || trimmed.length > 64) {
          return reply.status(400).send({ error: 'Username must be 2–64 characters' });
        }
        try {
          await updateUsername(uid, trimmed);
        } catch (err) {
          return reply.status(409).send({ error: err instanceof Error ? err.message : 'Failed' });
        }
      }

      if (newPassword !== undefined) {
        if (!currentPassword) {
          return reply.status(400).send({ error: 'currentPassword is required to set a new password' });
        }
        if (newPassword.length < 8) {
          return reply.status(400).send({ error: 'New password must be at least 8 characters' });
        }
        try {
          await updatePassword(uid, currentPassword, newPassword);
        } catch (err) {
          return reply.status(400).send({ error: err instanceof Error ? err.message : 'Failed' });
        }
      }

      return { updated: true };
    },
  );
}
