import { FastifyInstance } from 'fastify';
import { authenticateScrobble } from '../middleware/auth';
import { DEFAULT_USER_ID } from '../services/now-playing.service';
import {
  markShortcutPlaying,
  recordShortcutSession,
} from '../services/steam-shortcuts.service';

// ---------------------------------------------------------------------------
// Ingest routes — reports pushed IN by an agent on a PC, rather than pulled by a
// poller. Authenticated with SCROBBLE_API_KEY (X-Api-Key), not a JWT: the agent
// runs unattended as a scheduled task and has no login session.
//
// Single-user app, so everything lands on DEFAULT_USER_ID.
// ---------------------------------------------------------------------------

interface HeartbeatBody {
  appId?: string | number;
  name?: string;
}

interface StopBody extends HeartbeatBody {
  startedAt?: string;
  endedAt?: string;
  clientUid?: string;
}

/** Steam shortcut appids are unsigned 32-bit. Accept the signed form too, since
 *  that is how they appear in localconfig.vdf, and normalize to unsigned. */
function normalizeAppId(raw: string | number | undefined): string | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  const unsigned = n < 0 ? n + 2 ** 32 : n;
  if (unsigned <= 0 || unsigned > 0xffffffff) return null;
  return String(unsigned);
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function ingestRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticateScrobble] };

  // POST /ingest/steam-shortcut/heartbeat — "this shortcut is running right now".
  // Called on a short interval while the game is up; now-playing goes stale on
  // its own if the agent dies, so no explicit teardown is required.
  app.post<{ Body: HeartbeatBody }>(
    '/ingest/steam-shortcut/heartbeat',
    auth,
    async (request, reply) => {
      const appId = normalizeAppId(request.body?.appId);
      const name = request.body?.name?.trim();
      if (!appId || !name) {
        return reply.status(400).send({ error: 'appId and name are required' });
      }

      const result = await markShortcutPlaying(DEFAULT_USER_ID, { appId, name });
      if (!result) return { ok: true, ignored: true };
      return { ok: true, gameId: result.gameId };
    },
  );

  // POST /ingest/steam-shortcut/stop — a completed session, with real start/end.
  // Safe to retry: clientUid dedupes at the DB level.
  app.post<{ Body: StopBody }>(
    '/ingest/steam-shortcut/stop',
    auth,
    async (request, reply) => {
      const appId = normalizeAppId(request.body?.appId);
      const name = request.body?.name?.trim();
      const startedAt = parseDate(request.body?.startedAt);
      const endedAt = parseDate(request.body?.endedAt);
      const clientUid = request.body?.clientUid?.trim();

      if (!appId || !name || !startedAt || !endedAt || !clientUid) {
        return reply.status(400).send({
          error: 'appId, name, startedAt, endedAt and clientUid are required',
        });
      }
      if (endedAt.getTime() <= startedAt.getTime()) {
        return reply.status(400).send({ error: 'endedAt must be after startedAt' });
      }

      const outcome = await recordShortcutSession(DEFAULT_USER_ID, {
        appId,
        name,
        startedAt,
        endedAt,
        clientUid,
      });

      if (outcome.status === 'recorded') {
        console.log(
          `🎮 non-Steam session: "${name}" (appid ${appId}) — ${outcome.minutes}min`,
        );
      }
      return { ok: true, ...outcome };
    },
  );
}
