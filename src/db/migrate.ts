import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDbPool } from './client.js';

export async function runMigrations(): Promise<void> {
  const db = getDbPool();
  await db.query(`create table if not exists schema_migrations (
    version text primary key,
    checksum text,
    applied_at timestamptz not null default now()
  )`);

  const directory = path.resolve(process.cwd(), 'migrations');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(path.join(directory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await db.query<{ checksum: string | null }>(
      'select checksum from schema_migrations where version = $1',
      [file]
    );

    if (existing.rowCount) {
      const stored = existing.rows[0]?.checksum;
      if (stored && stored !== checksum) {
        throw new Error(`Migration checksum mismatch for ${file}; published migrations are immutable.`);
      }
      continue;
    }

    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(
        'insert into schema_migrations(version, checksum) values ($1, $2)',
        [file, checksum]
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
