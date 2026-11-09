import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { permissions, rolePermissions } from './seed-data.mjs';

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
  pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('search_path', $1, true)", [
    `"${schema.replaceAll('"', '""')}",pg_catalog`,
  ]);
  const newPermissions = new Set();
  for (const [code, description] of permissions) {
    const inserted = await client.query(
      'INSERT INTO permissions (code, description) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING code',
      [code, description],
    );
    if (inserted.rowCount) newPermissions.add(code);
  }
  for (const [role, codes] of Object.entries(rolePermissions)) {
    const inserted = await client.query('INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id', [role]);
    for (const code of codes) {
      // Preserve deliberate permission removals on existing editable roles.
      if (role !== 'SUPER_ADMIN' && !inserted.rowCount && !newPermissions.has(code)) continue;
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
         WHERE r.name = $1 AND p.code = $2
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [role, code],
      );
    }
  }
  await client.query(
    "INSERT INTO inventory_locations (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING",
    ['PRIMARY', 'Primary warehouse'],
  );
  await client.query('COMMIT');
  console.log(`Seeded 4 roles, ${permissions.length} permissions, default grants and the PRIMARY inventory location.`);
  console.log('No users, passwords, products or stock quantities were created.');
} catch {
  if (client) await client.query('ROLLBACK').catch(() => undefined);
  console.error('Database seed failed. Check DATABASE_URL and apply the migrations first.');
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
