import { FastifyInstance, FastifyRequest } from 'fastify';
import { RowDataPacket } from 'mysql2/promise';
import { GAME_STATUSES } from '@quest/types';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';
import { ALL_PLATFORMS } from '../platforms';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function libraryRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  /**
   * GET /library
   * Optional filters: platform (steam|psn), genre (substring), status (backlog|playing|…)
   * Default: only games that matter (have playtime OR any status OR list membership).
   * ?all=1: full owned/known set.
   *
   * Wishlist games are unowned, so they are carried by status alone and hidden
   * unless `status=wishlist` asks for them — otherwise the library fills up
   * with games you don't have.
   */
  app.get<{
    Querystring: {
      platform?: string;
      customPlatformId?: string;
      genre?: string;
      status?: string;
      all?: string;
      hidden?: string;
      vr?: string;
      q?: string;
    };
  }>('/library', auth, async (request, reply) => {
    const uid = userId(request);
    const { platform, customPlatformId, genre, status, all, hidden, vr, q } = request.query;

    const VALID_PLATFORMS: string[] = ALL_PLATFORMS;
    const VALID_STATUSES: string[] = [...GAME_STATUSES];

    if (platform && !VALID_PLATFORMS.includes(platform)) {
      return reply.status(400).send({ error: 'Invalid platform' });
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return reply.status(400).send({ error: 'Invalid status' });
    }

    const pool = getPool();
    const showAll = all === '1' || all === 'true';
    const showHidden = hidden === '1' || hidden === 'true';
    const showVr = vr === '1' || vr === 'true';

    // Base query: games the user owns or has playtime on
    let sql = `
      SELECT DISTINCT
        g.id,
        g.title,
        g.sort_title AS sortTitle,
        g.cover_path AS coverPath,
        g.match_status AS matchStatus,
        gs.status AS status,
        g.genres,
        (
          SELECT GROUP_CONCAT(DISTINCT o2.platform)
          FROM ownership o2
          WHERE o2.user_id = ? AND o2.game_id = g.id
        ) AS platformsOwned,
        (
          SELECT COUNT(*) FROM user_achievements ua WHERE ua.user_id = ? AND ua.game_id = g.id
        ) AS achievementsEarned,
        (
          SELECT COUNT(*) FROM achievements a WHERE a.game_id = g.id
        ) AS achievementsTotal
      FROM games g
      LEFT JOIN game_status gs ON gs.user_id = ? AND gs.game_id = g.id
      WHERE (
        EXISTS (SELECT 1 FROM ownership o WHERE o.user_id = ? AND o.game_id = g.id)
        OR EXISTS (SELECT 1 FROM playtime_totals pt WHERE pt.user_id = ? AND pt.game_id = g.id)
        OR EXISTS (SELECT 1 FROM custom_ownership co WHERE co.user_id = ? AND co.game_id = g.id)
        OR gs.status = 'wishlist'
      )
    `;

    const params: (string | number)[] = [uid, uid, uid, uid, uid, uid];

    if (status !== 'wishlist') {
      sql += ` AND (gs.status IS NULL OR gs.status <> 'wishlist')`;
    }

    if (showHidden) {
      // Show ONLY hidden games
      sql += ` AND EXISTS (SELECT 1 FROM hidden_games h WHERE h.user_id = ? AND h.game_id = g.id)`;
      params.push(uid);
    } else {
      // Exclude hidden games by default
      sql += ` AND NOT EXISTS (SELECT 1 FROM hidden_games h WHERE h.user_id = ? AND h.game_id = g.id)`;
      params.push(uid);
    }

    if (!showAll && !showHidden) {
      // Default: games that "matter" — any playtime OR earned achievements/trophies OR
      // any status at all OR list membership. Earned achievements are the
      // played-signal for platforms that report no minutes (Xbox, trophy-only PSN), so
      // those games surface here instead of being stuck behind "Show all owned".
      sql += `
        AND (
          EXISTS (SELECT 1 FROM playtime_totals pt2 WHERE pt2.user_id = ? AND pt2.game_id = g.id AND pt2.total_minutes > 0)
          OR EXISTS (SELECT 1 FROM user_achievements ua2 WHERE ua2.user_id = ? AND ua2.game_id = g.id AND ua2.unlocked_at IS NOT NULL)
          OR gs.status IS NOT NULL
          OR EXISTS (SELECT 1 FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.user_id = ? AND li.game_id = g.id)
        )
      `;
      params.push(uid, uid, uid);
    }

    if (platform) {
      sql += ` AND EXISTS (SELECT 1 FROM ownership op WHERE op.user_id = ? AND op.game_id = g.id AND op.platform = ?)`;
      params.push(uid, platform);
    }

    if (customPlatformId) {
      const cpId = Number(customPlatformId);
      if (!Number.isInteger(cpId) || cpId <= 0) return reply.status(400).send({ error: 'Invalid customPlatformId' });
      sql += ` AND EXISTS (SELECT 1 FROM custom_ownership co WHERE co.user_id = ? AND co.game_id = g.id AND co.platform_id = ?)`;
      params.push(uid, cpId);
    }

    if (genre) {
      sql += ` AND JSON_SEARCH(g.genres, 'one', ?) IS NOT NULL`;
      params.push(`%${genre}%`);
    }

    if (status) {
      sql += ` AND gs.status = ?`;
      params.push(status);
    }

    if (showVr) {
      sql += ` AND g.vr_supported = 1`;
    }

    if (q) {
      sql += ` AND g.title LIKE ?`;
      params.push(`%${q}%`);
    }

    sql += ` ORDER BY g.sort_title, g.title`;

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);

    return rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      coverPath: r.coverPath as string | null,
      matchStatus: r.matchStatus as string,
      status: r.status as string,
      platforms: r.platformsOwned ? String(r.platformsOwned).split(',') : [],
      completionPct:
        Number(r.achievementsTotal) > 0 && Number(r.achievementsEarned) > 0
          ? Math.round((Number(r.achievementsEarned) / Number(r.achievementsTotal)) * 100)
          : null,
    }));
  });
}
