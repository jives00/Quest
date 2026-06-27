/**
 * Remove all data inserted by seed-dashboard.ts.
 * Run: pnpm --filter @quest/api tsx scripts/unseed-dashboard.ts
 *
 * Safe to run multiple times — only touches rows the seed script created.
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import mysql from 'mysql2/promise';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const dbConfig = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? 'quest',
  user: process.env.DB_USER ?? 'quest',
  password: process.env.DB_PASSWORD ?? '',
  timezone: 'Z',
};

async function main() {
  const conn = await mysql.createConnection(dbConfig);
  console.log(`Connected to ${dbConfig.database}@${dbConfig.host}`);

  // ── Find user ──────────────────────────────────────────────────────────────
  const [[user]] = await conn.query<RowDataPacket[]>(
    `SELECT id, username FROM users ORDER BY id LIMIT 1`,
  );
  if (!user) {
    console.error('No users found.');
    process.exit(1);
  }
  const uid = user.id as number;
  console.log(`Using user: ${user.username} (id=${uid})`);

  // ── Delete seeded sessions (derived=1) ────────────────────────────────────
  const [sessRes] = await conn.query<ResultSetHeader>(
    `DELETE FROM play_sessions WHERE user_id = ? AND derived = 1`,
    [uid],
  );
  console.log(`Deleted ${sessRes.affectedRows} seeded play sessions.`);

  // ── Revert statuses back to unplayed (only if no real sessions exist) ─────
  // We only touch game_status rows where the user has no non-derived sessions,
  // so we don't clobber any real progress that happened to be set the same way.
  const [statusRes] = await conn.query<ResultSetHeader>(
    `DELETE gs FROM game_status gs
      WHERE gs.user_id = ?
        AND gs.status IN ('playing','completed','other')
        AND NOT EXISTS (
          SELECT 1 FROM play_sessions ps
          WHERE ps.user_id = gs.user_id
            AND ps.game_id = gs.game_id
            AND ps.derived = 0
        )`,
    [uid],
  );
  console.log(`Removed ${statusRes.affectedRows} seeded game statuses.`);

  // ── Remove backlog items that have no real sessions ────────────────────────
  const [[backlog]] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM lists WHERE user_id = ? AND kind = 'system' AND system_key = 'backlog' LIMIT 1`,
    [uid],
  );
  if (backlog) {
    const [listRes] = await conn.query<ResultSetHeader>(
      `DELETE li FROM list_items li
        WHERE li.list_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM play_sessions ps
            WHERE ps.user_id = ?
              AND ps.game_id = li.game_id
              AND ps.derived = 0
          )`,
      [backlog.id, uid],
    );
    console.log(`Removed ${listRes.affectedRows} seeded backlog items.`);
  }

  console.log('\n✓ Unseed complete. Dashboard data is back to real state.');
  await conn.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
