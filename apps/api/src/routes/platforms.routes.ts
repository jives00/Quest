import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import {
  listAccounts,
  upsertSteamAccount,
  upsertPsnAccount,
  upsertXboxAccount,
} from '../services/platforms.service';
import { runPsnSync } from '../services/psn-poll.service';
import { runXboxSync } from '../services/xbox-poll.service';
import { getOwnProfile, isXboxEnabled } from '../services/xbox.client';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function platformsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  app.get('/platforms', auth, async request => {
    return listAccounts(userId(request));
  });

  app.put<{ Body: { steamId64?: string; enabled?: boolean } }>(
    '/platforms/steam',
    auth,
    async (request, reply) => {
      const { steamId64, enabled = true } = request.body ?? {};
      if (!steamId64 || !/^\d{17}$/.test(steamId64)) {
        return reply.status(400).send({ error: 'steamId64 must be a 17-digit Steam ID' });
      }
      await upsertSteamAccount(userId(request), steamId64, enabled);
      return { platform: 'steam', steamId64, enabled };
    },
  );

  // Paste-and-go NPSSO: save, then kick an immediate background sync so the health
  // chip reflects whether the token actually works without waiting for the poller.
  app.put<{ Body: { npsso?: string; enabled?: boolean } }>(
    '/platforms/psn',
    auth,
    async (request, reply) => {
      const { npsso, enabled = true } = request.body ?? {};
      if (!npsso || npsso.length < 32) {
        return reply.status(400).send({ error: 'npsso must be the 64-char NPSSO token' });
      }
      await upsertPsnAccount(userId(request), npsso.trim(), enabled);
      void runPsnSync(userId(request)).catch(err =>
        request.log.error({ err }, 'Background PSN sync failed'),
      );
      return reply.status(202).send({ platform: 'psn', enabled, started: true });
    },
  );

  // Xbox: the OPENXBL_API_KEY is tied to the user's own account, so we derive the
  // XUID + gamertag straight from /account (no gamertag search). Surfaces the real
  // OpenXBL error (e.g. "Invalid API key") instead of a generic failure.
  app.put<{ Body: { enabled?: boolean } }>(
    '/platforms/xbox',
    auth,
    async (request, reply) => {
      const { enabled = true } = request.body ?? {};
      if (!isXboxEnabled()) {
        return reply.status(400).send({ error: 'OPENXBL_API_KEY is not configured (then restart the API)' });
      }
      let profile;
      try {
        profile = await getOwnProfile();
      } catch (err) {
        const msg = String(err);
        if (msg.includes('429')) {
          return reply.status(429).send({ error: 'OpenXBL is rate-limiting requests — wait a few minutes and try again' });
        }
        return reply.status(502).send({ error: `OpenXBL rejected the key: ${msg}` });
      }
      if (!profile) {
        return reply.status(404).send({ error: 'OpenXBL returned no account for this key' });
      }
      await upsertXboxAccount(userId(request), profile.xuid, profile.gamertag, enabled);
      void runXboxSync(userId(request)).catch(err =>
        request.log.error({ err }, 'Background Xbox sync failed'),
      );
      return reply.status(202).send({ platform: 'xbox', ...profile, enabled, started: true });
    },
  );
}
