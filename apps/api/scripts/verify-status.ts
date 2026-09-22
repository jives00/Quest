import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });
import { getPool } from '../src/db';

async function main() {
  const [rows] = await getPool().query<any[]>(
    `SELECT gs.game_id, g.title, gs.status, gs.started_at
       FROM game_status gs JOIN games g ON g.id = gs.game_id
      ORDER BY gs.status`,
  );
  console.log('Statuses:');
  for (const r of rows) console.log(JSON.stringify(r));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
