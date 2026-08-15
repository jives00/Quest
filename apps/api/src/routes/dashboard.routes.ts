import { FastifyInstance, FastifyRequest } from 'fastify';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getNowPlaying } from '../services/now-playing.service';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function dashboardRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /dashboard/summary
  app.get('/dashboard/summary', auth, async request => {
    const uid = userId(request);
    const pool = getPool();

    const [[stats]] = await pool.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(DISTINCT game_id) FROM ownership WHERE user_id = ?) AS totalGames,
         (SELECT COALESCE(SUM(duration_min), 0) FROM play_sessions WHERE user_id = ?) AS lifetimeMin,
         (SELECT COUNT(*) FROM game_status gs
           WHERE gs.user_id = ? AND gs.status IN ('completed', 'other')
             AND EXISTS (SELECT 1 FROM ownership o WHERE o.game_id = gs.game_id AND o.user_id = gs.user_id)
         ) AS finishedCount,
         (SELECT COUNT(*) FROM (
           SELECT a.game_id
             FROM achievements a
             LEFT JOIN user_achievements ua
               ON ua.game_id = a.game_id AND ua.api_name = a.api_name
              AND ua.user_id = ? AND ua.unlocked_at IS NOT NULL
            GROUP BY a.game_id
           HAVING COUNT(a.id) > 0 AND COUNT(a.id) = COUNT(ua.id)
         ) t) AS perfectCount`,
      [uid, uid, uid, uid],
    );

    const [artRows] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT g.cover_path AS coverPath
         FROM ownership o
         JOIN games g ON g.id = o.game_id
        WHERE o.user_id = ? AND g.cover_path IS NOT NULL
        LIMIT 60`,
      [uid],
    );

    return {
      totalGames: Number(stats.totalGames),
      lifetimeMin: Number(stats.lifetimeMin),
      finishedCount: Number(stats.finishedCount),
      perfectCount: Number(stats.perfectCount),
      artPaths: artRows.map(r => r.coverPath as string),
    };
  });

  // GET /dashboard/daily-stats
  app.get('/dashboard/daily-stats', auth, async request => {
    const uid = userId(request);
    const pool = getPool();

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE(CONVERT_TZ(started_at, '+00:00', 'America/Chicago')) AS date,
              SUM(duration_min) AS totalMin
         FROM play_sessions
        WHERE user_id = ? AND started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(CONVERT_TZ(started_at, '+00:00', 'America/Chicago'))
        ORDER BY date ASC`,
      [uid],
    );

    return rows.map(r => ({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
      totalMin: Number(r.totalMin),
    }));
  });

  // GET /dashboard/playing
  app.get('/dashboard/playing', auth, async request => {
    const uid = userId(request);
    const pool = getPool();

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id, g.title, g.cover_path AS coverPath, g.match_status AS matchStatus, gs.status,
              g.hltb_main_extra_hours AS hltbMainExtraHours,
              g.hltb_main_hours AS hltbMainHours,
              g.hltb_completionist_hours AS hltbCompletionistHours,
              MAX(ps.started_at) AS lastPlayedAt
         FROM game_status gs
         JOIN games g ON g.id = gs.game_id
         LEFT JOIN play_sessions ps ON ps.game_id = g.id AND ps.user_id = ?
        WHERE gs.user_id = ? AND gs.status = 'playing'
        GROUP BY g.id, g.title, g.cover_path, g.match_status, gs.status,
                 g.hltb_main_extra_hours, g.hltb_main_hours, g.hltb_completionist_hours
        ORDER BY lastPlayedAt DESC, g.sort_title ASC
        LIMIT 12`,
      [uid, uid],
    );

    return rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      coverPath: r.coverPath as string | null,
      matchStatus: r.matchStatus as string,
      status: r.status as string,
      platforms: [] as string[],
      completionPct: null,
      hltbMainExtraHours: r.hltbMainExtraHours != null ? Number(r.hltbMainExtraHours) : null,
      hltbMainHours: r.hltbMainHours != null ? Number(r.hltbMainHours) : null,
      hltbCompletionistHours: r.hltbCompletionistHours != null ? Number(r.hltbCompletionistHours) : null,
    }));
  });

  // GET /dashboard/backlog
  app.get('/dashboard/backlog', auth, async request => {
    const uid = userId(request);
    const pool = getPool();

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id, g.title, g.cover_path AS coverPath, g.match_status AS matchStatus,
              COALESCE(gs.status, 'unplayed') AS status,
              g.hltb_main_extra_hours AS hltbMainExtraHours,
              g.hltb_main_hours AS hltbMainHours,
              g.hltb_completionist_hours AS hltbCompletionistHours
         FROM lists l
         JOIN list_items li ON li.list_id = l.id
         JOIN games g ON g.id = li.game_id
         LEFT JOIN game_status gs ON gs.game_id = g.id AND gs.user_id = ?
        WHERE l.user_id = ? AND l.kind = 'system' AND l.system_key = 'backlog'
        ORDER BY g.sort_title ASC
        LIMIT 12`,
      [uid, uid],
    );

    return rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      coverPath: r.coverPath as string | null,
      matchStatus: r.matchStatus as string,
      status: r.status as string,
      platforms: [] as string[],
      completionPct: null,
      hltbMainExtraHours: r.hltbMainExtraHours != null ? Number(r.hltbMainExtraHours) : null,
      hltbMainHours: r.hltbMainHours != null ? Number(r.hltbMainHours) : null,
      hltbCompletionistHours: r.hltbCompletionistHours != null ? Number(r.hltbCompletionistHours) : null,
    }));
  });

  // GET /dashboard/upcoming
  app.get('/dashboard/upcoming', auth, async request => {
    const uid = userId(request);
    const pool = getPool();

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id, g.title, g.cover_path AS coverPath, g.first_release_date AS releaseDate
         FROM lists l
         JOIN list_items li ON li.list_id = l.id
         JOIN games g ON g.id = li.game_id
        WHERE l.user_id = ? AND l.kind = 'system' AND l.system_key = 'wishlist'
          AND g.first_release_date >= CURDATE()
          AND g.first_release_date <= DATE_ADD(CURDATE(), INTERVAL 180 DAY)
        ORDER BY g.first_release_date ASC
        LIMIT 20`,
      [uid],
    );

    return rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      coverPath: r.coverPath as string | null,
      releaseDate: r.releaseDate instanceof Date
        ? r.releaseDate.toISOString().slice(0, 10)
        : String(r.releaseDate).slice(0, 10),
    }));
  });

  // GET /dashboard/hero — random game with hero art from the library
  app.get('/dashboard/hero', auth, async (request) => {
    const uid = userId(request);
    const pool = getPool();
    const seed = Number((request.query as Record<string, string>).seed ?? Math.random() * 1_000_000) % 1_000_000;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id, g.title, g.hero_path AS heroPath, g.cover_path AS coverPath
         FROM ownership o
         JOIN games g ON g.id = o.game_id
        WHERE o.user_id = ? AND g.hero_path IS NOT NULL
        ORDER BY RAND(?)
        LIMIT 1`,
      [uid, seed],
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id as number,
      title: r.title as string,
      heroPath: r.heroPath as string,
      coverPath: r.coverPath as string | null,
    };
  });

  // GET /dashboard
  app.get('/dashboard', auth, async request => {
    const uid = userId(request);
    const pool = getPool();

    // Now playing
    const nowPlaying = await getNowPlaying(uid);

    // Last played session
    const [lastPlayedRows] = await pool.query<RowDataPacket[]>(
      `SELECT ps.id, ps.game_id AS gameId, g.title AS gameTitle, g.cover_path AS gameCoverPath,
              ps.source, ps.started_at AS startedAt, ps.ended_at AS endedAt, ps.duration_min AS durationMin
         FROM play_sessions ps
         JOIN games g ON g.id = ps.game_id
        WHERE ps.user_id = ?
        ORDER BY ps.started_at DESC
        LIMIT 1`,
      [uid],
    );
    const lastPlayed =
      lastPlayedRows.length > 0
        ? {
            id: lastPlayedRows[0].id as number,
            gameId: lastPlayedRows[0].gameId as number,
            title: lastPlayedRows[0].gameTitle as string,
            coverPath: lastPlayedRows[0].gameCoverPath as string | null,
            platform: lastPlayedRows[0].source as string,
            startedAt: lastPlayedRows[0].startedAt as string,
            endedAt: lastPlayedRows[0].endedAt as string,
            durationMin: lastPlayedRows[0].durationMin as number,
          }
        : null;

    // Recent sessions (last 5)
    const [recentRows] = await pool.query<RowDataPacket[]>(
      `SELECT ps.id, ps.game_id AS gameId, g.title AS gameTitle, g.cover_path AS gameCoverPath,
              ps.source, ps.started_at AS startedAt, ps.ended_at AS endedAt, ps.duration_min AS durationMin,
              ps.derived
         FROM play_sessions ps
         JOIN games g ON g.id = ps.game_id
        WHERE ps.user_id = ?
        ORDER BY ps.started_at DESC
        LIMIT 5`,
      [uid],
    );
    const recentSessions = recentRows.map(r => ({
      id: r.id as number,
      gameId: r.gameId as number,
      title: r.gameTitle as string,
      coverPath: r.gameCoverPath as string | null,
      platform: r.source as string,
      startedAt: r.startedAt as string,
      endedAt: r.endedAt as string,
      durationMin: r.durationMin as number,
      derived: Boolean(r.derived),
    }));

    // Playtime this week — rolling last 7 days, all sessions including derived
    const [weekRows] = await pool.query<RowDataPacket[]>(
      `SELECT source, SUM(duration_min) AS totalMin
         FROM play_sessions
        WHERE user_id = ? AND started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY source`,
      [uid],
    );

    let totalMin = 0;
    const byPlatform: Record<string, number> = { steam: 0, psn: 0 };
    for (const r of weekRows) {
      const src = r.source as string;
      const mins = Number(r.totalMin);
      totalMin += mins;
      byPlatform[src] = mins;
    }

    return {
      nowPlaying,
      lastPlayed,
      recentSessions,
      playtimeThisWeek: { totalMin, byPlatform },
    };
  });
}
