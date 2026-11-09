import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

let pool;
let client;
try {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !email.includes('@') || !/^[\x21-\x7e]+$/.test(email) || email.length > 254) {
    throw new Error('Invalid admin email');
  }
  if (!password || password.length < 12 || password.length > 128) throw new Error('Invalid admin password');
  const { isEmail } = await import('class-validator');
  if (!isEmail(email, { allow_utf8_local_part: false })) throw new Error('Invalid admin email');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Missing database configuration');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname.length < 2) throw new Error('Invalid database configuration');
  // Reject invalid input before loading the native password hasher and database driver.
  const [{ argon2id, hash }, { default: pg }] = await Promise.all([import('argon2'), import('pg')]);
  const passwordHash = await hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  client = await pool.connect();
  await client.query('BEGIN');
  const schema = url.searchParams.get('schema') ?? 'public';
  await client.query("SELECT set_config('search_path', $1, true)", [`"${schema.replaceAll('"', '""')}",pg_catalog`]);
  const role = await client.query("SELECT id FROM roles WHERE name = 'SUPER_ADMIN'");
  if (!role.rows[0]) throw new Error('Run the role seed first');
  // Create only: refuse to overwrite or elevate an existing account.
  const user = await client.query(
    'INSERT INTO users (first_name, last_name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    ['Store', 'Administrator', email, passwordHash],
  );
  const userId = user.rows[0].id;
  await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, role.rows[0].id]);
  await client.query('INSERT INTO audit_logs (action, entity_type, entity_id) VALUES ($1, $2, $3)',
    ['auth.bootstrap_admin', 'user', userId]);
  await client.query('COMMIT');
  console.log(`Created a new SUPER_ADMIN account (${userId}). No existing account was changed.`);
} catch {
  if (client) await client.query('ROLLBACK').catch(() => undefined);
  console.error('Admin creation failed. Run db:seed first; supply a new valid BOOTSTRAP_ADMIN_EMAIL and a 12–128 character BOOTSTRAP_ADMIN_PASSWORD. Existing accounts are never modified.');
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
