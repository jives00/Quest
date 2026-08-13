// ---------------------------------------------------------------------------
// Background price refresh.
//
// Deliberately not part of the Steam poller: that runs per Steam account, so a
// user with no Steam link would never refresh their PlayStation or Quest
// prices. Pricing is wishlist-scoped, not platform-scoped.
//
// Keeping the cache warm here means page loads only ever read the DB, which is
// what makes a metered upstream (PlatPrices' 1,000 requests/month) viable.
// ---------------------------------------------------------------------------

import { refreshPriceIfStale } from './games.service';
import { getWishlistedGameIds } from './price-cache.service';

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 4x/day; the 24h TTL does the real gating
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000; // let boot-time library syncs settle
const CALL_SPACING_MS = 1_000; // pace upstream calls; these are rate-limited APIs

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runSweep(): Promise<void> {
  const entries = await getWishlistedGameIds();
  let refreshed = 0;

  for (const { userId, gameId } of entries) {
    try {
      const called = await refreshPriceIfStale(userId, gameId);
      if (called) {
        refreshed++;
        // Only sleep when we actually hit an upstream — cached games shouldn't
        // stretch the sweep out to nothing.
        await sleep(CALL_SPACING_MS);
      }
    } catch (err) {
      // One bad game must not abort the sweep.
      console.error(`Price refresh failed (game ${gameId}):`, err);
    }
  }

  if (refreshed) {
    console.log(`Price refresh: updated ${refreshed}/${entries.length} wishlisted games`);
  }
}

export function startPriceRefresh(): void {
  const run = () => runSweep().catch((err) => console.error('Price refresh sweep error:', err));
  setTimeout(run, FIRST_RUN_DELAY_MS);
  setInterval(run, REFRESH_INTERVAL_MS);
  console.log('💲 Price refresh scheduled');
}
