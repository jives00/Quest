/**
 * Refresh enrichment data (Steam store scores + controller support + HLTB) for
 * every game, and backfill hero banner art for games that don't have one.
 *
 * Run: pnpm --filter @quest/api refresh-all [flags]
 *
 * Flags:
 *   --enrich-only   Only run Steam/HLTB enrichment, skip hero art.
 *   --heroes-only   Only backfill hero art, skip enrichment.
 *   --force-hero    Overwrite existing hero_path (default: only fill missing).
 *   --limit=N       Process at most N games (useful for a test run).
 *
 * Safe to re-run. Enrichment never clobbers manually-edited fields; hero
 * backfill writes hero_path directly (it does NOT flip match_status to 'manual',
 * unlike the in-app artwork editor) and by default skips games that already have
 * a hero. A delay between games keeps us under the Steam/HLTB/SteamGridDB rate
 * limits.
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../src/db';
import { enrichGame, getArtworkCandidates } from '../src/services/games.service';

const DELAY_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const enrichOnly = args.includes('--enrich-only');
const heroesOnly = args.includes('--heroes-only');
const forceHero = args.includes('--force-hero');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

const doEnrich = !heroesOnly;
const doHeroes = !enrichOnly;

async function main() {
  const pool = getPool();
  console.log(`Connected to ${process.env.DB_NAME ?? 'quest'}@${process.env.DB_HOST ?? 'localhost'}`);
  console.log(
    `Mode: ${doEnrich ? 'enrich' : ''}${doEnrich && doHeroes ? ' + ' : ''}${doHeroes ? `heroes${forceHero ? ' (force)' : ''}` : ''}`,
  );

  const [games] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, hero_path FROM games ORDER BY id${limit > 0 ? ` LIMIT ${limit}` : ''}`,
  );
  console.log(`${games.length} games to process\n`);

  let enriched = 0;
  let herosSet = 0;
  let failures = 0;

  for (let i = 0; i < games.length; i++) {
    const g = games[i] as { id: number; title: string; hero_path: string | null };
    const tag = `[${i + 1}/${games.length}] ${g.title}`;

    try {
      if (doEnrich) {
        await enrichGame(g.id);
        enriched++;
      }

      if (doHeroes && (forceHero || !g.hero_path)) {
        const art = await getArtworkCandidates(g.title);
        const hero = art.heroes[0] ?? null;
        if (hero) {
          await pool.query(`UPDATE games SET hero_path = ? WHERE id = ?`, [hero, g.id]);
          herosSet++;
          console.log(`${tag} — hero set`);
        } else {
          console.log(`${tag} — no hero found`);
        }
      } else {
        console.log(tag);
      }
    } catch (err) {
      failures++;
      console.error(`${tag} — FAILED:`, (err as Error).message);
    }

    if (i < games.length - 1) await sleep(DELAY_MS);
  }

  console.log(
    `\nDone. enriched=${enriched}, heroesSet=${herosSet}, failures=${failures}, total=${games.length}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
