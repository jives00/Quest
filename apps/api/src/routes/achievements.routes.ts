import { FastifyInstance, FastifyRequest } from 'fastify';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

type AchSort = 'rarity' | 'date' | 'name' | 'locked';

const SORT_CLAUSES: Record<AchSort, string> = {
  rarity: `(a.global_pct IS NULL) ASC, a.global_pct DESC, a.name ASC`,
  date: `(ua.unlocked_at IS NULL) ASC, ua.unlocked_at DESC, a.name ASC`,
  name: `a.name ASC`,
  locked: `(ua.unlocked_at IS NOT NULL) ASC, a.name ASC`,
};

// Preferred source per game: steam > psn, so a game imported from both platforms
// doesn't produce duplicate achievement rows.
const PREFERRED_SOURCE_JOIN = `
  JOIN (
    SELECT game_id, MIN(CASE source WHEN 'steam' THEN 0 ELSE 1 END) AS best
      FROM achievements
     GROUP BY game_id
  ) gp ON gp.game_id = a.game_id
     AND (CASE a.source WHEN 'steam' THEN 0 ELSE 1 END) = gp.best
`;

export async function achievementsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /achievements?sort=&gameId=&page=&limit= — all achievements across the library
  app.get<{ Querystring: { sort?: string; gameId?: string; page?: string; limit?: string } }>(
    '/achievements',
    auth,
    async (request, reply) => {
      const uid = userId(request);
      const sort = (request.query.sort ?? 'rarity') as AchSort;
      if (!SORT_CLAUSES[sort]) {
        return reply.status(400).send({ error: 'Invalid sort' });
      }
      const gameId = request.query.gameId ? Number(request.query.gameId) : undefined;
      if (request.query.gameId !== undefined && (!Number.isInteger(gameId) || gameId! <= 0)) {
        return reply.status(400).send({ error: 'Invalid gameId' });
      }
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '30', 10) || 30));
      const offset = (page - 1) * limit;

      const pool = getPool();
      const gameFilter = gameId ? 'AND a.game_id = ?' : '';
      const params: (number | string)[] = gameId ? [uid, gameId] : [uid];

      const [[{ total }]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total
           FROM achievements a
           ${PREFERRED_SOURCE_JOIN}
           LEFT JOIN user_achievements ua
             ON ua.game_id = a.game_id AND ua.api_name = a.api_name AND ua.user_id = ?
          WHERE 1=1 ${gameFilter}`,
        params,
      );

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT g.id AS game_id, g.title, g.cover_path,
                a.api_name, a.name, a.description, a.icon, a.global_pct,
                a.dlc_app_name, ua.unlocked_at
           FROM achievements a
           JOIN games g ON g.id = a.game_id
           ${PREFERRED_SOURCE_JOIN}
           LEFT JOIN user_achievements ua
             ON ua.game_id = a.game_id AND ua.api_name = a.api_name AND ua.user_id = ?
          WHERE 1=1 ${gameFilter}
          ORDER BY ${SORT_CLAUSES[sort]}
          LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

      return {
        total: Number(total),
        achievements: rows.map(r => ({
          gameId: r.game_id as number,
          gameTitle: r.title as string,
          gameCoverPath: r.cover_path as string | null,
          apiName: r.api_name as string,
          name: r.name as string,
          description: r.description as string | null,
          icon: r.icon as string | null,
          globalPct: r.global_pct != null ? Number(r.global_pct) : null,
          dlcAppName: r.dlc_app_name as string | null,
          unlockedAt: r.unlocked_at as string | null,
        })),
      };
    },
  );

  // GET /achievements/games — games with achievements, for the filter dropdown
  app.get('/achievements/games', auth, async () => {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id AS game_id, g.title, COUNT(*) AS achievement_count
         FROM achievements a
         JOIN games g ON g.id = a.game_id
         ${PREFERRED_SOURCE_JOIN}
        GROUP BY g.id, g.title
        ORDER BY g.title ASC`,
    );
    return rows.map(r => ({
      gameId: r.game_id as number,
      title: r.title as string,
      achievementCount: Number(r.achievement_count),
    }));
  });
}
