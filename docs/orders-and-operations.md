# COD backend: contracts and operating notes

The follow-up error-resolution task authorized agent-run checks. Installation,
Prisma generation/validation, full verification and audit now pass; see
[error-resolution.md](error-resolution.md) for actual results and remaining gaps.
Migration deployment and server operations remain developer-controlled.
The previously applied initial migration is unchanged. New work uses
`20261109010000_carts` and `20261109020000_orders_and_content`.

## Install and verify

From `backend`, in PowerShell:

```powershell
npm install
npm run db:validate
npm run db:generate
npm run typecheck
npm run db:migrate:deploy
npm run db:seed
npm run verify
```

Stop at the first failed command and inspect its output. `npm install` updates
the lockfile for `@aws-sdk/client-s3`, `bullmq` and `sharp`. Commit that resulting
lockfile with source changes before using Docker or CI, which run `npm ci`.
No new external service needs to run for the default-disabled integration tests.
Use Node 24 (`.nvmrc`) and npm 11.20.0 (`packageManager`). Docker and CI pin that npm
version so the exact-version `allowScripts` policy and strict review gate are honored.
Prisma engines/CLI and Argon2 installers are reviewed and allowed; Scarf telemetry
and the optional msgpackr accelerator installer are explicitly denied. New script
versions require review instead of blanket approval.

`verify` generates Prisma, then runs typecheck, unit tests, foundation/auth/catalog/
commerce/extended HTTP tests, lint, build and the temporary live database probe.
The diagnostic explicitly disables expiry and outbound email workers.

Database integration tests are a separate step. Create a separate database whose
name ends in `_test`, set `TEST_DATABASE_URL`, and apply all migrations to it with
Prisma before running `npm run test:integration`. Follow [database.md](database.md)
for the existing PowerShell procedure. Never point integration tests at the
development/store database. Order tests use rollback fixtures; existing inventory
concurrency tests use committed UUID-scoped fixtures and cleanup.

Unit/HTTP/database tests are written for money rounding/allocation, input injection,
ownership, permissions, stale quotes, checkout replay, stock return on cancellation,
cash/refund accounting, coupon limits, guest claiming, reset token reuse, encryption,
outbox retries and image verification. Real simultaneous checkout contention,
external-provider failures and deployment smoke tests still need developer-run
acceptance checks; a written test is not evidence it passed.

## Checkout and order rules

All routes below use `/api/v1`. Authenticate or initialize `POST customer/cart/session`
for an opaque guest cookie and CSRF token. Unsafe requests require an allowlisted
Origin and the appropriate session/guest `X-CSRF-Token`.

1. Configure an active shipping method through `admin/shipping-methods`, including
   supported two-letter countries, fee, optional free-shipping threshold and shipping
   tax basis points. Configure each destination/product tax class through
   `admin/tax-rates`; product tax class defaults to `STANDARD`. These operations
   require `shipping.manage`. No country tax exemption or free delivery is inferred.
2. Put concrete variant IDs and quantities into the cart.
3. `POST customer/checkout/quote`: send `shippingMethodId`, `email`, `shippingAddress`,
   optional `billingAddress` and optional `couponCode`. Addresses contain first/last
   name, phone, line1, city, country and optional line2/region/postalCode.
4. `POST customer/checkout/orders`: send only `{ "quoteId": "UUID" }` and a client
   `Idempotency-Key` of 8–128 allowed characters. Keep the same key/body when retrying
   the same placement. A changed body with the same key conflicts.
5. Read `GET customer/orders` or `GET customer/orders/:id`; cancel through
   `POST customer/orders/:id/cancel` with a reason while confirmed/processing and unpaid.

Quotes expire after ten minutes and hold no stock. Immediate COD placement locks
the cart, discount configuration, affected products, active warehouses and stock
rows, rechecks the quote and atomically consumes available inventory. Existing
unrelated reservations remain intact. A stale quote or unavailable quantity returns
409 without an order/stock/cart partial write. Stock and financial writes commit
in one database transaction; external calls never run inside it.

Prices/totals are integer USD cents. Discounts allocate proportionally across
eligible lines, remainder cents follow variant-ID order, and tax rounds half-up
per discounted line. Shipping tax is added separately. Free-shipping eligibility
uses merchandise after discounts. Immutable item/address/tax snapshots preserve
what was ordered. Unused expired quote requests are deleted in bounded maintenance
batches; consumed quotes have their duplicate address request scrubbed.

COD orders are immediately CONFIRMED with payment PENDING. Admin order transitions
are CONFIRMED → PROCESSING → SHIPPED → DELIVERED; shipping requires carrier and
tracking number. Shipment events here are manual staff records, not courier webhooks.
Cancellation restores original stock allocations and releases coupon usage once.
COD orders retain allocated stock until cancellation; they do not use an online
payment timeout.

