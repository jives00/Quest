/**
 * Backfill YouTube trailer IDs and IGDB screenshot image IDs for all games
 * that are missing both. Calls enrichGame() which already handles the IGDB
 * fetch and skips individual fields that are already populated.
 *
 * Run: pnpm --filter @quest/api backfill-media [--limit=N]
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../src/db';
import { enrichGame } from '../src/services/games.service';

const DELAY_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

async function main() {
  const pool = getPool();
  console.log(`Connected to ${process.env.DB_NAME ?? 'quest'}@${process.env.DB_HOST ?? 'localhost'}`);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, igdb_id
     FROM games
     WHERE igdb_id IS NOT NULL
       AND (trailer_video_ids IS NULL OR screenshot_image_ids IS NULL)
     ORDER BY title
     ${limit > 0 ? `LIMIT ${limit}` : ''}`,
  );

  console.log(`${rows.length} games missing media\n`);

  let ok = 0;
  let noIgdb = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const { id, title } = rows[i] as { id: number; title: string; igdb_id: number };
    process.stdout.write(`[${i + 1}/${rows.length}] ${title} — `);
    try {
      await enrichGame(id);
      console.log('ok');
      ok++;
    } catch (err) {
      console.log(`failed: ${(err as Error).message}`);
      failed++;
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. OK: ${ok}, No IGDB id: ${noIgdb}, Failed: ${failed}`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
