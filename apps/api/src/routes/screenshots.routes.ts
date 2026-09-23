import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UiBox } from '@quest/types';
import { authenticate, authenticateScrobble, isTrustedRequest } from '../middleware/auth';
import { normalizeAppId } from '../utils/steam-appid';
import { isValidBox } from '../services/screenshot-analysis';
import {
  ExportError,
  applyMaskChange,
  bulkUpdate,
  detectQueue,
  exportGame,
  getGameScreenshots,
  imagePath,
  inboxCount,
  ingestScreenshot,
  inpaintQueue,
  listInbox,
  markInpaintFailed,
  requeueInpaint,
  maskPng,
  saveCleaned,
  setExportName,
  type ImageKind,
} from '../services/screenshots.service';

// ---------------------------------------------------------------------------
// Screenshot pipeline routes.
//
// /ingest/* is the gaming-PC agent (tools/screenshot-sync/), X-Api-Key auth like
// the shortcut watcher. Images travel as raw image/jpeg bodies with metadata in
// the query string, which keeps both PowerShell 5.1 (no -Form) and Fastify free
// of multipart handling.
//
// The image GETs are loaded by plain <img> tags, which cannot send a Bearer
// token, so they also accept trusted-network requests (the browser→Next→API
// proxy path always is one).
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

function positiveInt(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Steam names shots "YYYYMMDDHHMMSS_N.jpg"; the agent sends that stamp or ISO. */
function parseTakenAt(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
    : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseBoxList(raw: unknown, kind?: UiBox['kind']): UiBox[] | null {
  if (!Array.isArray(raw) || raw.length > 200) return null;
  if (!raw.every(isValidBox)) return null;
  return raw.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, ...(kind ? { kind } : b.kind ? { kind: b.kind } : {}) }));
}

async function authenticateImage(request: FastifyRequest, reply: FastifyReply) {
  if (isTrustedRequest(request)) return;
  return authenticate(request, reply);
}

