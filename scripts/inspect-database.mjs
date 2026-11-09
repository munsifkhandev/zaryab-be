import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

let pool;
let client;
try {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Missing database configuration');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname.length < 2) {
    throw new Error('Invalid database configuration');
  }
  const schema = url.searchParams.get('schema') ?? 'public';
  pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  client = await pool.connect();
  await client.query('BEGIN READ ONLY');
  const identity = await client.query('SELECT current_database() AS database, current_user AS username');
  const tables = await client.query(
    'SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY tablename',
    [schema],
  );
  let migrations = [];
  if (tables.rows.some((row) => row.tablename === '_prisma_migrations')) {
    const identifier = `"${schema.replaceAll('"', '""')}"`;
    const result = await client.query(
      `SELECT migration_name, finished_at, rolled_back_at FROM ${identifier}."_prisma_migrations" ORDER BY started_at`,
    );
    migrations = result.rows;
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({
    ...identity.rows[0], schema,
    tables: tables.rows.map((row) => row.tablename),
    migrations,
    empty: tables.rows.length === 0,
  }, null, 2));
} catch {
  if (client) await client.query('ROLLBACK').catch(() => undefined);
  console.error('Read-only database inspection failed. Check PostgreSQL and DATABASE_URL.');
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
