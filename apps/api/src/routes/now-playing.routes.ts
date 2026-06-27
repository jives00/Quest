import { FastifyInstance, FastifyRequest } from 'fastify';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getNowPlaying } from '../services/now-playing.service';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function nowPlayingRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  // GET /now-playing — current now-playing + last played session
  app.get('/now-playing', auth, async request => {
    const uid = userId(request);
    const pool = getPool();

    const nowPlaying = await getNowPlaying(uid);

    // Last played: most recent play_session joined to game
    const [rows] = await pool.query<RowDataPacket[]>(
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
      rows.length > 0
        ? {
            id: rows[0].id as number,
            gameId: rows[0].gameId as number,
            title: rows[0].gameTitle as string,
            coverPath: rows[0].gameCoverPath as string | null,
            platform: rows[0].source as string,
            startedAt: rows[0].startedAt as string,
            endedAt: rows[0].endedAt as string,
            durationMin: rows[0].durationMin as number,
          }
        : null;

    return { nowPlaying, lastPlayed };
  });
}
