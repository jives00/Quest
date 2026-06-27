import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { importLibrary, parseImportCsv, type ImportItem } from '../services/imports.service';
import { IMPORT_SOURCES, type ImportSource } from '../platforms';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

function isImportSource(s: string): s is ImportSource {
  return (IMPORT_SOURCES as string[]).includes(s);
}

export async function importsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // Accepts either { items: [{title, externalId?, acquiredAt?}] } or { csv: "..." }.
  // Matching the whole list against IGDB (4 req/s) outlasts an HTTP request, so we
  // fire-and-forget and surface progress via the Settings last-imported timestamp.
  app.post<{ Params: { source: string }; Body: { items?: ImportItem[]; csv?: string } }>(
    '/imports/:source',
    auth,
    async (request, reply) => {
      const { source } = request.params;
      if (!isImportSource(source)) {
        return reply.status(400).send({ error: `Not an import source: ${source}` });
      }

      const body = request.body ?? {};
      const items = body.items ?? (body.csv ? parseImportCsv(body.csv) : []);
      if (!items.length) {
        return reply.status(400).send({ error: 'Provide a non-empty `items` array or `csv` text' });
      }

      void importLibrary(userId(request), source, items).catch(err =>
        request.log.error({ err }, `Background ${source} import failed`),
      );
      return reply.status(202).send({ source, count: items.length, started: true });
    },
  );
}
