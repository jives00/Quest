import { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';

function userId(request: FastifyRequest): number {
  return (request.user as { sub: number }).sub;
}

export async function exportRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  app.get('/export', auth, async (request, reply) => {
    const uid = userId(request);
    const pool = getPool();

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Quest';
    wb.created = new Date();

    // ── Sheet 1: Library ────────────────────────────────────────────────────
    const libSheet = wb.addWorksheet('Library');
    libSheet.columns = [
      { header: 'Title',          key: 'title',       width: 40 },
      { header: 'Status',         key: 'status',      width: 14 },
      { header: 'Platforms',      key: 'platforms',   width: 28 },
      { header: 'Playtime (hrs)', key: 'playtime',    width: 16 },
      { header: 'Rating',         key: 'rating',      width: 10 },
      { header: 'Completion %',   key: 'completion',  width: 14 },
      { header: 'Genres',         key: 'genres',      width: 30 },
      { header: 'Release Date',   key: 'release',     width: 14 },
    ];
    styleHeader(libSheet);

    const [libRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         g.title,
         COALESCE(gs.status, 'unplayed') AS status,
         (SELECT GROUP_CONCAT(DISTINCT o.platform ORDER BY o.platform SEPARATOR ', ')
          FROM ownership o WHERE o.user_id = ? AND o.game_id = g.id) AS platforms,
         COALESCE((SELECT SUM(pt.total_minutes) FROM playtime_totals pt
                   WHERE pt.user_id = ? AND pt.game_id = g.id), 0) AS totalMin,
         r.rating,
         (SELECT COUNT(*) FROM user_achievements ua WHERE ua.user_id = ? AND ua.game_id = g.id) AS earned,
         (SELECT COUNT(*) FROM achievements a WHERE a.game_id = g.id) AS total,
         g.genres,
         g.first_release_date AS releaseDate
       FROM games g
       LEFT JOIN game_status gs ON gs.user_id = ? AND gs.game_id = g.id
       LEFT JOIN ratings r ON r.user_id = ? AND r.game_id = g.id
       WHERE EXISTS (SELECT 1 FROM ownership o2 WHERE o2.user_id = ? AND o2.game_id = g.id)
         AND NOT EXISTS (SELECT 1 FROM hidden_games h WHERE h.user_id = ? AND h.game_id = g.id)
       ORDER BY g.sort_title, g.title`,
      [uid, uid, uid, uid, uid, uid, uid],
    );

    for (const r of libRows) {
      const earned = Number(r.earned ?? 0);
      const total = Number(r.total ?? 0);
      libSheet.addRow({
        title:      r.title,
        status:     r.status,
        platforms:  r.platforms ?? '',
        playtime:   Math.round((Number(r.totalMin) / 60) * 10) / 10,
        rating:     r.rating ?? null,
        completion: total > 0 ? Math.round((earned / total) * 100) : null,
        genres:     r.genres ? (JSON.parse(r.genres as string) as string[]).join(', ') : '',
        release:    r.releaseDate ? new Date(r.releaseDate as string).toISOString().slice(0, 10) : '',
      });
    }

    // ── Sheet 2: Sessions ───────────────────────────────────────────────────
    const sessSheet = wb.addWorksheet('Sessions');
    sessSheet.columns = [
      { header: 'Game',           key: 'game',      width: 40 },
      { header: 'Platform',       key: 'platform',  width: 14 },
      { header: 'Started',        key: 'started',   width: 20 },
      { header: 'Ended',          key: 'ended',     width: 20 },
      { header: 'Duration (min)', key: 'duration',  width: 16 },
    ];
    styleHeader(sessSheet);

    const [sessRows] = await pool.query<RowDataPacket[]>(
      `SELECT g.title AS game, ps.source AS platform,
              ps.started_at AS startedAt, ps.ended_at AS endedAt,
              ps.duration_min AS durationMin
       FROM play_sessions ps
       JOIN games g ON g.id = ps.game_id
       WHERE ps.user_id = ?
       ORDER BY ps.started_at DESC`,
      [uid],
    );

    for (const r of sessRows) {
      sessSheet.addRow({
        game:     r.game,
        platform: r.platform,
        started:  r.startedAt ? new Date(r.startedAt as string).toISOString().replace('T', ' ').slice(0, 19) : '',
        ended:    r.endedAt   ? new Date(r.endedAt   as string).toISOString().replace('T', ' ').slice(0, 19) : '',
        duration: r.durationMin,
      });
    }

    // ── Sheet 3: Achievements ───────────────────────────────────────────────
    const achSheet = wb.addWorksheet('Achievements');
    achSheet.columns = [
      { header: 'Game',        key: 'game',        width: 40 },
      { header: 'Achievement', key: 'achievement', width: 40 },
      { header: 'Unlocked At', key: 'unlocked',    width: 20 },
    ];
    styleHeader(achSheet);

    const [achRows] = await pool.query<RowDataPacket[]>(
      `SELECT g.title AS game, a.name AS achievement, ua.unlocked_at AS unlockedAt
       FROM user_achievements ua
       JOIN achievements a ON a.id = ua.achievement_id
       JOIN games g ON g.id = a.game_id
       WHERE ua.user_id = ? AND ua.unlocked_at IS NOT NULL
       ORDER BY ua.unlocked_at DESC`,
      [uid],
    );

    for (const r of achRows) {
      achSheet.addRow({
        game:        r.game,
        achievement: r.achievement,
        unlocked:    r.unlockedAt ? new Date(r.unlockedAt as string).toISOString().replace('T', ' ').slice(0, 19) : '',
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = `quest-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(Buffer.from(buf));
  });
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1E2E' } };
  row.font = { bold: true, color: { argb: 'FFCDD6F4' } };
  row.commit();
}