After actual cash receipt, an operator with `payments.record` calls
`POST admin/orders/:id/cod/collect` on a delivered order. It records one capture and
marks payment PAID. `orders.update` alone cannot record received cash. Cash refunds
are recorded through `POST admin/orders/:id/refunds/cash`, requiring `orders.refund`,
an idempotency key, integer `amount` and `reason`. This records cash already returned;
it does not transfer money. Cumulative refunds cannot exceed collected cash. Refunds
do not restock goods; physical returns use the inventory return/adjustment workflow.
Online authorizations, provider payments/refunds and webhooks are deliberately absent
until an online provider is selected.

Guest order access uses the guest cookie hash and expires after 30 days. Placement
renews its browser cookie. Login merge claims matching guest orders and redemptions
for the user and removes guest access. Guest token hashes and internal intent keys
are excluded from order responses. Losing a guest cookie loses that access capability;
an arbitrary email/order number cannot claim an order.

## Discounts

`admin/coupons` supports fixed/percentage amounts, time windows, global/customer
limits, minimum order amount and product/collection targets. Percent values use
basis points: 1000 means 10%. Per-customer limits require an authenticated customer.
Cancellation releases usage, and coupon updates lock the existing record before
merging partial fields.

`POST admin/promotions` attaches a coupon's rules as an automatic promotion using
`couponId` and `priority`. The highest eligible priority wins; ties use promotion ID
ascending. An explicit valid coupon code takes precedence over automatic promotions.
The stacking policy is **EXCLUSIVE**: one discount per quote, including product and
collection targeting. Configure the linked coupon's activity/dates to disable an
automatic campaign. At most 100 automatic configurations are accepted. A promotion
change requires a new quote when it changes the resulting price snapshot.

## Customer, administration and content APIs

- `customer/addresses`: owner-scoped list/create/update/delete, at most 20 addresses.
- `customer/wishlist` and `/items`: owner-scoped saved products, at most 200 items;
  unavailable product references return a null product rather than private content.
- `customer/reviews`: one review per product/customer after delivered, collected
  purchase; moderation starts PENDING. Public reads expose published reviews and
  first name only. `admin/reviews` moderation requires product permissions.
- `admin/customers`: customer-only reads/status changes, never staff access changes.
- `admin/users`, `/users/:id/roles`, `/roles`, `/permissions`: root-only access
  administration plus required permissions. Own access cannot be changed; concurrent
  status/role changes cannot remove the last active root. Access changes revoke
  sessions. SUPER_ADMIN and CUSTOMER permission sets are immutable through the API;
  editable staff roles cannot receive `users.manage` or `roles.manage`.
- `admin/audit-logs` and `admin/outbox-events`: root-only bounded inspection; outbox
  payloads/ciphertexts are excluded. No automatic replay after unknown old delivery.
- `admin/dashboard/summary` (also `admin/analytics`): all-time capture/refund cash
  ledger metrics, order/customer/product counts and stock aggregates. Average
  collected order is gross captured cash divided by captured-order count, truncated
  to integer cents. Paid-order count means current PAID status.
- `admin/dashboard/sales?days=30`: 1–366 UTC calendar days including today, grouped
  by ledger date. Refunds count on their own record date; a day's net may be negative.
  Dates with no ledger activity are omitted. `/recent-orders` returns ten orders;
  `/top-products` returns lifetime delivered/ever-collected units before cash refunds;
  `/low-stock` returns up to twenty active warehouse/SKU balances below their threshold.

Public `articles` and `articles/:slug` retain the storefront's article shape, including
the ISO date-only `date`; only published/current articles are returned. `store/pages`,
`store/banners`, `store/home` and `store/blog-categories` provide published content.
Their management routes under `admin` require `cms.manage`. Text content is plain
text paragraphs, not arbitrary executable HTML. Banners have publication schedules.
Home configuration contains ordered curated/new/collection sections, announcement,
hero banner IDs, footer links/copy and a countdown campaign. Validate referenced IDs
when publishing. Unpublishing a referenced product later still hides it from product
APIs; consumers must tolerate missing references. Content APIs read current database
state; storefront Next cache tags/revalidation still need frontend integration.

## Email and background work

Defaults: `EMAIL_PROVIDER=disabled`, `ASYNC_JOBS_ENABLED=false`. Requests that need
email return 503 before looking up an email address while disabled. Password changes
and consumption of already-issued valid tokens remain available.

Implemented routes: `auth/forgot-password`, `/reset-password`, `/change-password`,
`/verification-email`, `/verify-email`; newsletter routes are
`store/newsletter/subscribe`, `/confirm`, `/unsubscribe`. Reset tokens last 30 minutes,
verification tokens 24 hours; only hashes are stored in token tables. A successful
reset/change revokes all sessions and unused reset tokens. Password change verifies
the old credential and requires a fresh login. Login/password mutation share a user
row lock so an old password cannot create a session after a completed reset.

