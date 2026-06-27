import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(__dirname, '../../../.env') });

import { runMigrations } from '../src/test/runMigrations';

const dbConfig = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'quest',
  password: process.env.DB_PASSWORD ?? '',
};

async function main() {
  await runMigrations(process.env.DB_NAME ?? 'quest', dbConfig);
  console.log(`✓ Migrated ${process.env.DB_NAME ?? 'quest'}`);

  // Parallel-vitest test databases (quest_test, quest_test_1..18) are only created
  // when a local test harness sets them up. Skip them unless QUEST_MIGRATE_TEST_DBS=1
  // so a normal `pnpm migrate` against the shared MySQL doesn't fail on missing DBs.
  if (process.env.QUEST_MIGRATE_TEST_DBS === '1') {
    await runMigrations('quest_test', dbConfig);
    console.log(`✓ Migrated quest_test`);
    for (let i = 1; i <= 18; i++) {
      const db = `quest_test_${i}`;
      await runMigrations(db, dbConfig);
      console.log(`✓ Migrated ${db}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
