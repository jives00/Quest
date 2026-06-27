/**
 * Phase 1: match a plain-text list of game names against the Quest DB and
 * produce a CSV for manual review before importing.
 *
 * Input:  completions-input.txt  (one game name per line; blank lines ignored)
 * Output: completions-review.csv (open in Excel, fix game_id / skip columns)
 *
 * Run: pnpm --filter @quest/api completions-match
 *
 * After reviewing the CSV, run: pnpm --filter @quest/api completions-import
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../src/db';

const INPUT_FILE  = join(__dirname, 'completions-input.txt');
const OUTPUT_FILE = join(__dirname, 'completions-review.csv');
const DEFAULT_YEAR = 2026;

// ─── Normalisation helpers ────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[™®©:\-–—'''"".!?,]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordSet(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

function jaccardScore(a: string, b: string): number {
  const wa = wordSet(a);
  const wb = wordSet(b);
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

interface DbGame { id: number; title: string }
type Confidence = 'exact' | 'normalized' | 'substring' | 'fuzzy' | 'none';

interface Match {
  gameId: number | '';
  matchedTitle: string;
  confidence: Confidence;
  score: number;
}

function bestMatch(input: string, games: DbGame[]): Match {
  const normInput = normalize(input);
  let best: Match = { gameId: '', matchedTitle: '', confidence: 'none', score: 0 };

  for (const g of games) {
    const normTitle = normalize(g.title);

    // 1. Exact (case-insensitive, trimmed)
    if (input.trim().toLowerCase() === g.title.trim().toLowerCase()) {
      return { gameId: g.id, matchedTitle: g.title, confidence: 'exact', score: 1 };
    }

    // 2. Normalised exact
    if (normInput === normTitle) {
      if (best.confidence !== 'exact') {
        best = { gameId: g.id, matchedTitle: g.title, confidence: 'normalized', score: 0.95 };
      }
      continue;
    }

    // 3. Substring either direction
    if (normTitle.includes(normInput) || normInput.includes(normTitle)) {
      const score = 0.8 + (0.1 * Math.min(normInput.length, normTitle.length) / Math.max(normInput.length, normTitle.length));
      if (!['exact', 'normalized'].includes(best.confidence) && score > best.score) {
        best = { gameId: g.id, matchedTitle: g.title, confidence: 'substring', score };
      }
      continue;
    }

    // 4. Word overlap (Jaccard)
    const score = jaccardScore(input, g.title);
    if (score >= 0.5 && !['exact', 'normalized', 'substring'].includes(best.confidence) && score > best.score) {
      best = { gameId: g.id, matchedTitle: g.title, confidence: 'fuzzy', score };
    }
  }

  return best;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function csvEscape(v: string | number): string {
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    console.error('Create it with one game name per line and re-run.');
    process.exit(1);
  }

  const names = readFileSync(INPUT_FILE, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  console.log(`Read ${names.length} names from ${INPUT_FILE}`);

  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id, title FROM games ORDER BY title');
  const games = rows as DbGame[];
  console.log(`Loaded ${games.length} games from DB`);

  const csvLines: string[] = [
    'input_name,game_id,matched_title,confidence,year,skip',
  ];

  const counts: Record<Confidence, number> = { exact: 0, normalized: 0, substring: 0, fuzzy: 0, none: 0 };

  for (const name of names) {
    const m = bestMatch(name, games);
    counts[m.confidence]++;
    csvLines.push(
      [
        csvEscape(name),
        csvEscape(m.gameId),
        csvEscape(m.matchedTitle),
        csvEscape(m.confidence),
        csvEscape(DEFAULT_YEAR),
        '',  // skip — leave blank or write Y to exclude
      ].join(','),
    );
  }

  writeFileSync(OUTPUT_FILE, csvLines.join('\n'), 'utf8');
  await pool.end();

  console.log('\nMatch summary:');
  console.log(`  exact:      ${counts.exact}`);
  console.log(`  normalized: ${counts.normalized}`);
  console.log(`  substring:  ${counts.substring}`);
  console.log(`  fuzzy:      ${counts.fuzzy}`);
  console.log(`  none:       ${counts.none}  ← fill game_id manually or set skip=Y`);
  console.log(`\nReview CSV written to: ${OUTPUT_FILE}`);
  console.log('Edit game_id / year / skip columns, then run: pnpm --filter @quest/api completions-import');
}

main().catch(err => { console.error(err); process.exit(1); });