Optional Resend support requires `EMAIL_PROVIDER=resend`, `ASYNC_JOBS_ENABLED=true`,
`REDIS_URL`, `RESEND_API_KEY`, a verified `EMAIL_FROM`, `STOREFRONT_URL` and a locally
generated 32-byte `EMAIL_ENCRYPTION_KEY` encoded as 64 hexadecimal characters. Never
paste secrets into chat. An account/provider is not provisioned by this repository.
Keep the encryption key stable while messages are pending; rotate/drain deliberately.

Transactional outbox messages containing links are encrypted with AES-256-GCM;
BullMQ jobs contain event IDs only. Database leases and attempt checks coordinate
workers, with bounded exponential retries and generic logs. Each send uses the
event ID as provider idempotency key. Automatic processing stops after five attempts
or 23 hours from event creation. Resend documents a 24-hour deduplication lifetime;
old/unknown sends need provider-side reconciliation before any manual replay.
See [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).
DELIVERED means provider acceptance, not proof of inbox arrival; bounce/complaint
webhooks and marketing broadcast campaigns are not implemented.

`docker compose -f compose.services.yml up -d` starts the separate, loopback-bound
development Redis on port 6380. It does not change existing PostgreSQL containers or
volumes. Production Redis must be private/authenticated, persistent and configured
without eviction. BullMQ and Redis configuration follows the
[BullMQ connection documentation](https://docs.bullmq.io/guide/connections).
Expiry/unused-quote maintenance stays as bounded DB polling controlled by
`COMMERCE_MAINTENANCE_ENABLED`; enable it on a running API instance.

Email links use fragments so tokens do not appear in request URLs or access logs.
The storefront must implement the reset/verification/newsletter pages, read the
fragment locally and POST the token with an allowed Origin. These UI pages are not
created by the backend implementation.

## Media

`STORAGE_PROVIDER=disabled` is the default. To enable S3-compatible storage, set
`STORAGE_PROVIDER=s3`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, and `MEDIA_PUBLIC_URL`; optional `S3_ENDPOINT` and
`S3_FORCE_PATH_STYLE=true` support compatible services. Production endpoints require
HTTPS. Configure the bucket/CDN separately: only the public image prefix should be
readable, with writes restricted to the service identity. No public/private bucket
policy or credentials are created by the code.

`POST admin/media` accepts one multipart `file`, at most 5 MiB, with
`products.update`. JPEG/PNG/WebP MIME declarations must match decoded bytes; SVG,
animations, malformed files and oversized pixel counts are rejected. Sharp decodes,
rotates, bounds dimensions to 2500 pixels and re-encodes WebP without original
metadata. Object names are generated UUIDs. Only READY assets are returned by
`GET admin/media`; use their URL in catalog/CMS associations.

Object storage calls run outside DB transactions. A failed/unknown upload leaves a
PENDING row for reconciliation. `POST admin/media/cleanup-pending` removes objects
for PENDING rows older than an hour, then archives those records, at most 100 per
call. READY/published assets are not deleted by cleanup. Signed direct uploads are
not used: uploads pass through server verification. Storage and image APIs follow
the [AWS S3 SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/)
and [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/) contracts.

## Deployment and remaining acceptance work

`Dockerfile` has build, migrate and non-root runtime targets. Runtime uses
`node dist/main.js`, omits development dependencies and probes actual readiness.
Build with `docker build -t zaryab-backend .` after updating the lockfile. The migrate
target supplies Prisma CLI for an explicit deploy job; migration/seed do not run on
every API startup. Supply real database and HTTPS CORS origins through runtime
environment. Container database URLs must use a reachable host/service, not the
host-only `localhost:5434` connection string. Never bake `.env` or dev passwords
into images. Seed from the tooling/development environment, not the lean runtime.

The root workflow `.github/workflows/backend.yml` installs from the lockfile, uses
disposable PostgreSQL databases, migrates both application and isolated test schemas,
seeds, runs verification/integration tests and audits production dependencies. It
has not been executed here and does not deploy to an external service.

Before production: run the checks above, concurrent last-unit/coupon checkout tests,
real email/storage/Redis failure checks, TLS/cookie and proxy/IP-rate-limit review,
backup/restore rehearsal, secret rotation and an application smoke test. In-memory
HTTP throttling currently assumes one API instance; shared throttling and explicit
trusted-proxy configuration are required for a scaled deployment. Keep database
financial history; there is no destructive order-delete endpoint. Provider accounts,
frontend/admin UI wiring and online payment integration remain outside the verified
COD backend state. No external operation or test result has been simulated.
