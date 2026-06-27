import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { runSteamSync } from '../services/steam-poll.service';
import { runPsnSync } from '../services/psn-poll.service';
import { runXboxSync } from '../services/xbox-poll.service';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

// Background-runnable manual syncs per polling platform. Each far outlasts an HTTP
// request (the first run matches every title against IGDB at the throttle), so we
// fire-and-forget and let the Settings health chip / last-synced update on completion.
const RUNNERS: Record<string, (userId: number) => Promise<unknown>> = {
  steam: runSteamSync,
  psn: runPsnSync,
  xbox: runXboxSync,
};

export async function syncRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  app.post<{ Params: { platform: string } }>(
    '/sync/:platform',
    auth,
    async (request, reply) => {
      const { platform } = request.params;
      const runner = RUNNERS[platform];
      if (!runner) {
        return reply.status(400).send({ error: 'Unknown or non-pollable platform' });
      }
      void runner(userId(request)).catch(err =>
        request.log.error({ err }, `Background ${platform} sync failed`),
      );
      return reply.status(202).send({ platform, started: true });
    },
  );
}
