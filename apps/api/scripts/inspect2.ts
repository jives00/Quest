import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });
import { getPool } from '../src/db';

async function main() {
  const pool = getPool();
  const [s] = await pool.query<any[]>('SELECT COUNT(*) c FROM play_sessions');
  const [p] = await pool.query<any[]>('SELECT COUNT(*) c FROM playtime_totals');
  console.log(`Before: ${s[0].c} sessions, ${p[0].c} playtime_totals`);
  await pool.query('DELETE FROM play_sessions');
  await pool.query('DELETE FROM playtime_totals');
  console.log('Wiped play_sessions + playtime_totals. Re-sync to rebaseline.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
