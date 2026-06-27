/**
 * Backfill HLTB-estimated playtime for completed games that have no tracked time.
 *
 * Run: pnpm --filter @quest/api backfill-hltb-playtime [--limit=N]
 *
 * For every user who has marked a game as 'completed' (via game_status or
 * game_completions), and where the game has no existing tracked playtime, this
 * script:
 *   1. Uses already-cached hltb_main_hours if present, otherwise fetches HLTB live.
 *   2. Inserts a playtime_totals row with source='hltb'.
 *
 * Safe to re-run — games with any existing playtime_totals row are skipped.
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../src/db';
import { maybePopulateHltbPlaytime } from '../src/services/games.service';
import { searchHltb } from '../src/services/hltb.client';

const DELAY_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

async function main() {
  const pool = getPool();
  console.log(`Connected to ${process.env.DB_NAME ?? 'quest'}@${process.env.DB_HOST ?? 'localhost'}`);

  // All completed (user_id, game_id) pairs — no HLTB filter, we'll fetch live if needed
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT t.user_id, t.game_id, g.title, g.hltb_main_hours
       FROM (
         SELECT user_id, game_id FROM game_status WHERE status = 'completed'
         UNION
         SELECT user_id, game_id FROM game_completions
       ) t
       JOIN games g ON g.id = t.game_id
       ${limit > 0 ? `LIMIT ${limit}` : ''}`,
  );

  console.log(`${rows.length} completed game/user pairs to check\n`);

  let populated = 0;
  let skipped = 0;
  let noData = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { user_id: number; game_id: number; title: string; hltb_main_hours: number | null };
    const { user_id: userId, game_id: gameId, title } = row;
    let hltbHours = row.hltb_main_hours != null ? Number(row.hltb_main_hours) : null;

    process.stdout.write(`[${i + 1}/${rows.length}] ${title} (user ${userId}) — `);

    // Skip if any playtime already exists
    const [[sumRow]] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(total_minutes), 0) AS m FROM playtime_totals WHERE user_id = ? AND game_id = ?`,
      [userId, gameId],
    );
    if (Number(sumRow.m) > 0) {
      console.log(`skip (already has ${sumRow.m}m)`);
      skipped++;
      continue;
    }

    // Fetch HLTB live if not cached yet
    if (hltbHours === null) {
      process.stdout.write(`fetching HLTB… `);
      try {
        const result = await searchHltb(title);
        if (result?.mainStoryHours) {
          hltbHours = result.mainStoryHours;
          // Persist so future calls don't re-fetch
          await pool.query<ResultSetHeader>(
            `UPDATE games SET hltb_main_hours = ?, hltb_main_extra_hours = COALESCE(hltb_main_extra_hours, ?),
                              hltb_completionist_hours = COALESCE(hltb_completionist_hours, ?) WHERE id = ?`,
            [hltbHours, result.mainExtraHours ?? null, result.completionistHours ?? null, gameId],
          );
        }
      } catch (err) {
        console.log(`HLTB fetch failed: ${(err as Error).message}`);
        noData++;
        await sleep(DELAY_MS);
        continue;
      }
      await sleep(DELAY_MS);
    }

    if (!hltbHours) {
      console.log(`no HLTB data`);
      noData++;
      continue;
    }

    await maybePopulateHltbPlaytime(userId, gameId);
    console.log(`populated ~${hltbHours}h`);
    populated++;
  }

  console.log(`\nDone. Populated: ${populated}, Skipped (had time): ${skipped}, No HLTB data: ${noData}`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
