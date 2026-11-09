import { argon2id, hash } from 'argon2';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { testDatabaseUrl } from './helpers/test-database.js';

describe('database constraints (isolated test database)', () => {
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let passwordHash: string;
  let productId: string;
  let variantId: string;
  let locationId: string;

  beforeAll(async () => {
    const connectionString = testDatabaseUrl();
    pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, query_timeout: 5000 });
    passwordHash = await hash('isolated-test-fixture-password', { type: argon2id });
  });

  beforeEach(async () => {
    if (!pool) throw new Error('Test database was not initialized.');
    client = await pool.connect();
    await client.query('BEGIN');
    const schema = new URL(process.env.TEST_DATABASE_URL!).searchParams.get('schema') ?? 'public';
    await client.query("SELECT set_config('search_path', $1, true)", [
      `"${schema.replaceAll('"', '""')}",pg_catalog`,
    ]);
    const product = await client.query<{ id: string }>(
      'INSERT INTO products (name, slug) VALUES ($1, $2) RETURNING id',
      ['Constraint fixture', `fixture-${randomUUID()}`],
    );
    productId = product.rows[0].id;
    const variant = await client.query<{ id: string }>(
      'INSERT INTO product_variants (product_id, sku, price) VALUES ($1, $2, $3) RETURNING id',
      [productId, `FIXTURE-${randomUUID()}`, 1000],
    );
    variantId = variant.rows[0].id;
    const location = await client.query<{ id: string }>(
      'INSERT INTO inventory_locations (code, name) VALUES ($1, $2) RETURNING id',
      [randomUUID(), 'Constraint fixture'],
    );
    locationId = location.rows[0].id;
    await client.query(
      'INSERT INTO inventory_balances (variant_id, location_id, on_hand, reserved) VALUES ($1, $2, 10, 3)',
      [variantId, locationId],
    );
  });

  afterEach(async () => {
    if (client) {
      try { await client.query('ROLLBACK'); } finally { client.release(); client = undefined; }
    }
  });

  afterAll(async () => { await pool?.end(); });

  function db(): PoolClient {
    if (!client) throw new Error('Test transaction is not initialized.');
    return client;
  }

  it('rejects non-normalized email addresses', async () => {
    await expect(db().query(
      'INSERT INTO users (first_name, last_name, email, password_hash) VALUES ($1, $2, $3, $4)',
      ['Test', 'User', ' MixedCase@example.com ', passwordHash],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects duplicate normalized email addresses', async () => {
    const email = `${randomUUID()}@example.com`;
    const sql = 'INSERT INTO users (first_name, last_name, email, password_hash) VALUES ($1, $2, $3, $4)';
    await db().query(sql, ['Test', 'User', email, passwordHash]);
    await expect(db().query(sql, ['Test', 'User', email, passwordHash]))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('rejects negative prices', async () => {
    await expect(db().query('UPDATE product_variants SET price = -1 WHERE id = $1', [variantId]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('rejects compare-at prices below the selling price', async () => {
    await expect(db().query('UPDATE product_variants SET compare_at_price = 900 WHERE id = $1', [variantId]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('does not allow reserved inventory to exceed on-hand stock', async () => {
    await expect(db().query(
      'UPDATE inventory_balances SET reserved = reserved + 8 WHERE variant_id = $1 AND location_id = $2',
      [variantId, locationId],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('does not allow negative on-hand inventory', async () => {
    await expect(db().query(
      'UPDATE inventory_balances SET on_hand = -1 WHERE variant_id = $1 AND location_id = $2',
      [variantId, locationId],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('requires a publication timestamp when publishing a product', async () => {
    await expect(db().query("UPDATE products SET status = 'PUBLISHED' WHERE id = $1", [productId]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('prevents products with variants from being physically deleted', async () => {
    await expect(db().query('DELETE FROM products WHERE id = $1', [productId]))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('prevents a variant from selecting an option belonging to a different product', async () => {
    const other = await db().query<{ id: string }>(
      'INSERT INTO products (name, slug) VALUES ($1, $2) RETURNING id',
      ['Other product', `other-${randomUUID()}`],
    );
    const otherId = other.rows[0].id;
    const option = await db().query<{ id: string }>(
      'INSERT INTO product_options (product_id, name) VALUES ($1, $2) RETURNING id', [otherId, 'Size'],
    );
    const optionId = option.rows[0].id;
    const value = await db().query<{ id: string }>(
      'INSERT INTO product_option_values (product_id, option_id, value) VALUES ($1, $2, $3) RETURNING id',
      [otherId, optionId, 'M'],
    );
    await expect(db().query(
      'INSERT INTO variant_option_values (variant_id, product_id, option_id, value_id) VALUES ($1, $2, $3, $4)',
      [variantId, productId, optionId, value.rows[0].id],
    )).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts a valid atomic stock reservation change', async () => {
    const result = await db().query<{ on_hand: number; reserved: number }>(
      'UPDATE inventory_balances SET reserved = reserved + 2 WHERE variant_id = $1 AND location_id = $2 RETURNING on_hand, reserved',
      [variantId, locationId],
    );
    expect(result.rows[0]).toEqual({ on_hand: 10, reserved: 5 });
  });
});
