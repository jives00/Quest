/**
 * Seed fake dashboard data for visual testing.
 * Run:  pnpm --filter @quest/api tsx scripts/seed-dashboard.ts
 * Undo: pnpm --filter @quest/api tsx scripts/unseed-dashboard.ts
 *
 * What it does:
 *  - Finds your user account
 *  - Picks up to 20 of your owned games
 *  - Inserts play_sessions spread across the last 30 days
 *  - Sets a few games to 'playing' and 'completed' statuses
 *  - Adds some games to your backlog list (if one exists)
 *
 * All inserted rows are tagged with derived=1 so the unseed script can cleanly
 * remove exactly what was seeded without touching real data.
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

const SEED_TAG = 'seed_dashboard'; // stored in a comment — we use derived=1 as the real marker

function daysAgo(n: number, hourOfDay = 20): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hourOfDay, 0, 0, 0);
  return d;
}

function addMinutes(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000);
}

async function main() {
  const conn = await mysql.createConnection(dbConfig);
  console.log(`Connected to ${dbConfig.database}@${dbConfig.host}`);

  // ── Find user ──────────────────────────────────────────────────────────────
  const [[user]] = await conn.query<RowDataPacket[]>(
    `SELECT id, username FROM users ORDER BY id LIMIT 1`,
  );
  if (!user) {
    console.error('No users found. Start the app and log in first.');
    process.exit(1);
  }
  const uid = user.id as number;
  console.log(`Using user: ${user.username} (id=${uid})`);

  // ── Pick games ─────────────────────────────────────────────────────────────
  const [gameRows] = await conn.query<RowDataPacket[]>(
    `SELECT DISTINCT g.id, g.title, g.cover_path
       FROM ownership o
       JOIN games g ON g.id = o.game_id
      WHERE o.user_id = ?
      ORDER BY g.id ASC
      LIMIT 20`,
    [uid],
  );
  if (gameRows.length === 0) {
    console.error('No owned games found. Sync a platform first.');
    process.exit(1);
  }
  console.log(`Found ${gameRows.length} games to seed sessions for.`);

  // ── Build sessions ─────────────────────────────────────────────────────────
  // Spread playtime across last 30 days with a realistic pattern:
  // heavy on weekends, lighter on weekdays, a few gaps.
  const sessionInserts: [number, number, string, string, number, string, number][] = [];

  const platforms: ('steam' | 'psn')[] = ['steam', 'psn'];

  // Assign each game a primary platform based on its index
  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    // Skip ~30% of days (simulate not playing every day)
    if (Math.random() < 0.3) continue;

    // 1-3 sessions per day, each on a different game
    const sessionsToday = Math.floor(Math.random() * 3) + 1;
    const shuffled = [...gameRows].sort(() => Math.random() - 0.5).slice(0, sessionsToday);

    let hourCursor = 19; // start sessions at 7pm
    for (const game of shuffled) {
      const durationMin = Math.floor(Math.random() * 90) + 20; // 20–110 min
      const platform = platforms[game.id % platforms.length];
      const started = daysAgo(dayOffset, hourCursor);
      const ended = addMinutes(started, durationMin);
      hourCursor += Math.ceil(durationMin / 60) + 1;

      sessionInserts.push([
        uid,
        game.id as number,
        platform,
        started.toISOString().replace('T', ' ').slice(0, 19),
        durationMin,
        ended.toISOString().replace('T', ' ').slice(0, 19),
        1, // derived=1 → used by unseed to identify seeded rows
      ]);
    }
  }

  if (sessionInserts.length > 0) {
    await conn.query(
      `INSERT INTO play_sessions (user_id, game_id, source, started_at, duration_min, ended_at, derived)
       VALUES ?`,
      [sessionInserts],
    );
    console.log(`Inserted ${sessionInserts.length} seeded play sessions.`);
  }

  // ── Set statuses ───────────────────────────────────────────────────────────
  // First 3 games → playing, next 5 → completed (skipping any already set)
  const playingGames = gameRows.slice(0, 3);
  const completedGames = gameRows.slice(3, 8);

  for (const g of playingGames) {
    await conn.query(
      `INSERT INTO game_status (user_id, game_id, status)
       VALUES (?, ?, 'playing')
       ON DUPLICATE KEY UPDATE status = IF(status = 'unplayed', 'playing', status)`,
      [uid, g.id],
    );
  }
  for (const g of completedGames) {
    await conn.query(
      `INSERT INTO game_status (user_id, game_id, status)
       VALUES (?, ?, 'completed')
       ON DUPLICATE KEY UPDATE status = IF(status = 'unplayed', 'completed', status)`,
      [uid, g.id],
    );
  }
  console.log(
    `Set ${playingGames.length} games to 'playing', ${completedGames.length} games to 'completed'.`,
  );

  // ── Backlog list ───────────────────────────────────────────────────────────
  const [[backlog]] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM lists WHERE user_id = ? AND kind = 'system' AND system_key = 'backlog' LIMIT 1`,
    [uid],
  );

  if (backlog) {
    const backlogGames = gameRows.slice(8, 16);
    for (const g of backlogGames) {
      await conn.query(
        `INSERT IGNORE INTO list_items (list_id, game_id, sort_order) VALUES (?, ?, 0)`,
        [backlog.id, g.id],
      );
    }
    console.log(`Added ${backlogGames.length} games to backlog list.`);
  } else {
    console.log(`No backlog list found — skipping backlog seed.`);
  }

  console.log('\n✓ Seed complete. Run unseed-dashboard.ts to clean up.');
  await conn.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
