# Database architecture and migration workflow

## Implemented schema scope

The initial migration defines 25 tables for identity, catalog, inventory, audit
records and an outbox. The new cart migration adds two tables, bringing the current
schema to 27. Checkout, orders, payments, shipping, promotions, reviews and CMS
remain future work. Current API/test status is recorded in
[implementation-progress.md](implementation-progress.md).

All IDs use PostgreSQL-generated UUIDs, including inserts outside Prisma.
Application properties use camelCase; database columns and tables use snake_case.
Timestamps use `TIMESTAMPTZ(3)` and represent UTC instants. Prisma maintains
`updated_at` when it writes records; direct SQL updates must set that field.

## Identity

`users`, `roles`, `permissions`, `user_roles` and `role_permissions` represent
identity and authorization. `sessions`, `password_reset_tokens` and
`email_verification_tokens` persist expiring credentials as SHA-256 hashes,
never raw bearer tokens. Session family IDs support future refresh-token reuse
detection. User password hashes will be Argon2id through the authentication service.

Email normalization is `trim()` followed by lowercase in the application;
PostgreSQL enforces lowercase, surrounding-space-free, nonempty values and a
unique email index. Input validation must also reject malformed addresses and
non-ASCII email addresses so JavaScript and PostgreSQL casing rules agree.
Email format validation and password hashing will be implemented with auth.

Addresses belong to a user. Address deletion does not affect historical orders:
the future order module must store separate purchase-time address snapshots.

## Catalog

`products` hold descriptions, publication state, material and care text.
`product_variants` own SKU, barcode, price and physical weight.
`product_images`, `categories` and `collections` support public catalog rendering.
Explicit product/category and product/collection tables support many-to-many links.

`product_options`, `product_option_values` and `variant_option_values` represent
sizes and colors. Composite foreign keys ensure every selected value belongs to
the variant's own product and option. A variant can select only one value for a
given option. Color values may include a validated six-digit hex code.
Complete option sets and uniqueness of a combination across SKUs must be checked
transactionally in the catalog service; those cross-row rules are not implemented.

Slugs are unique lowercase, hyphen-separated identifiers. Products default to
draft. Publishing requires a timestamp; the future service must also validate
images, variants and publication eligibility. Catalog APIs are not yet available.

Prices are integer USD cents in the range 0–1,000,000,000, matching the existing
storefront contract. Compare-at price is optional and cannot be below the sale
price. No currency conversion or floating-point price calculations are present.
If the store needs PKR or another currency, update the storefront contract and
database constraint together before introducing that currency.

Products with variants cannot be physically deleted. Inventory and movement
references restrict variant deletion. Prefer `ARCHIVED` status. Future financial
records must retain snapshots and restrictive/nullable references, never cascade
delete through users or products.

## Inventory

`inventory_balances` has one row per variant and location. Available quantity is
`on_hand - reserved`; it is not duplicated in a second mutable field. Constraints
require `on_hand >= reserved >= 0`, with a nonnegative low-stock threshold.

`stock_movements` record on-hand and reserved deltas, actor, reason and a unique
idempotency key. `stock_reservations` hold quantities, expiration and explicit
lifecycle state. Foreign keys preserve inventory references and movement history.

The inventory service now implements atomic conditional updates, balance/movement/
reservation transactions, expiration and payload-checked idempotency. Read
[inventory-and-cart.md](inventory-and-cart.md) for operations and pending checks.
A unique key alone is not the idempotency mechanism.

## Carts

`carts` enforces one user or hashed guest-capability owner, unique owner identities,
expiry and a consumed guest's merge destination. `cart_items` stores concrete
variants and quantities, never client prices. Owner/variant references restrict
destructive deletion; ephemeral items cascade only if their cart is physically
deleted. APIs clear contents/state while retaining cart identity records.

## Audit and reliable handoff

