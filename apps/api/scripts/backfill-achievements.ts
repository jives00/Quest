/**
 * Backfill Steam achievements for all owned games (not just recently played).
 * Run: pnpm --filter @quest/api backfill-achievements
 *
 * DLC grouping is handled by a separate script (TrueSteamAchievements):
 *   pnpm --filter @quest/api backfill-dlc-groups
 *
 * Iterates every Steam appid in external_game_ids, calls GetPlayerAchievements
 * + GetGameAchievements/v1 for each, and upserts into achievements / user_achievements.
 * Uses ON DUPLICATE KEY UPDATE so re-running always refreshes icons and metadata.
 *
 * Safe to re-run — inserts are idempotent.
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import mysql, { RowDataPacket } from 'mysql2/promise';
import {
  getPlayerAchievements,
  getGameAchievementsV1,
  getSchemaForGame,
} from '../src/services/steam.client';

const dbConfig = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? 'quest',
  user: process.env.DB_USER ?? 'quest',
  password: process.env.DB_PASSWORD ?? '',
  timezone: 'Z',
};

const onlyAppId = (() => {
  const flag = process.argv.find(a => a.startsWith('--app-id='));
  return flag ? flag.split('=')[1] : null;
})();
const DELAY_MS = 500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!process.env.STEAM_API_KEY) {
    console.error('STEAM_API_KEY is not set.');
    process.exit(1);
  }

  const conn = await mysql.createConnection(dbConfig);
  console.log(`Connected to ${dbConfig.database}@${dbConfig.host}`);

  // Get Steam account
  const [[account]] = await conn.query<RowDataPacket[]>(
    `SELECT pa.id, pa.user_id AS userId, pa.steam_id64 AS steamId64
       FROM platform_accounts pa
      WHERE pa.platform = 'steam' AND pa.enabled = 1 AND pa.steam_id64 IS NOT NULL
      LIMIT 1`,
  );
  if (!account) {
    console.error('No enabled Steam account found.');
    process.exit(1);
  }
  console.log(`Steam account: ${account.steamId64} (user_id=${account.userId})`);

  // Get all steam appid → game_id mappings (optionally filtered to one app)
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT e.external_id AS appId, e.game_id AS gameId, g.title
       FROM external_game_ids e
       JOIN games g ON g.id = e.game_id
      WHERE e.source = 'steam_appid'
        ${onlyAppId ? 'AND e.external_id = ?' : ''}
      ORDER BY e.game_id ASC`,
    onlyAppId ? [onlyAppId] : [],
  );
  console.log(`Found ${rows.length} Steam app mappings to process.\n`);

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const { appId, gameId, title } = rows[i] as { appId: string; gameId: number; title: string };
    const appIdNum = Number(appId);
    const prefix = `[${i + 1}/${rows.length}] ${title}`;

    try {
      const player = await getPlayerAchievements(account.steamId64, appIdNum);
      if (!player.length) {
        process.stdout.write(`${prefix} — no achievements\n`);
        skipped++;
      } else {
        const schema = await getGameAchievementsV1(appIdNum);
        // v1 omits icon hashes for some older games — fall back to GetSchemaForGame
        // which always returns full CDN icon URLs when they exist.
        const needIconFallback = schema.some(s => !s.icon);
        const fallback = needIconFallback ? await getSchemaForGame(appIdNum) : [];
        const fallbackMeta = new Map(fallback.map(s => [s.apiName, s]));
        const meta = new Map(schema.map(s => [s.apiName, s]));

        for (const a of player) {
          const m = meta.get(a.apiName);
          await conn.query(
            `INSERT INTO achievements (game_id, source, api_name, name, description, is_hidden, icon, global_pct)
             VALUES (?, 'steam', ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               name = VALUES(name),
               description = VALUES(description),
               is_hidden = VALUES(is_hidden),
               icon = VALUES(icon),
               global_pct = VALUES(global_pct)`,
            [
              gameId,
              a.apiName,
              m?.displayName ?? a.name ?? a.apiName,
              m?.description ?? null,
              m?.isHidden ? 1 : 0,
              m?.icon ?? fallbackMeta.get(a.apiName)?.icon ?? null,
              m?.globalPct ?? null,
            ],
          );
          if (a.achieved) {
            await conn.query(
              `INSERT INTO user_achievements (user_id, game_id, api_name, unlocked_at)
               VALUES (?, ?, ?, ${a.unlockTime ? 'FROM_UNIXTIME(?)' : 'NULL'})
               ON DUPLICATE KEY UPDATE unlocked_at = VALUES(unlocked_at)`,
              a.unlockTime
                ? [account.userId, gameId, a.apiName, a.unlockTime]
                : [account.userId, gameId, a.apiName],
            );
          }
        }

        const earned = player.filter(a => a.achieved).length;
        process.stdout.write(`${prefix} — ${earned}/${player.length} earned\n`);
        synced++;
      }
    } catch (err) {
      process.stdout.write(`${prefix} — ERROR: ${err}\n`);
      failed++;
    }

    if (i < rows.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n✓ Done. Synced: ${synced}  Skipped (no achievements): ${skipped}  Failed: ${failed}`);
  console.log('  DLC grouping is handled separately: pnpm --filter @quest/api backfill-dlc-groups');
  await conn.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
