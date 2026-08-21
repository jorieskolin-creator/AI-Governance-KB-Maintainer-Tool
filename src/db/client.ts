import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getDbPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) throw new Error('Missing required environment variable: DATABASE_URL');
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export async function checkDatabaseReady(): Promise<{ connected: boolean; schemaReady: boolean }> {
  const db = getDbPool();
  await db.query('select 1');
  const result = await db.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.tables
       where table_schema = 'public' and table_name = 'task_runs'
     ) as exists`
  );
  return { connected: true, schemaReady: result.rows[0]?.exists === true };
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
