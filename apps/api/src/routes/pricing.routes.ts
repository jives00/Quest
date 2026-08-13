import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import {
  clearPriceSourceOverride,
  getPricePriority,
  getPriceSourceOverrides,
  resolvePriceSource,
  setPricePriority,
  setPriceSourceOverride,
} from '../services/pricing.service';
import {
  ALL_PRICE_SOURCES,
  IMPLEMENTED_PRICE_SOURCES,
  PRICE_SOURCE_LABELS,
  PRICE_SOURCE_PROVIDERS,
  isPriceSource,
  isPriceSourceAvailable,
  isPriceSourceUnconfigured,
} from '../price-sources';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function pricingRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /pricing/sources — catalogue for the settings UI
  app.get('/pricing/sources', auth, async () =>
    ALL_PRICE_SOURCES.map((s) => ({
      source: s,
      label: PRICE_SOURCE_LABELS[s],
      provider: PRICE_SOURCE_PROVIDERS[s],
      implemented: IMPLEMENTED_PRICE_SOURCES.includes(s),
      unconfigured: isPriceSourceUnconfigured(s),
      supported: isPriceSourceAvailable(s),
    })),
  );

  // GET /pricing/priority — global fallback order
  app.get('/pricing/priority', auth, async (request) => ({
    order: await getPricePriority(userId(request)),
  }));

  // PUT /pricing/priority — replace the order
  app.put<{ Body: { order?: unknown } }>('/pricing/priority', auth, async (request, reply) => {
    const order = request.body?.order;
    if (!Array.isArray(order) || !order.every(isPriceSource)) {
      return reply.status(400).send({ error: 'order must be an array of price sources' });
    }
    return { order: await setPricePriority(userId(request), order) };
  });

  // GET /pricing/overrides — every per-game override
  app.get('/pricing/overrides', auth, async (request) => getPriceSourceOverrides(userId(request)));

  // GET /pricing/overrides/:gameId — the resolution for one game
  app.get<{ Params: { gameId: string } }>(
    '/pricing/overrides/:gameId',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      return resolvePriceSource(userId(request), gameId);
    },
  );

  // PUT /pricing/overrides/:gameId — pin a source for one game
  app.put<{ Params: { gameId: string }; Body: { source?: unknown } }>(
    '/pricing/overrides/:gameId',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const source = request.body?.source;
      if (!isPriceSource(source)) {
        return reply.status(400).send({ error: 'Unknown price source' });
      }
      await setPriceSourceOverride(userId(request), gameId, source);
      return { updated: true };
    },
  );

  // DELETE /pricing/overrides/:gameId — fall back to the global order
  app.delete<{ Params: { gameId: string } }>(
    '/pricing/overrides/:gameId',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      await clearPriceSourceOverride(userId(request), gameId);
      return { deleted: true };
    },
  );
}
