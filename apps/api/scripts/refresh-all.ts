/**
 * Refresh enrichment data (Steam store scores + controller support + HLTB) for
 * every game, and backfill hero banner art for games that don't have one.
 *
 * Run: pnpm --filter @quest/api refresh-all [flags]
 *
 * Flags:
 *   --enrich-only    Only run Steam/HLTB enrichment, skip hero + capsule art.
 *   --heroes-only    Only backfill hero art.
 *   --capsules-only  Only backfill capsule art for non-Steam games.
 *   --force-hero     Overwrite existing hero_path (default: only fill missing).
 *   --force-capsule  Overwrite existing capsule_path (default: only fill missing).
 *   --limit=N        Process at most N games (useful for a test run).
 *
 * Capsule note: Steam-linked games get their capsule from the store API inside
 * enrichGame, so they need no separate pass here. This backfill only covers
 * games with no Steam appid (PSN/Xbox/Meta), falling back to SteamGridDB.
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
import { getBestCapsuleUrl } from '../src/services/steamgriddb.client';

const DELAY_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const enrichOnly = args.includes('--enrich-only');
const heroesOnly = args.includes('--heroes-only');
const capsulesOnly = args.includes('--capsules-only');
const forceHero = args.includes('--force-hero');
const forceCapsule = args.includes('--force-capsule');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

const onlyFlag = enrichOnly || heroesOnly || capsulesOnly;
const doEnrich = enrichOnly || !onlyFlag;
const doHeroes = heroesOnly || !onlyFlag;
const doCapsules = capsulesOnly || !onlyFlag;

async function main() {
  const pool = getPool();
  console.log(`Connected to ${process.env.DB_NAME ?? 'quest'}@${process.env.DB_HOST ?? 'localhost'}`);
  console.log(
    `Mode: ${[
      doEnrich ? 'enrich' : null,
      doHeroes ? `heroes${forceHero ? ' (force)' : ''}` : null,
      doCapsules ? `capsules${forceCapsule ? ' (force)' : ''}` : null,
    ]
      .filter(Boolean)
      .join(' + ')}`,
  );

  const [games] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, hero_path, capsule_path,
            (SELECT e.external_id FROM external_game_ids e
               WHERE e.game_id = games.id AND e.source = 'steam_appid' LIMIT 1) AS steam_app_id
       FROM games ORDER BY id${limit > 0 ? ` LIMIT ${limit}` : ''}`,
  );
  console.log(`${games.length} games to process\n`);

  let enriched = 0;
  let herosSet = 0;
  let capsulesSet = 0;
  let failures = 0;

  for (let i = 0; i < games.length; i++) {
    const g = games[i] as {
      id: number;
      title: string;
      hero_path: string | null;
      capsule_path: string | null;
      steam_app_id: string | null;
    };
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

      // Steam-linked games are covered by enrichGame above; only non-Steam
      // entries need the SteamGridDB fallback.
      if (
        doCapsules &&
        !g.steam_app_id &&
        (forceCapsule || !g.capsule_path)
      ) {
        const capsule = await getBestCapsuleUrl(g.title);
        if (capsule) {
          await pool.query(`UPDATE games SET capsule_path = ? WHERE id = ?`, [capsule, g.id]);
          capsulesSet++;
          console.log(`${tag} — capsule set`);
        }
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
