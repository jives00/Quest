import { FastifyInstance, FastifyRequest } from 'fastify';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

function toSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export async function userPlatformsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  app.get('/user-platforms', auth, async (request) => {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT id, name, slug, sort_order AS sortOrder, created_at AS createdAt
       FROM user_platforms WHERE user_id = ? ORDER BY sort_order, name`,
      [userId(request)],
    );
    return rows;
  });

  app.post<{ Body: { name?: string } }>('/user-platforms', auth, async (request, reply) => {
    const name = (request.body?.name ?? '').trim();
    if (!name || name.length < 1 || name.length > 64) {
      return reply.status(400).send({ error: 'name must be 1–64 characters' });
    }
    const slug = toSlug(name);
    if (!slug) return reply.status(400).send({ error: 'Invalid platform name' });

    const uid = userId(request);
    try {
      const [res] = await getPool().query<ResultSetHeader>(
        `INSERT INTO user_platforms (user_id, name, slug) VALUES (?, ?, ?)`,
        [uid, name, slug],
      );
      return reply.status(201).send({ id: res.insertId, name, slug });
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        return reply.status(409).send({ error: 'A platform with that name already exists' });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; sortOrder?: number } }>(
    '/user-platforms/:id',
    auth,
    async (request, reply) => {
      const id = Number(request.params.id);
      const uid = userId(request);
      const { name, sortOrder } = request.body ?? {};

      const sets: string[] = [];
      const params: (string | number)[] = [];

      if (name !== undefined) {
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > 64) return reply.status(400).send({ error: 'Invalid name' });
        sets.push('name = ?', 'slug = ?');
        params.push(trimmed, toSlug(trimmed));
      }
      if (sortOrder !== undefined) {
        sets.push('sort_order = ?');
        params.push(sortOrder);
      }
      if (sets.length === 0) return reply.status(400).send({ error: 'Nothing to update' });

      params.push(uid, id);
      const [res] = await getPool().query<ResultSetHeader>(
        `UPDATE user_platforms SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`,
        params,
      );
      if (res.affectedRows === 0) return reply.status(404).send({ error: 'Platform not found' });
      return { updated: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/user-platforms/:id', auth, async (request, reply) => {
    const id = Number(request.params.id);
    const [res] = await getPool().query<ResultSetHeader>(
      `DELETE FROM user_platforms WHERE user_id = ? AND id = ?`,
      [userId(request), id],
    );
    if (res.affectedRows === 0) return reply.status(404).send({ error: 'Platform not found' });
    return { deleted: true };
  });
}
