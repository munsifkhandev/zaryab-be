# Backend implementation progress

## Current scope

Implementation follows `../../docs/backend.md`. On 2026-11-09, the follow-up task
in `../../docs/error.md` authorized agent-run checks. The agent reproduced and
resolved 23 lint warnings and five dependency audit findings. Full `npm run verify`
now passes: 106 unit tests, 40 HTTP tests, zero lint warnings/errors, typecheck,
Prisma generation, build and live PostgreSQL health. The bootstrap timeout regression
also passes. Final `npm audit` reports zero vulnerabilities and install-script
inspection reports no unreviewed scripts. See [error-resolution.md](error-resolution.md).

The source now includes catalog, inventory, cart, COD checkout/orders, configured
shipping/taxes, cash collection/refunds, coupons/automatic exclusive promotions,
addresses, wishlist, verified-purchase reviews, CMS/blog/home content, customer/staff
administration, audit/outbox visibility, analytics, account recovery, newsletter,
optional email/queue/storage adapters, Docker and CI configuration. Source checks
above are verified; Docker/CI execution, provider acceptance checks and the separate
database integration suite remain unverified. No production-readiness claim is made.

The developer selected COD first and has no email/storage accounts yet. Optional
Resend, Redis/BullMQ and S3-compatible adapters default to disabled. Online payment
integration is deferred by that decision. Storefront cart/auth/checkout integration
and admin screens remain separate UI work; their existing shells are not connected
by these backend changes. Backend API compatibility is preserved.

See [orders-and-operations.md](orders-and-operations.md) for current contracts,
configuration, deployment and verification. The phase descriptions below record
earlier implementation/verification snapshots.

Earlier implementation phases left commands to the user. The later error-resolution
task authorized installation and verification; those commands were run using the
installed Windows Node/npm runtime. No migration deployment, reset, reseed or Docker
operation was performed during error resolution. Migration status confirms all
three existing migrations are applied; no schema/migration changes were needed.

## Existing code audit

- NestJS 12, strict TypeScript, ESM and Vitest already exist.
- Prisma 7 uses the PostgreSQL adapter; startup verifies connectivity with a query.
- A database health endpoint and database/environment unit tests already exist.
- At the initial audit, the Prisma schema contained infrastructure configuration only.
- Compose defines an isolated PostgreSQL 17 service on host port 5434.
- Storefront RTK Query uses Axios with credentials and validates responses with Zod.
- Admin currently contains an initial UI shell, without API integration.
- No Git repository was detected at the workspace root or in `backend`.
- Database runtime state was not inspected because operational commands are user-run.

## HTTP foundation: verified by the developer

On 2026-11-09 the developer reported successful Prisma validation, type checking,
31 unit tests, 11 foundation HTTP tests, lint (zero warnings/errors), Prisma
generation and production build. Error logs in the failure-handling tests were
expected simulated failures. These checks did not verify a live database connection.

- Shared application setup for the server and HTTP tests.
- `/api/v1` prefix, preserving the existing `GET /` greeting.
- DTO validation, safe transformation, rejection of unexpected fields and HTTP 422 failures.
- JSON/form body limit of 100 KB and bounded form parameter count.
- Generic error envelopes; internal messages, submitted values and stack traces are excluded.
- Locally generated request IDs in `X-Request-Id` and error metadata.
- Structured request logging with route templates, status and duration; no raw URLs,
  query strings, request bodies, cookies or authorization headers.
- Helmet headers; HSTS enabled in production.
- Explicit credentialed CORS for the storefront and admin origins.
- Validated rate limits, defaulting to 120 requests per 60 seconds per IP per handler.
- Health probes exempted from request throttling.
- `GET /api/v1/health/live` checks the process without querying PostgreSQL.
- `GET /api/v1/health/ready` queries PostgreSQL and returns a generic HTTP 503 on failure.
- Existing `/api/v1/health/database` route retained.
- Development Swagger at `/api/docs`, OpenAPI JSON at `/api/docs-json`.
- Swagger disabled in production.
- Observe remains available but only sends telemetry when both keys are configured.
- Unit and HTTP tests added for configuration, validation, security headers, CORS,
  rate limiting, health failures, error sanitization and Swagger visibility.

