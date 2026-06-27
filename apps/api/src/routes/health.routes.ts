import { FastifyInstance } from 'fastify';
import { getPool } from '../db';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    try {
      await getPool().query('SELECT 1');
      return reply.send({ ok: true, uptime: process.uptime(), db: 'ok' });
    } catch {
      return reply.status(503).send({ ok: false, uptime: process.uptime(), db: 'error' });
    }
  });
}