export async function screenshotsRoutes(app: FastifyInstance) {
  const agent = { preHandler: [authenticateScrobble] };
  const auth = { preHandler: [authenticate] };
  const image = { preHandler: [authenticateImage] };

  app.addContentTypeParser(
    ['image/jpeg', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => done(null, body),
  );

  // ── Agent ────────────────────────────────────────────────────────────────

  // POST /ingest/screenshot?appId=&takenAt=&sha256=&name= — raw JPEG body.
  // Idempotent on the content hash.
  app.post<{ Querystring: { appId?: string; takenAt?: string; sha256?: string; name?: string } }>(
    '/ingest/screenshot',
    agent,
    async (request, reply) => {
      const appId = normalizeAppId(request.query.appId);
      const takenAt = parseTakenAt(request.query.takenAt);
      const buf = request.body as Buffer | undefined;
      if (!appId || !takenAt) return reply.status(400).send({ error: 'appId and takenAt are required' });
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return reply.status(400).send({ error: 'body must be a raw image/jpeg' });
      }

      const outcome = await ingestScreenshot({
        buf,
        appId,
        takenAt,
        name: request.query.name,
        sha256: request.query.sha256,
      });
      switch (outcome.status) {
        case 'hash_mismatch':
          return reply.status(400).send({ error: 'sha256 does not match the body', ...outcome });
        case 'unresolved':
          // The agent keeps these and retries later (e.g. once the shortcut
          // watcher has resolved a non-Steam game).
          return reply.status(422).send({ error: 'could not resolve appId to a game', ...outcome });
        case 'created':
          console.log(`📸 screenshot ${outcome.id} for game ${outcome.gameId} (appid ${appId})`);
          return outcome;
        default:
          return outcome;
      }
    },
  );

  // GET /ingest/screenshots/detect-queue — shots the text detector hasn't seen.
  app.get('/ingest/screenshots/detect-queue', agent, async () => ({ items: await detectQueue() }));

  // POST /ingest/screenshot/:id/ui-boxes — { boxes: UiBox[] } from detect.py (may be empty).
  app.post<{ Params: { id: string }; Body: { boxes?: unknown } }>(
    '/ingest/screenshot/:id/ui-boxes',
    agent,
    async (request, reply) => {
      const id = positiveInt(request.params.id);
      const boxes = parseBoxList(request.body?.boxes);
      if (!id || !boxes) return reply.status(400).send({ error: 'id and a valid boxes array are required' });
      await applyMaskChange(id, { uiBoxes: boxes });
      return { ok: true };
    },
  );

  // GET /ingest/screenshots/inpaint-queue — shots whose current mask has no clean yet.
  app.get('/ingest/screenshots/inpaint-queue', agent, async () => ({ items: await inpaintQueue() }));

  // GET /ingest/screenshot/:id/mask.png — full-res mask, white = paint out.
  app.get<{ Params: { id: string } }>('/ingest/screenshot/:id/mask.png', agent, async (request, reply) => {
    const id = positiveInt(request.params.id);
    const mask = id ? await maskPng(id) : null;
    if (!mask) return reply.status(404).send({ error: 'Not found' });
    return reply.header('X-Mask-Version', String(mask.maskVersion)).type('image/png').send(mask.png);
  });

  // POST /ingest/screenshot/:id/cleaned?maskVersion= — raw JPEG body from inpaint.py.
  app.post<{ Params: { id: string }; Querystring: { maskVersion?: string } }>(
    '/ingest/screenshot/:id/cleaned',
    agent,
    async (request, reply) => {
      const id = positiveInt(request.params.id);
      const version = Number(request.query.maskVersion);
      const buf = request.body as Buffer | undefined;
      if (!id || !Number.isInteger(version) || !Buffer.isBuffer(buf) || !buf.length) {
        return reply.status(400).send({ error: 'id, maskVersion and a raw image/jpeg body are required' });
      }
      const outcome = await saveCleaned(id, buf, version);
      if (outcome === 'not_found') return reply.status(404).send({ error: 'Not found' });
      return { ok: true, outcome };
    },
  );

  // POST /ingest/screenshot/:id/inpaint-failed — { maskVersion, reason }
  app.post<{ Params: { id: string }; Body: { maskVersion?: number; reason?: string } }>(
    '/ingest/screenshot/:id/inpaint-failed',
    agent,
    async (request, reply) => {
      const id = positiveInt(request.params.id);
      const version = Number(request.body?.maskVersion);
      if (!id || !Number.isInteger(version)) return reply.status(400).send({ error: 'id and maskVersion are required' });
      await markInpaintFailed(id, version, String(request.body?.reason ?? 'unknown').slice(0, 500));
      return { ok: true };
    },
  );

  // ── Review ───────────────────────────────────────────────────────────────

  app.get('/screenshots/inbox', auth, async () => ({ items: await listInbox() }));

  app.get('/screenshots/inbox/count', auth, async () => inboxCount());

  app.get<{ Params: { id: string } }>('/games/:id/screenshots', auth, async (request, reply) => {
    const gameId = positiveInt(request.params.id);
    const result = gameId ? await getGameScreenshots(gameId) : null;
    if (!result) return reply.status(404).send({ error: 'Game not found' });
    return result;
  });

  // PATCH /screenshots — bulk { ids, status?, exportVariant? }
  app.patch<{ Body: { ids?: unknown; status?: string; exportVariant?: string } }>(
    '/screenshots',
    auth,
    async (request, reply) => {
      const { ids, status, exportVariant } = request.body ?? {};
      if (!Array.isArray(ids) || !ids.length || !ids.every((i) => positiveInt(i) != null)) {
        return reply.status(400).send({ error: 'ids must be a non-empty array of ids' });
      }
      if (status !== undefined && status !== 'keep' && status !== 'reject') {
        return reply.status(400).send({ error: "status must be 'keep' or 'reject'" });
      }
      if (exportVariant !== undefined && exportVariant !== 'original' && exportVariant !== 'cleaned') {
        return reply.status(400).send({ error: "exportVariant must be 'original' or 'cleaned'" });
      }
      const updated = await bulkUpdate(ids as number[], { status, exportVariant });
      return { updated };
    },
  );

  // POST /screenshots/requeue — { ids } back onto the inpaint queue, mask unchanged.
  app.post<{ Body: { ids?: unknown } }>('/screenshots/requeue', auth, async (request, reply) => {
    const ids = request.body?.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every((i) => positiveInt(i) != null)) {
      return reply.status(400).send({ error: 'ids must be a non-empty array of ids' });
    }
    return { requeued: await requeueInpaint(ids as number[]) };
  });

  // PUT /screenshots/:id/manual-boxes — { boxes } drawn in the lightbox; re-queues the fill.
  app.put<{ Params: { id: string }; Body: { boxes?: unknown } }>(
    '/screenshots/:id/manual-boxes',
    auth,
    async (request, reply) => {
      const id = positiveInt(request.params.id);
      const boxes = parseBoxList(request.body?.boxes, 'manual');
      if (!id || !boxes) return reply.status(400).send({ error: 'id and a valid boxes array are required' });
      const changed = await applyMaskChange(id, { manualBoxes: boxes });
      return { changed };
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string | null } }>(
    '/games/:id/screenshot-export-name',
    auth,
    async (request, reply) => {
      const gameId = positiveInt(request.params.id);
      if (!gameId) return reply.status(400).send({ error: 'Invalid game id' });
      const name = request.body?.name;
      if (name != null && (typeof name !== 'string' || name.length > 200)) {
        return reply.status(400).send({ error: 'name must be a string' });
      }
      await setExportName(gameId, name ?? null);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>('/games/:id/screenshots/export', auth, async (request, reply) => {
    const gameId = positiveInt(request.params.id);
    if (!gameId) return reply.status(400).send({ error: 'Invalid game id' });
    try {
      const result = await exportGame(gameId);
      console.log(`🖼️  exported ${result.exported} screenshot(s) for game ${gameId}, purged ${result.purged}`);
      return result;
    } catch (err) {
      if (err instanceof ExportError) return reply.status(409).send({ error: err.message });
      throw err;
    }
  });

  // ── Images ───────────────────────────────────────────────────────────────

  const IMAGE_TYPES: Record<ImageKind, string> = {
    thumb: 'image/webp',
    'clean-thumb': 'image/webp',
    full: 'image/jpeg',
    clean: 'image/jpeg',
  };

  for (const kind of Object.keys(IMAGE_TYPES) as ImageKind[]) {
    app.get<{ Params: { id: string } }>(`/screenshots/:id/${kind}`, image, async (request, reply) => {
      const id = positiveInt(request.params.id);
      const file = id ? await imagePath(id, kind) : null;
      if (!file) return reply.status(404).send({ error: 'Not found' });
      try {
        await fs.access(file);
      } catch {
        return reply.status(404).send({ error: 'File missing' });
      }
      // Originals and their thumbnails never change. A cleaned copy is overwritten
      // in place on every re-clean -- including a retry with an unchanged mask,
      // where the ?v=<maskVersion> cache-buster stays the same -- so it must be
      // revalidated, or the browser keeps showing the previous attempt.
      const cleaned = kind === 'clean' || kind === 'clean-thumb';
      return reply
        .type(IMAGE_TYPES[kind])
        .header('Cache-Control', cleaned ? 'no-cache' : 'private, max-age=86400')
        .send(createReadStream(file));
    });
  }

  app.get<{ Params: { id: string } }>('/screenshots/:id/mask.png', image, async (request, reply) => {
    const id = positiveInt(request.params.id);
    const mask = id ? await maskPng(id) : null;
    if (!mask) return reply.status(404).send({ error: 'Not found' });
    return reply
      .type('image/png')
      .header('Content-Disposition', `attachment; filename="screenshot-${id}-mask.png"`)
      .send(mask.png);
  });
}
