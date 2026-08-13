import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(__dirname, '../../../.env') });

import { buildApp } from './app';
import { ensureAdminUser } from './services/auth.service';
import { startSteamPoller } from './services/steam-poll.service';
import { startPsnPoller } from './services/psn-poll.service';
import { startXboxPoller } from './services/xbox-poll.service';
import { runBackfillSweep } from './services/matching.service';
import { startPriceRefresh } from './services/price-refresh.service';

const BACKFILL_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

function startBackfillSweep(): void {
  const run = () =>
    runBackfillSweep()
      .then(r => console.log(`Backfill sweep: promoted ${r.promoted}/${r.checked} provisional`))
      .catch(err => console.error('Backfill sweep error:', err));
  // Defer first run an hour so it doesn't pile onto first-boot library sync.
  setTimeout(run, 60 * 60 * 1000);
  setInterval(run, BACKFILL_SWEEP_INTERVAL_MS);
}

async function main() {
  await ensureAdminUser();
  const app = buildApp();
  const port = Number(process.env.API_PORT ?? 3007);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Quest API server running on http://localhost:${port}`);

  startSteamPoller();
  startPsnPoller();
  startXboxPoller();
  startBackfillSweep();
  startPriceRefresh();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
