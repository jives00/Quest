import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import {
  createHistory,
  updateHistory,
  deleteHistory,
  getGameTimeline,
  type CreateHistoryInput,
} from '../services/history.service';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function historyRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // Unified per-game timeline (sessions + achievement clusters + manual + status).
  app.get<{ Params: { id: string } }>('/games/:id/timeline', auth, async request => {
    return getGameTimeline(userId(request), Number(request.params.id));
  });

  // Manual play-history memory CRUD.
  app.post<{ Body: CreateHistoryInput }>('/history', auth, async (request, reply) => {
    const body = request.body ?? ({} as CreateHistoryInput);
    if (!body.gameId) {
      return reply.status(400).send({ error: 'gameId is required' });
    }
    const id = await createHistory(userId(request), body);
    return reply.status(201).send({ id });
  });

  app.patch<{ Params: { id: string }; Body: Partial<CreateHistoryInput> }>(
    '/history/:id',
    auth,
    async (request, reply) => {
      const ok = await updateHistory(userId(request), Number(request.params.id), request.body ?? {});
      if (!ok) return reply.status(404).send({ error: 'Not found or no fields to update' });
      return { updated: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/history/:id', auth, async (request, reply) => {
    const ok = await deleteHistory(userId(request), Number(request.params.id));
    if (!ok) return reply.status(404).send({ error: 'Not found' });
    return { deleted: true };
  });
}
