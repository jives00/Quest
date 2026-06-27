/**
 * One-off cleanup: merge duplicate PROVISIONAL games that share a normalized title.
 *
 * Before the createProvisionalGame title-dedup fix, multiple platform ids for one game
 * (several Xbox titleIds, PS4+PS5 editions, etc.) that all failed to match IGDB each
 * spawned their own provisional row — so a game shows up 2+ times in its per-platform
 * list. This collapses each such group onto its lowest-id row via the standard merge
 * (repoints ownership / external ids / playtime / sessions / achievements / lists, then
 * deletes the losers and logs to merge_log).
 *
 * Run: pnpm --filter @quest/api dedup-provisional
 * Safe to re-run (idempotent once groups are collapsed). Shared-DB write — run manually.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../src/db';
import { mergeGames } from '../src/services/matching.service';

async function main() {
  const pool = getPool();
  const [groups] = await pool.query<RowDataPacket[]>(
    `SELECT sort_title, GROUP_CONCAT(id ORDER BY id) ids, COUNT(*) n
       FROM games
      WHERE match_status = 'provisional' AND sort_title <> ''
      GROUP BY sort_title HAVING n > 1
      ORDER BY n DESC`,
  );

  console.log(`${groups.length} duplicate provisional title groups found\n`);
  let merged = 0;

  for (const g of groups) {
    const ids = String(g.ids).split(',').map(Number);
    const winner = ids[0];
    const losers = ids.slice(1);
    for (const loser of losers) {
      try {
        await mergeGames(1, winner, loser, 'dedup-provisional');
        merged++;
        console.log(`merged ${loser} → ${winner}  ("${g.sort_title}")`);
      } catch (err) {
        console.error(`failed merging ${loser} → ${winner}:`, (err as Error).message);
      }
    }
  }

  console.log(`\nDone. ${merged} duplicate rows merged across ${groups.length} groups.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
