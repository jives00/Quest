import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    let dbName: string;
    const workerId = process.env.VITEST_WORKER_ID;

    if (workerId) {
      const workerNum = (Number(workerId) % 18) + 1; // Map to 1-18
      dbName = `quest_test_${workerNum}`;
    } else {
      dbName = process.env.DB_NAME ?? 'quest';
    }

    pool = mysql.createPool({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 3306),
      database: dbName,
      user: process.env.DB_USER ?? 'quest',
      password: process.env.DB_PASSWORD ?? '',
      // Return DATETIME/TIMESTAMP as JS Date objects (read as UTC via the
      // connection timezone) so they serialize to ISO-8601 with a 'Z' and the
      // frontend parses them correctly. dateStrings:true drops the tz marker,
      // which made UTC timestamps render as local time (e.g. "-286m ago").
      timezone: 'Z',
      connectionLimit: 20,
      waitForConnections: true,
    });
  }
  return pool;
}
