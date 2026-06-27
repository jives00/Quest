/**
 * Phase 2: import reviewed completions from CSV into game_completions.
 *
 * Input:  completions-review.csv  (edited output from completions-match)
 * Output: rows inserted into game_completions
 *
 * Rules:
 *   - Rows where skip=Y (case-insensitive) are skipped.
 *   - Rows with no game_id are skipped with a warning.
 *   - completed_at is set to July 1 of the given year at noon UTC (year-precision placeholder).
 *   - source is always 'manual'.
 *   - Safe to re-run: duplicate (user_id, game_id, completed_at) rows are skipped.
 *
 * Run: pnpm --filter @quest/api completions-import
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { readFileSync, existsSync } from 'fs';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../src/db';

const INPUT_FILE = join(__dirname, 'completions-review.csv');

// ─── CSV parser (simple — handles quoted fields with embedded commas) ──────────

function parseCsv(raw: string): Record<string, string>[] {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (vals[i] ?? '').trim(); });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { fields.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  fields.push(cur);
  return fields;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`Review CSV not found: ${INPUT_FILE}`);
    console.error('Run completions-match first, review the output, then re-run this script.');
    process.exit(1);
  }

  const raw = readFileSync(INPUT_FILE, 'utf8');
  const rows = parseCsv(raw);
  console.log(`Parsed ${rows.length} rows from ${INPUT_FILE}`);

  const pool = getPool();

  // Resolve the admin user_id
  const [users] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM users ORDER BY id LIMIT 1`,
  );
  if (!users.length) { console.error('No users found in DB.'); process.exit(1); }
  const userId = (users[0] as { id: number }).id;
  console.log(`Importing as user_id=${userId}`);

  let inserted = 0;
  let skipped  = 0;
  let warnings = 0;

  for (const row of rows) {
    const inputName = row['input_name'] ?? '';
    const skip      = (row['skip'] ?? '').toUpperCase();
    const gameId    = Number(row['game_id']);
    const year      = Number(row['year'] ?? 2026);

    if (skip === 'Y') { skipped++; continue; }

    if (!gameId || isNaN(gameId)) {
      console.warn(`  SKIP (no game_id): "${inputName}"`);
      warnings++;
      continue;
    }

    if (isNaN(year) || year < 1970 || year > 2100) {
      console.warn(`  SKIP (invalid year "${row['year']}"): "${inputName}"`);
      warnings++;
      continue;
    }

    // July 1 at noon UTC — unambiguous mid-year placeholder
    const completedAt = `${year}-07-01 12:00:00`;

    // Avoid exact duplicates (same user/game/date) — idempotent re-runs
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM game_completions WHERE user_id=? AND game_id=? AND completed_at=?`,
      [userId, gameId, completedAt],
    );
    if ((existing as RowDataPacket[]).length) {
      skipped++;
      continue;
    }

    await pool.query<ResultSetHeader>(
      `INSERT INTO game_completions (user_id, game_id, completed_at, source) VALUES (?, ?, ?, 'manual')`,
      [userId, gameId, completedAt],
    );
    inserted++;
    console.log(`  + "${row['matched_title'] || inputName}" (${year})`);
  }

  await pool.end();

  console.log(`\nDone. Inserted: ${inserted}  Skipped: ${skipped}  Warnings: ${warnings}`);
}

main().catch(err => { console.error(err); process.exit(1); });
