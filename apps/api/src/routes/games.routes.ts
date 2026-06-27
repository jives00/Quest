import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import {
  searchIgdbGames,
  materializeGame,
  getGameDetail,
  updateGameMetadata,
  getArtworkCandidates,
  getGameTitle,
  enrichGame,
  setHidden,
  setVr,
  getWishlistPrice,
  deleteGame,
  setManualPlaytime,
  type GameMetadataPatch,
} from '../services/games.service';
import { rematchGame, RematchConflictError } from '../services/matching.service';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function gamesRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // DELETE /games/:id — permanently remove a game and all user data for it
  app.delete<{ Params: { id: string } }>('/games/:id', auth, async (request, reply) => {
    const gameId = Number(request.params.id);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return reply.status(400).send({ error: 'Invalid gameId' });
    }
    const deleted = await deleteGame(gameId);
    if (!deleted) return reply.status(404).send({ error: 'Game not found' });
    return reply.status(204).send();
  });

  // GET /games/search?q= — IGDB search, does NOT persist
  app.get<{ Querystring: { q?: string } }>('/games/search', auth, async (request, reply) => {
    const { q } = request.query;
    if (!q || q.trim() === '') return reply.status(400).send({ error: 'q is required' });
    return searchIgdbGames(q.trim());
  });

  // POST /games body { igdbId } — materialize a game row
  app.post<{ Body: { igdbId?: number } }>('/games', auth, async (request, reply) => {
    const { igdbId } = request.body ?? {};
    if (!Number.isInteger(igdbId) || (igdbId ?? 0) <= 0) {
      return reply.status(400).send({ error: 'igdbId must be a positive integer' });
    }
    try {
      const id = await materializeGame(igdbId!);
      return reply.status(201).send({ id });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('not found')) return reply.status(404).send({ error: msg });
      throw err;
    }
  });

  // GET /games/:id — full detail aggregate
  app.get<{ Params: { id: string } }>('/games/:id', auth, async (request, reply) => {
    const gameId = Number(request.params.id);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return reply.status(400).send({ error: 'Invalid gameId' });
    }
    const detail = await getGameDetail(userId(request), gameId);
    if (!detail) return reply.status(404).send({ error: 'Game not found' });
    return detail;
  });

  // PATCH /games/:id/metadata — manual metadata edits (artwork, summary, tags…)
  app.patch<{ Params: { id: string }; Body: GameMetadataPatch }>(
    '/games/:id/metadata',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      try {
        const existed = await updateGameMetadata(gameId, request.body ?? {});
        if (!existed) return reply.status(404).send({ error: 'Game not found' });
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      const detail = await getGameDetail(userId(request), gameId);
      if (!detail) return reply.status(404).send({ error: 'Game not found' });
      return detail;
    },
  );

  // POST /games/:id/rematch body { igdbId } — fix a wrong auto-match
  app.post<{ Params: { id: string }; Body: { igdbId?: number } }>(
    '/games/:id/rematch',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const { igdbId } = request.body ?? {};
      if (!Number.isInteger(igdbId) || (igdbId ?? 0) <= 0) {
        return reply.status(400).send({ error: 'igdbId must be a positive integer' });
      }
      try {
        await rematchGame(gameId, igdbId!);
      } catch (err) {
        if (err instanceof RematchConflictError) {
          return reply.status(409).send({ error: err.message, existingGameId: err.existingGameId });
        }
        const msg = (err as Error).message ?? '';
        if (msg.includes('not found')) return reply.status(404).send({ error: msg });
        throw err;
      }
      const detail = await getGameDetail(userId(request), gameId);
      if (!detail) return reply.status(404).send({ error: 'Game not found' });
      return detail;
    },
  );

  // GET /games/:id/artwork?q= — candidate cover/hero images for the editor
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/games/:id/artwork',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      let query = request.query.q?.trim();
      if (!query) {
        const title = await getGameTitle(gameId);
        if (!title) return reply.status(404).send({ error: 'Game not found' });
        query = title;
      }
      return getArtworkCandidates(query);
    },
  );

  // POST /games/:id/enrich — fetch Steam store data + HLTB and persist
  app.post<{ Params: { id: string } }>(
    '/games/:id/enrich',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const found = await enrichGame(gameId, userId(request));
      if (!found) return reply.status(404).send({ error: 'Game not found' });
      const detail = await getGameDetail(userId(request), gameId);
      if (!detail) return reply.status(404).send({ error: 'Game not found' });
      return detail;
    },
  );

  // PUT /games/:id/hidden body { hidden: boolean } — hide/unhide a game
  app.put<{ Params: { id: string }; Body: { hidden?: boolean } }>(
    '/games/:id/hidden',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const { hidden } = request.body ?? {};
      if (typeof hidden !== 'boolean') {
        return reply.status(400).send({ error: 'hidden must be a boolean' });
      }
      await setHidden(userId(request), gameId, hidden);
      const detail = await getGameDetail(userId(request), gameId);
      if (!detail) return reply.status(404).send({ error: 'Game not found' });
      return detail;
    },
  );

  // PUT /games/:id/vr body { vr: boolean } — manually set/clear VR flag
  app.put<{ Params: { id: string }; Body: { vr?: boolean } }>(
    '/games/:id/vr',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const { vr } = request.body ?? {};
      if (typeof vr !== 'boolean') {
        return reply.status(400).send({ error: 'vr must be a boolean' });
      }
      await setVr(gameId, vr);
      const detail = await getGameDetail(userId(request), gameId);
      if (!detail) return reply.status(404).send({ error: 'Game not found' });
      return detail;
    },
  );

  // PUT /games/:id/playtime/manual — set or clear a manual playtime entry
  app.put<{ Params: { id: string }; Body: { minutes?: number | null } }>(
    '/games/:id/playtime/manual',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const { minutes } = request.body ?? {};
      if (minutes !== null && minutes !== undefined && (typeof minutes !== 'number' || minutes < 0)) {
        return reply.status(400).send({ error: 'minutes must be a non-negative number or null' });
      }
      await setManualPlaytime(userId(request), gameId, minutes ?? null);
      const detail = await getGameDetail(userId(request), gameId);
      if (!detail) return reply.status(404).send({ error: 'Game not found' });
      return detail;
    },
  );

  // GET /games/:id/price — ITAD wishlist price
  app.get<{ Params: { id: string }; Querystring: { country?: string } }>(
    '/games/:id/price',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const price = await getWishlistPrice(gameId, request.query.country);
      if (!price) return reply.status(404).send({ error: 'Price not available' });
      return price;
    },
  );
}
