import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import {
  getStats, getYearStats, getAvailableYears, getRecentActivity, getActivityPage,
  type ActivityEventType,
} from '../services/stats.service';

const ACTIVITY_TYPES: ActivityEventType[] = ['session', 'achievement', 'completion', 'status', 'wishlist', 'backlog', 'ownership'];

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

  app.get<{ Querystring: { type?: string; gameId?: string; page?: string; limit?: string } }>(
    '/activity',
    auth,
    async (request, reply) => {
      const { type, gameId: gameIdStr, page: pageStr, limit: limitStr } = request.query;
      if (type !== undefined && !ACTIVITY_TYPES.includes(type as ActivityEventType)) {
        return reply.status(400).send({ error: 'Invalid type' });
      }
      const gameId = gameIdStr ? Number(gameIdStr) : undefined;
      if (gameIdStr !== undefined && (!Number.isInteger(gameId) || gameId! <= 0)) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const page = pageStr ? parseInt(pageStr, 10) : undefined;
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;

      return getActivityPage(userId(request), {
        type: type as ActivityEventType | undefined,
        gameId,
        page,
        limit,
      });
    },
  );
}
