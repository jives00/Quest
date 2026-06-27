/**
 * Backfill DLC/expansion grouping for achievements via TrueSteamAchievements.
 * Run: pnpm --filter @quest/api backfill-dlc-groups
 *
 * For every game with a Steam appid and stored achievements, scrape TSA's
 * per-DLC achievement lists and tag matching achievements with `dlc_app_name`
 * (matched by display name; Steam APIs don't tag achievements by DLC). This is
 * the same logic enrichGame runs per-game — this script applies it library-wide.
 *
 * TSA is behind Cloudflare; the client uses node:https (see tsa.client.ts).
 * To stay polite we wait between games — generous by default.
 *
 * Flags:
 *   --delay=<ms>    Pause between games (default 5000).
 *   --app-id=<id>   Only process this Steam appid.
 *   --only-missing  Skip games that already have any dlc_app_name set.
 *
 * Safe to re-run — each game's grouping is reset then re-applied (idempotent).
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import mysql, { RowDataPacket } from 'mysql2/promise';
import { getTrueSteamAchievementGroups } from '../src/services/tsa.client';

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
const onlyMissing = process.argv.includes('--only-missing');
const DELAY_MS = (() => {
  const flag = process.argv.find(a => a.startsWith('--delay='));
  return flag ? Number(flag.split('=')[1]) : 5000;
})();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const ts = () => new Date().toISOString().slice(11, 19);

async function main() {
  const conn = await mysql.createConnection(dbConfig);
  console.log(`Connected to ${dbConfig.database}@${dbConfig.host}`);

  // Games with a Steam appid AND at least one stored achievement.
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT e.external_id AS appId, e.game_id AS gameId, g.title,
            COUNT(a.id) AS achCount,
            SUM(a.dlc_app_name IS NOT NULL) AS groupedCount
       FROM external_game_ids e
       JOIN games g        ON g.id = e.game_id
       JOIN achievements a ON a.game_id = e.game_id
      WHERE e.source = 'steam_appid'
        ${onlyAppId ? 'AND e.external_id = ?' : ''}
      GROUP BY e.game_id, e.external_id, g.title
      ORDER BY e.game_id ASC`,
    onlyAppId ? [onlyAppId] : [],
  );

  const queue = onlyMissing
    ? rows.filter(r => Number(r.groupedCount) === 0)
    : rows;
  console.log(
    `${rows.length} games with achievements; processing ${queue.length}` +
      `${onlyMissing ? ' (--only-missing)' : ''}. Delay ${DELAY_MS}ms between games.\n`,
  );

  let withGroups = 0;
  let noGroups = 0;
  let failed = 0;
  let totalTagged = 0;

  for (let i = 0; i < queue.length; i++) {
    const { appId, gameId, title } = queue[i] as { appId: string; gameId: number; title: string };
    const appIdNum = Number(appId);
    const prefix = `[${ts()}] [${i + 1}/${queue.length}] ${title} (app ${appId})`;

    try {
      const groups = await getTrueSteamAchievementGroups(appIdNum);
      if (groups.length === 0) {
        process.stdout.write(`${prefix} — no DLC groups\n`);
        noGroups++;
      } else {
        // Map normalized display name -> api_name for this game.
        const [achRows] = await conn.query<RowDataPacket[]>(
          `SELECT api_name, name FROM achievements WHERE game_id = ?`,
          [gameId],
        );
        const apiNameByName = new Map<string, string>();
        for (const r of achRows) {
          const nm = r.name as string | null;
          if (nm) apiNameByName.set(normalize(nm), r.api_name as string);
        }

        // Reset prior grouping so removed/renamed groups don't linger.
        await conn.query(`UPDATE achievements SET dlc_app_name = NULL WHERE game_id = ?`, [gameId]);

        let tagged = 0;
        const groupSummary: string[] = [];
        for (const group of groups) {
          const apiNames = group.achievementNames
            .map(n => apiNameByName.get(normalize(n)))
            .filter((v): v is string => Boolean(v));
          if (apiNames.length === 0) continue;
          tagged += apiNames.length;
          const placeholders = apiNames.map(() => '?').join(', ');
          await conn.query(
            `UPDATE achievements SET dlc_app_name = ?
              WHERE game_id = ? AND api_name IN (${placeholders})`,
            [group.dlcName, gameId, ...apiNames],
          );
          groupSummary.push(`${group.dlcName}:${apiNames.length}/${group.achievementNames.length}`);
        }

        const tsaTotal = groups.reduce((s, g) => s + g.achievementNames.length, 0);
        const warn = tagged < tsaTotal ? `  ⚠ matched ${tagged}/${tsaTotal} by name` : '';
        process.stdout.write(`${prefix} — ${groupSummary.join(', ') || 'no name matches'}${warn}\n`);
        totalTagged += tagged;
        if (tagged > 0) withGroups++;
        else noGroups++;
      }
    } catch (err) {
      process.stdout.write(`${prefix} — ERROR: ${err}\n`);
      failed++;
    }

    if (i < queue.length - 1) await sleep(DELAY_MS);
  }

  console.log(
    `\n✓ Done. Games tagged: ${withGroups}  No groups: ${noGroups}  Failed: ${failed}  ` +
      `Achievements tagged: ${totalTagged}`,
  );
  await conn.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
