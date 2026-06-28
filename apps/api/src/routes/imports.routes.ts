import { FastifyInstance, FastifyRequest } from 'fastify';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { importLibrary, importCustomLibrary, parseImportCsv, type ImportItem } from '../services/imports.service';
import { ALL_PLATFORMS, type Platform } from '../platforms';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

function isPlatform(s: string): s is Platform {
  return (ALL_PLATFORMS as string[]).includes(s);
}

export async function importsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // Accepts either { items: [{title, externalId?, acquiredAt?}] } or { csv: "..." }.
  // source is a built-in platform slug OR a numeric custom platform ID.
  app.post<{ Params: { source: string }; Body: { items?: ImportItem[]; csv?: string } }>(
    '/imports/:source',
    auth,
    async (request, reply) => {
      const { source } = request.params;
      const uid = userId(request);

      const body = request.body ?? {};
      const items = body.items ?? (body.csv ? parseImportCsv(body.csv) : []);
      if (!items.length) {
        return reply.status(400).send({ error: 'Provide a non-empty `items` array or `csv` text' });
      }

      // Custom platform: source is a numeric ID
      const customPlatformId = Number(source);
      if (!isNaN(customPlatformId) && Number.isInteger(customPlatformId) && customPlatformId > 0) {
        const [rows] = await getPool().query<RowDataPacket[]>(
          `SELECT id FROM user_platforms WHERE id = ? AND user_id = ?`,
          [customPlatformId, uid],
        );
        if (!rows.length) return reply.status(404).send({ error: 'Platform not found' });

        void importCustomLibrary(uid, customPlatformId, items).catch(err =>
          request.log.error({ err }, `Background custom-platform-${customPlatformId} import failed`),
        );
        return reply.status(202).send({ source, count: items.length, started: true });
      }

      if (!isPlatform(source)) {
        return reply.status(400).send({ error: `Unknown platform: ${source}` });
      }

      void importLibrary(uid, source, items).catch(err =>
        request.log.error({ err }, `Background ${source} import failed`),
      );
      return reply.status(202).send({ source, count: items.length, started: true });
    },
  );
}
