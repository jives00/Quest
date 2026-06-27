import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import {
  getUserLists,
  getListGames,
  createCustomList,
  renameList,
  deleteList,
  addGameToList,
  removeGameFromList,
  reorderList,
} from '../services/lists.service';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

function handleServiceError(err: unknown, reply: import('fastify').FastifyReply): void {
  const e = err as { message?: string; statusCode?: number };
  const code = e.statusCode ?? 500;
  if (code === 403) { reply.status(403).send({ error: e.message }); return; }
  if (code === 404) { reply.status(404).send({ error: e.message }); return; }
  throw err;
}

export async function listsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /lists — all user's lists with item counts
  app.get('/lists', auth, async request => {
    return getUserLists(userId(request));
  });

  // GET /lists/:id — games in a list
  app.get<{ Params: { id: string } }>('/lists/:id', auth, async (request, reply) => {
    const listId = Number(request.params.id);
    if (!Number.isInteger(listId) || listId <= 0) {
      return reply.status(400).send({ error: 'Invalid listId' });
    }
    const uid = userId(request);
    const list = (await getUserLists(uid)).find(l => l.id === listId);
    if (!list) return reply.status(404).send({ error: 'List not found' });
    const games = await getListGames(uid, listId);
    return { list, games };
  });

  // POST /lists — create a custom list
  app.post<{ Body: { name?: string } }>('/lists', auth, async (request, reply) => {
    const { name } = request.body ?? {};
    if (typeof name !== 'string' || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' });
    }
    const id = await createCustomList(userId(request), name.trim());
    return reply.status(201).send({ id, name: name.trim() });
  });

  // PATCH /lists/:id — rename (custom only)
  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/lists/:id',
    auth,
    async (request, reply) => {
      const listId = Number(request.params.id);
      if (!Number.isInteger(listId) || listId <= 0) {
        return reply.status(400).send({ error: 'Invalid listId' });
      }
      const { name } = request.body ?? {};
      if (typeof name !== 'string' || name.trim() === '') {
        return reply.status(400).send({ error: 'name is required' });
      }
      try {
        await renameList(userId(request), listId, name.trim());
        return { id: listId, name: name.trim() };
      } catch (err) {
        handleServiceError(err, reply);
      }
    },
  );

  // DELETE /lists/:id — delete (custom only)
  app.delete<{ Params: { id: string } }>('/lists/:id', auth, async (request, reply) => {
    const listId = Number(request.params.id);
    if (!Number.isInteger(listId) || listId <= 0) {
      return reply.status(400).send({ error: 'Invalid listId' });
    }
    try {
      await deleteList(userId(request), listId);
      return { deleted: true };
    } catch (err) {
      handleServiceError(err, reply);
    }
  });

  // POST /lists/:id/items — add a game (blocks platform lists)
  app.post<{ Params: { id: string }; Body: { gameId?: number } }>(
    '/lists/:id/items',
    auth,
    async (request, reply) => {
      const listId = Number(request.params.id);
      const { gameId } = request.body ?? {};
      if (!Number.isInteger(listId) || listId <= 0) {
        return reply.status(400).send({ error: 'Invalid listId' });
      }
      if (!Number.isInteger(gameId) || (gameId ?? 0) <= 0) {
        return reply.status(400).send({ error: 'gameId must be a positive integer' });
      }
      try {
        await addGameToList(userId(request), listId, gameId!);
        return reply.status(201).send({ listId, gameId });
      } catch (err) {
        handleServiceError(err, reply);
      }
    },
  );

  // DELETE /lists/:id/items/:gameId — remove a game (blocks platform lists)
  app.delete<{ Params: { id: string; gameId: string } }>(
    '/lists/:id/items/:gameId',
    auth,
    async (request, reply) => {
      const listId = Number(request.params.id);
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(listId) || listId <= 0) {
        return reply.status(400).send({ error: 'Invalid listId' });
      }
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      try {
        await removeGameFromList(userId(request), listId, gameId);
        return { deleted: true };
      } catch (err) {
        handleServiceError(err, reply);
      }
    },
  );

  // PUT /lists/:id/reorder — update sort_order from gameIds array
  app.put<{ Params: { id: string }; Body: { gameIds?: number[] } }>(
    '/lists/:id/reorder',
    auth,
    async (request, reply) => {
      const listId = Number(request.params.id);
      if (!Number.isInteger(listId) || listId <= 0) {
        return reply.status(400).send({ error: 'Invalid listId' });
      }
      const { gameIds } = request.body ?? {};
      if (!Array.isArray(gameIds) || gameIds.some(id => !Number.isInteger(id) || id <= 0)) {
        return reply.status(400).send({ error: 'gameIds must be an array of positive integers' });
      }
      try {
        await reorderList(userId(request), listId, gameIds);
        return { reordered: true };
      } catch (err) {
        handleServiceError(err, reply);
      }
    },
  );
}
