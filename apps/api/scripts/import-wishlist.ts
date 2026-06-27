/**
 * Import / sync the Steam wishlist into the local "Wishlist" list for every
 * enabled Steam account. Steam is the system of record: games on the Steam
 * wishlist are added, and Steam-backed games that fell off it are removed.
 * Non-Steam (manually added) wishlist entries are left alone.
 *
 * Run: pnpm --filter @quest/api import-wishlist
 *
 * Safe to re-run. This is the same routine the hourly poller runs in prod; the
 * script just triggers it once on demand.
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../src/db';
import { isSteamEnabled } from '../src/services/steam.client';
import { syncSteamWishlist } from '../src/services/wishlist.service';

async function main() {
  if (!isSteamEnabled()) {
    console.error('STEAM_API_KEY is not set.');
    process.exit(1);
  }

  const pool = getPool();
  const [accounts] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id AS userId, steam_id64 AS steamId64
       FROM platform_accounts
      WHERE platform = 'steam' AND enabled = 1 AND steam_id64 IS NOT NULL`,
  );
  if (!accounts.length) {
    console.error('No enabled Steam account found.');
    process.exit(1);
  }

  for (const a of accounts as Array<{ id: number; userId: number; steamId64: string }>) {
    console.log(`Syncing wishlist for account ${a.id} (steamId64 ${a.steamId64})…`);
    const res = await syncSteamWishlist(a.userId, a.steamId64);
    console.log(`  ${res.total} on Steam · +${res.added} added · -${res.removed} removed`);
  }

  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