`audit_logs` preserve action, actor and target references. `outbox_events` support
future reliable notification handoff in the same transaction as a business write.
No worker or audit-writing service is implemented yet. Their future writers must
allowlist payload fields and exclude passwords, tokens and unnecessary personal data.

## Indexes and database-only constraints

Indexes cover unique emails, role/permission codes, slugs, SKUs and barcodes;
publication/status pagination; category and collection joins; session and token
expiration; reservation expiry; stock history; and pending outbox delivery.
Stable list ordering should include `id` as a final tie-breaker.

The migration includes PostgreSQL CHECK constraints for price bounds, stock bounds,
normalized email, token hash shape/expiry, country/color/slug formats, publication
dates and nonzero stock movements. Prisma schema syntax does not represent these
CHECK constraints: preserve them when editing future migration SQL. Validate the
schema and migration together. Do not use `db push` to replace migration history.

## Initial local migration

Commands are run by the developer from `backend`:

```sh
npm run db:validate
npm run db:generate
npm run typecheck
npm test
npm run test:foundation
npm run lint
npm run build
npm run db:inspect
```

`db:inspect` opens a read-only transaction and prints the database name, schema,
table names and migration history, without credentials or user records. Check that
the target is `zaryab_ecommerce` and `empty` is `true` for this initial migration.
If existing application tables or migrations are reported, review their state
before applying the initial migration. Do not reset or manually drop tables.

Once the target is verified as the new empty Zaryab database:

```sh
npm run db:migrate:deploy
npm run db:migrate:status
npm run db:seed
npm run db:check
```

The checked-in migration is additive and wrapped in a transaction. It does not
silently skip conflicting tables. Prisma maintains `_prisma_migrations` as the
history; do not edit applied migrations. For later reviewed schema changes, use
`npm run db:migrate:dev -- --name descriptive_change`. This may require a shadow
database or PostgreSQL CREATEDB privilege. Initial deployment does not require
a shadow database. Never accept a reset prompt on a database with valuable data.

The seed uses the existing `pg` dependency and parameterized queries, so no extra
TypeScript runner or dependencies are needed. Prisma 7 runs it only on explicit
`db:seed`. It inserts four roles, sixteen permissions, baseline role grants and a
`PRIMARY` inventory location in one transaction. Repeating the seed creates no
duplicates, does not overwrite descriptions or locations, and preserves custom
grants. It restores any missing baseline grants, so review policy changes before
reseeding an environment with customized access policies. It creates no users,
default passwords, sample products, payments or stock.

## Separate integration database

Create `zaryab_ecommerce_test`, owned by `zaryab`, on the dedicated local server.
For example, run this once from DBeaver against the same local PostgreSQL service:

```sql
CREATE DATABASE zaryab_ecommerce_test OWNER zaryab;
```

Set `TEST_DATABASE_URL` in `backend/.env` using `.env.example`. Apply the checked-in
migration to that test database. In PowerShell, temporarily override only the
child process environment and restore it afterward:

```powershell
$previousDatabaseUrl = $env:DATABASE_URL
try {
  $env:DATABASE_URL = 'postgresql://zaryab:zaryab@localhost:5434/zaryab_ecommerce_test?schema=public'
  npm run db:migrate:deploy
} finally {
  if ($null -eq $previousDatabaseUrl) {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:DATABASE_URL = $previousDatabaseUrl
  }
}
npm run test:integration
```

Integration suites require an explicit database ending in `_test` and reject the
development endpoint. Most fixtures roll back. Commerce concurrency tests commit
isolated fixtures so independent connections can race, then delete only their own
recorded UUIDs and related records in finally blocks. No suite truncates tables
or resets a schema. Coverage includes constraints, auth/catalog workflows, stock
idempotency/overselling protection, cart ownership and concurrent merges.
The developer has applied the initial migration to the development database and
verified seed execution and connectivity. Migration of the separate test database
and execution of the integration suites remain pending.
