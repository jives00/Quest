import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { getStats, getYearStats, getAvailableYears, getRecentActivity } from '../services/stats.service';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function statsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  app.get<{ Querystring: { tz?: string } }>('/stats', auth, async request => {
    const tzOffset = request.query.tz !== undefined ? Number(request.query.tz) : 0;
    return getStats(userId(request), tzOffset);
  });

  app.get('/stats/years', auth, async request => {
    return getAvailableYears(userId(request));
  });

  app.get<{ Params: { year: string } }>('/stats/year/:year', auth, async (request, reply) => {
    const year = Number(request.params.year);
    if (!Number.isInteger(year) || year < 1970 || year > 2100) {
      return reply.status(400).send({ error: 'Invalid year' });
    }
    return getYearStats(userId(request), year);
  });

  app.get('/stats/activity', auth, async request => {
    return getRecentActivity(userId(request));
  });
}