## Database foundation: developer-verified setup

The developer reported successful Prisma validation/generation, typecheck,
34 unit tests, lint and build on 2026-11-09. Read-only inspection confirmed an
empty `zaryab_ecommerce` database before the initial migration. Migration deployment
and status checks passed, seeding completed, and `db:check` confirmed PostgreSQL 17.11
connectivity with the root greeting intact. Database-backed constraint tests on the
separate `_test` database remain pending.

- 25 Prisma models: identity/access, catalog/options, inventory, audit and outbox.
- An initial transactional SQL migration with unique/FK/CHECK constraints and indexes.
- Composite foreign keys prevent assigning options from another product to a SKU.
- Integer USD-cent prices and per-variant/per-location stock balances.
- Repeatable, transactional seed for 4 roles, 16 permissions and the primary location.
- No seeded users, default passwords, sample commerce records or stock quantities.
- Read-only `db:inspect` for table and migration-state inspection before applying changes.
- Database-backed constraint tests requiring a separate explicit `_test` database.
- Seed policy unit tests added to the existing Vitest unit suite.
- Fixed the existing `db:check` script to use shared application setup after the API-prefix change.

See [database.md](database.md) for the workflow, integration database setup, model
details and remaining service-level rules. All command results above were supplied
by the developer; the agent has not run operational commands.

## Core authentication/RBAC: developer reports verification success

The developer reported `npm run verify` ran successfully after the auth changes.
No additional log or isolated auth integration results were supplied in that reply.

- Customer registration with Argon2id password hashing and customer-only role assignment.
- Login with generic credential failures and an HttpOnly database-backed session cookie.
- Default-protected routes, with explicit public root/health/login/registration routes.
- Current identity, staff identity, session credential rotation and server-side logout.
- Allowed-Origin validation for mutations and session-bound CSRF tokens for authenticated mutations.
- Role and permission guards that reload actual database grants on each request.
- Ownership-bound profile reads/updates; identity/role/password injection is rejected.
- No-store responses, bounded session TTL and strict login/registration throttling.
- Create-only administrator bootstrap CLI without default credentials.
- Unit and HTTP-boundary checks are included in the reported verify run. Isolated
  PostgreSQL auth integration tests are written; their results remain pending.

There are no new schema changes or migrations in the auth phase. Email verification,
password reset/change delivery, frontend authentication UI and admin management APIs
remain pending. See [authentication.md](authentication.md) for contracts and setup.

## Core catalog: implemented, verification pending

- Protected product creation, editing, publishing, unpublishing and archival.
- Variant creation, price changes and archival with size/color identity checks.
- Category/collection creation and collection publication.
- Public product, collection and category routes plus `/store` aliases.
- Frontend-compatible response fields with additive concrete variant IDs.
- Database-side filtering, stock aggregation, search, sorting and pagination.
- Transactional audit entries and parent row locks for product mutations.
- Unit, HTTP-boundary and PostgreSQL publishing-workflow tests written.
- `verify` now includes `test:catalog`; no new migrations or dependencies.

These changes have not been executed. See [catalog.md](catalog.md) for exact API
contracts, limitations and the remaining frontend/inventory integration work.

## Inventory and cart: implemented, verification pending

- Stock adjustments/returns with actor-scoped payload-checked idempotency.
- Conditional reservation allocation, one-time commit/release and expiry.
- Location balances, thresholds, low-stock reporting, movements and hold history.
- Secure guest/customer carts, variant ownership, quantity limits and current pricing.
- Guest bootstrap/CSRF, customer selection and authenticated login/registration merge.
- Deferred over-limit merges preserve both carts; source consumption prevents repeats.
- Persisted expiry polling, no-overlap/shutdown handling and read-only diagnostic isolation.
- Additive cart migration (27 total tables), preserving existing inventory quantities.
- Unit/HTTP tests plus committed, UUID-scoped concurrency fixtures in the guarded test DB.
- `verify` regenerates Prisma Client and includes `test:commerce`.

