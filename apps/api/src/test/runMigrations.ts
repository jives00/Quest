import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import mysql from 'mysql2/promise';

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export async function runMigrations(dbName: string, dbConfig: DbConfig): Promise<void> {
  const migrationsDir = join(__dirname, '../../migrations');
  const migrationFiles = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && f !== 'test-seed.sql')
    .sort();

  const conn = await mysql.createConnection({
    ...dbConfig,
    database: dbName,
    multipleStatements: true,
  });

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT name FROM migrations');
    const applied = new Set(rows.map((r) => r.name as string));

    for (const file of migrationFiles) {
      if (applied.has(file)) continue;
      try {
        const sql = readFileSync(join(migrationsDir, file), 'utf8');
        const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
          await conn.query(stmt);
        }
        await conn.query('INSERT INTO migrations (name) VALUES (?)', [file]);
        console.log(`  applied: ${file}`);
      } catch (err: any) {
        // Skip migrations that are already partially applied
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_DUP_ENTRY') {
          await conn.query('INSERT INTO migrations (name) VALUES (?)', [file]);
          console.log(`  skipped (already applied): ${file}`);
        } else {
          throw err;
        }
      }
    }
  } finally {
    await conn.end();
  }
}
