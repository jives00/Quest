// ---------------------------------------------------------------------------
// Background enrichment sweep.
//
// enrichGame (Steam store data, reviews, HLTB, IGDB media, achievement rarity +
// descriptions + DLC groups) otherwise only runs from the game page's Refresh
// button or the refresh-all script, so newly synced games sat without it.
//
// Each run takes a small batch of the stalest library games — never-enriched
// first, then most recently played — so the whole library cycles every few days
// without bursting Steam/HLTB. Scoped to games someone owns or has a status
// on; search-only materializations aren't worth the upstream calls.
// ---------------------------------------------------------------------------

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import { enrichGame } from './games.service';

const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000; // 6x/day
const FIRST_RUN_DELAY_MS = 20 * 60 * 1000; // after boot-time syncs + price sweep
const STALE_DAYS = 7;
const BATCH_SIZE = 30; // 180/day ≈ 1,260 games per staleness window
const CALL_SPACING_MS = 3_000; // each enrich fans out to Steam, HLTB and IGDB

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getStaleGameIds(): Promise<number[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT g.id
       FROM games g
       LEFT JOIN (SELECT game_id, MAX(started_at) AS last_played
                    FROM play_sessions GROUP BY game_id) ps ON ps.game_id = g.id
      WHERE (g.store_fetched_at IS NULL
             OR g.store_fetched_at < NOW() - INTERVAL ? DAY)
        AND (EXISTS (SELECT 1 FROM ownership o WHERE o.game_id = g.id)
             OR EXISTS (SELECT 1 FROM game_status gs WHERE gs.game_id = g.id))
      ORDER BY (g.store_fetched_at IS NULL) DESC, ps.last_played IS NULL, ps.last_played DESC,
               g.store_fetched_at ASC
      LIMIT ?`,
    [STALE_DAYS, BATCH_SIZE],
  );
  return rows.map((r) => r.id as number);
}

async function runSweep(): Promise<void> {
  const ids = await getStaleGameIds();
  let refreshed = 0;

  for (const id of ids) {
    try {
      if (await enrichGame(id)) refreshed++;
    } catch (err) {
      // One bad game must not abort the sweep.
      console.error(`Enrichment sweep failed (game ${id}):`, err);
    }
    await sleep(CALL_SPACING_MS);
  }

  if (refreshed) console.log(`Enrichment sweep: refreshed ${refreshed} games`);
}

export function startEnrichRefresh(): void {
  const run = () => runSweep().catch((err) => console.error('Enrichment sweep error:', err));
  setTimeout(run, FIRST_RUN_DELAY_MS);
  setInterval(run, REFRESH_INTERVAL_MS);
  console.log('🔄 Enrichment sweep scheduled');
}