No operational command was run by the agent. The latest generated client still
needs regeneration and migration execution belongs to the developer. See
[inventory-and-cart.md](inventory-and-cart.md) for commands and remaining UI work.

## Commands for the developer

For the existing development database, from `backend`:

```sh
npm run db:validate
npm run db:migrate:deploy
npm run verify
```

No new dependencies were added. `preverify` regenerates Prisma Client. The initial
database was already inspected/migrated/seeded by the developer; the cart migration
now applies to that existing database. It should no longer be empty. Do not reset
it or recreate the initial migration. New installations still need the existing
seed for roles and PRIMARY. `db:migrate:status` reports pending/applied migrations.

After configuring `backend/.env` and starting the existing dedicated PostgreSQL
service, the developer can run:

```sh
npm run db:check
npm run test:e2e
npm run start:dev
```

`test:foundation` mocks the database and opens no PostgreSQL connection.
`test:e2e` also runs the existing application tests, which use `DATABASE_URL`
and perform connectivity queries. They do not reset the schema or delete data.
`test:integration` uses only an explicit separate `_test` database. Most suites roll
fixtures back; commerce concurrency fixtures commit and delete only their own UUIDs.
Follow [database.md](database.md) to create/migrate that test database first.

If desired, format the edited TypeScript before reviewing:

```sh
npm run format
```

This existing script formats all source and test TypeScript, so it can also
change formatting in pre-existing files.

## Environment

Development defaults permit `http://localhost:3000` and `http://localhost:3001`.
Override them with comma-separated `CORS_ORIGINS`, with no paths or trailing
slashes. Production requires explicitly configured HTTPS origins.

`RATE_LIMIT_MAX` accepts 1–10000; `RATE_LIMIT_TTL_MS` accepts 1000–86400000.
The current limiter uses process-local memory. Use shared storage before scaling
to multiple API processes. Proxy trust is not enabled: configure a narrowly
trusted reverse proxy before deploying behind one so client IPs remain accurate.

CORS restricts browser access to responses; it is not authentication or CSRF
protection. Auth and guest-cart cookies/CSRF defenses are implemented. Persisted
expiry polling is controlled by COMMERCE_MAINTENANCE_ENABLED and is disabled by
the database diagnostic and application health tests.

## Frontend contract findings

Do not introduce a global success envelope without coordinating the storefront:

- `/products` expects `{ items: Product[], total: number }`.
- `/products/:slug` expects a product object.
- `/collections` expects an array of collection objects.
- `/collections/:slug` expects a collection object.
- `/categories` expects an array of strings.
- Product prices are integer minor units; the current schema requires currency `USD`.
- Product responses include category, collection slugs, image URLs, sizes, colors,
  stock, availability, material and care fields.
- Axios normalizes errors by HTTP status; it does not require the backend message.

Catalog and article routes now exist, including the original storefront aliases.
Switching the storefront out of mock mode still requires actual published content
and the frontend's own validation. Browser cart/auth/checkout wiring remains pending.

## Next developer checks

1. Run `npm install` to resolve new AWS SDK, BullMQ and Sharp dependencies and update
   `package-lock.json`. Docker/CI use `npm ci` and require this updated lockfile.
2. Validate the schema, deploy pending migrations and run the seed for the two new
   `shipping.manage` / `payments.record` permissions. Seed defaults now preserve
   intentional permission removals on existing ADMIN/STAFF roles.
3. Run `npm run verify` and isolated `test:integration` after migrating the separate
   `_test` database. The agent has not run any of these commands.
4. Configure business-owned shipping/tax rules before trying checkout. Enable and
   verify optional external services only after their accounts exist.
5. Complete UI wiring, provider acceptance checks, concurrent checkout/load checks,
   backups/restore verification and production deployment review before release.
