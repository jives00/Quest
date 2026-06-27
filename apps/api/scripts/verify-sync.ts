import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });
import { getPool } from '../src/db';

async function q(label: string, sql: string) {
  const [rows] = await getPool().query<any[]>(sql);
  console.log(`\n=== ${label} ===`);
  for (const r of rows) console.log(JSON.stringify(r));
}

async function main() {
  await q('platform health', 'SELECT platform, health, last_synced_at, last_error FROM platform_accounts');
  await q('playtime_totals', 'SELECT COUNT(*) games, SUM(total_minutes) total_min FROM playtime_totals');
  await q('play_sessions (should be 0 right after rebaseline)', 'SELECT COUNT(*) c FROM play_sessions');
  await q('Little Nightmares total', `SELECT pt.total_minutes FROM playtime_totals pt JOIN games g ON g.id=pt.game_id WHERE g.title LIKE '%Little Nightmares%'`);
  await q('top 5 by playtime', `SELECT g.title, pt.total_minutes FROM playtime_totals pt JOIN games g ON g.id=pt.game_id ORDER BY pt.total_minutes DESC LIMIT 5`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
