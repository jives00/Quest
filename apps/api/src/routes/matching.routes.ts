import { FastifyInstance, FastifyRequest } from 'fastify';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';
import { manualMatch, findDuplicateCandidates, mergeGames, ignoreDuplicatePair } from '../services/matching.service';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

function sourceToPlatform(source: string): string {
  if (source === 'steam_appid') return 'steam';
  if (source === 'psn_concept') return 'psn';
  return source;
}

export async function matchingRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /matching/provisional — games with match_status='provisional' + their external ids
  app.get('/matching/provisional', auth, async () => {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id, g.title, g.cover_path AS coverPath,
              JSON_ARRAYAGG(
                JSON_OBJECT('source', e.source, 'externalId', e.external_id)
              ) AS externalIds
         FROM games g
         LEFT JOIN external_game_ids e ON e.game_id = g.id
        WHERE g.match_status = 'provisional'
        GROUP BY g.id, g.title, g.cover_path
        ORDER BY g.title`,
    );
    return rows.map(r => {
      const externalIds = r.externalIds
        ? (typeof r.externalIds === 'string'
            ? (JSON.parse(r.externalIds) as Array<{ source: string; externalId: string }>)
            : (r.externalIds as Array<{ source: string; externalId: string }>))
        : [];
      const first = externalIds.find(e => e && e.source) ?? { source: '', externalId: '' };
      return {
        gameId: r.id as number,
        title: r.title as string,
        coverPath: r.coverPath as string | null,
        platform: sourceToPlatform(first.source),
        externalId: first.externalId,
      };
    });
  });

  // POST /matching/:gameId/resolve body { igdbId } — manual match
  app.post<{ Params: { gameId: string }; Body: { igdbId?: number } }>(
    '/matching/:gameId/resolve',
    auth,
    async (request, reply) => {
      const gameId = Number(request.params.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const { igdbId } = request.body ?? {};
      if (!Number.isInteger(igdbId) || (igdbId ?? 0) <= 0) {
        return reply.status(400).send({ error: 'igdbId must be a positive integer' });
      }
      try {
        await manualMatch(gameId, igdbId!);
        return { gameId, igdbId, resolved: true };
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('not found')) return reply.status(404).send({ error: msg });
        throw err;
      }
    },
  );

  // GET /matching/duplicates — duplicate candidates for the user
  app.get('/matching/duplicates', auth, async request => {
    const candidates = await findDuplicateCandidates(userId(request));
    return candidates.map(c => ({
      game1: {
        id: c.gameA.id,
        title: c.gameA.title,
        coverPath: null,
        platform: c.gameA.platforms[0] ?? '',
      },
      game2: {
        id: c.gameB.id,
        title: c.gameB.title,
        coverPath: null,
        platform: c.gameB.platforms[0] ?? '',
      },
      score: c.score,
    }));
  });

  // POST /matching/duplicates/dismiss body { game1Id, game2Id } — mark as not a duplicate
  app.post<{ Body: { game1Id?: number; game2Id?: number } }>(
    '/matching/duplicates/dismiss',
    auth,
    async (request, reply) => {
      const { game1Id, game2Id } = request.body ?? {};
      if (!Number.isInteger(game1Id) || (game1Id ?? 0) <= 0) {
        return reply.status(400).send({ error: 'game1Id must be a positive integer' });
      }
      if (!Number.isInteger(game2Id) || (game2Id ?? 0) <= 0) {
        return reply.status(400).send({ error: 'game2Id must be a positive integer' });
      }
      if (game1Id === game2Id) {
        return reply.status(400).send({ error: 'game1Id and game2Id must differ' });
      }
      await ignoreDuplicatePair(userId(request), game1Id!, game2Id!);
      return { dismissed: true };
    },
  );

  // POST /matching/merge body { winnerId, loserId }
  app.post<{ Body: { winnerId?: number; loserId?: number } }>(
    '/matching/merge',
    auth,
    async (request, reply) => {
      const { winnerId, loserId } = request.body ?? {};
      if (!Number.isInteger(winnerId) || (winnerId ?? 0) <= 0) {
        return reply.status(400).send({ error: 'winnerId must be a positive integer' });
      }
      if (!Number.isInteger(loserId) || (loserId ?? 0) <= 0) {
        return reply.status(400).send({ error: 'loserId must be a positive integer' });
      }
      if (winnerId === loserId) {
        return reply.status(400).send({ error: 'winnerId and loserId must differ' });
      }
      try {
        await mergeGames(userId(request), winnerId!, loserId!);
        return { merged: true, winnerId, loserId };
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('itself')) return reply.status(400).send({ error: msg });
        throw err;
      }
    },
  );
}
