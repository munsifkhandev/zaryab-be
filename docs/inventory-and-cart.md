# Inventory and cart

## Status and commands

Inventory/cart code, migration, unit/HTTP tests and real database concurrency tests
are written. The agent has not run operational commands or executed these tests.
No new dependencies are required. From `backend`, run:

```sh
npm run db:validate
npm run db:migrate:deploy
npm run verify
```

Migration `20261109010000_carts` adds `carts` and `cart_items` and inserts zero PRIMARY
balances only for SKUs missing that balance. Existing quantities are preserved.
New catalog variants also receive a zero PRIMARY balance. The existing seed must
have created PRIMARY before product creation; no positive stock is fabricated.

`preverify` regenerates the ignored Prisma Client. `verify` includes typecheck,
unit tests, foundation/auth/catalog/commerce HTTP tests, lint, build and db:check.
HTTP tests mock persistence. The diagnostic explicitly disables expiry jobs.

For actual SQL/concurrency tests, create the separate `_test` database following
[database.md](database.md), apply all pending migrations there, restore the normal
development DATABASE_URL and run `npm run test:integration`. The commerce suite
commits unique fixtures so separate connections can race, then deletes only its
recorded UUIDs and related records in finally blocks. It never resets/truncates
tables. A killed process can leave fixtures in the isolated test database. Other
integration suites roll their fixture transactions back. TEST_DATABASE_URL must
explicitly target a database ending in `_test`, distinct from development.

## Inventory API

Paths are relative to `/api/v1/admin/inventory`. All mutations also require an
allowed Origin and auth X-CSRF-Token. Permission checks use actual database grants.

| Method | Suffix | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/` | inventory.read | `{ items, total }` balance list |
| GET | `/low-stock` | inventory.read | Available quantity at/below threshold |
| GET | `/movements` | inventory.read | Immutable movement history |
| GET | `/locations` | inventory.read | Paged warehouse array |
| POST | `/locations` | inventory.adjust | Create `{ code, name }` |
| PATCH | `/locations/:id/status` | inventory.adjust | Set `{ isActive }` |
| PATCH | `/:variantId/locations/:locationId/threshold` | inventory.adjust | Set `{ lowStockThreshold }` |
| POST | `/adjustments` | inventory.adjust | Stock adjustment/return restock |
| POST | `/reservations` | inventory.adjust | Create a stock hold |
| GET | `/reservations` | inventory.read | `{ items, total }` hold list |
| GET | `/reservations/:id` | inventory.read | Current hold state |
| POST | `/reservations/:id/commit` | inventory.adjust | Consume held stock |
| POST | `/reservations/:id/release` | inventory.adjust | Release held stock |
| POST | `/reservations/expire` | inventory.adjust | Process overdue holds with `{ limit }` |

Lists accept page (default 1), limit (default 20, maximum 120). Balance/movement/
reservation lists also accept variantId/locationId; reservation lists accept status.
Warehouse codes are uppercase ASCII letters/digits with underscore/hyphen, maximum
50 characters. Low stock considers tracked active warehouses and active SKUs of
non-archived products, including drafts. PRIMARY is tracked automatically; another
location is tracked after an adjustment creates its balance. Thresholds compare
available quantity, separately from the public catalog's Limited Pieces label.

Adjustment body: `{ variantId, locationId, delta, reason, type? }`.
Delta is a nonzero integer bounded by ±1,000,000,000. Type defaults to ADJUSTMENT;
RETURN requires a positive delta and is an operational restock, not a refund.
Reason is 5–500 trimmed characters. Reductions cannot consume reserved stock;
positive changes cannot overflow the PostgreSQL integer balance. A missing balance
is created atomically with its first valid adjustment.

Reservation body: `{ variantId, locationId, quantity, reason, ttlSeconds? }`.
Quantity is 1–10000; TTL defaults to 900 seconds, bounded to 60–3600. The SKU must
be active, its product published, and warehouse active. Available stock is checked
in a conditional update; balance, movement, reservation and audit writes share a
transaction. No read-then-write stock decrement is used.

Adjustment/reservation creation requires Idempotency-Key: 8–128 ASCII letters/
digits plus `.`, `_`, `:`, `-`, starting with a letter/digit. Keys are scoped by
operation and authenticated actor. Same key/payload returns the same resource ID;
changed input returns 409. Reservation replay returns its current state and never
recreates a released/expired hold. Transaction-level advisory locks serialize key
replays. PostgreSQL documents these [advisory lock semantics](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS).

```text
ACTIVE -> COMMITTED: onHand -= quantity; reserved -= quantity
ACTIVE -> RELEASED:  onHand unchanged; reserved -= quantity
ACTIVE -> EXPIRED:   onHand unchanged; reserved -= quantity
```

Terminal operations lock/recheck one reservation and write one movement/audit entry
atomically. Duplicate commit/release cannot consume/release twice. A late commit
first expires/releases the hold, commits that release, then returns 409. A committed
hold cannot be released; restock is a separate authorized operation. Inactive
warehouses block new adjustments/holds but existing holds can finish their lifecycle.
Order/payment association belongs to the future checkout module.

## Cart API and security

Paths are relative to `/api/v1/customer/cart`:

| Method | Suffix | Purpose |
| --- | --- | --- |
| GET | `/` | Current cart, prices and availability |
| POST | `/session` | Initialize guest identity and CSRF |
| POST | `/items` | Add `{ variantId, quantity }`; increment an existing line |
| PATCH | `/items/:id` | Set absolute `{ quantity }` |
| DELETE | `/items/:id` | Remove an owned line |
| DELETE | `/` | Clear owned lines |
| POST | `/merge` | Authenticated retry of a deferred guest merge |

These routes alone allow optional auth. A valid session selects its customer;
an invalid supplied session returns 401 and never downgrades silently to guest.
Without a session/guest cookie, GET returns an empty cart with null id/expiry/CSRF
and `requiresInitialization: true`, without creating state. Initialize guests via
POST `/session` with an allowed Origin and credentials enabled. Coordinate first
initialization in the browser to avoid competing initial cookie responses.

The guest capability lives in an HttpOnly, host-only, SameSite=Lax cookie:
zaryab_cart locally, __Host-zaryab_cart with Secure in production. Only its SHA-256
hash is stored. JSON exposes a session-bound CSRF token, never the raw capability.
All mutations require an allowed Origin. Guest item mutations require their guest
X-CSRF-Token; authenticated mutations require auth CSRF. Guest bootstrap uses
Origin validation; an authenticated POST `/session` also needs auth CSRF.
Cart responses are no-store. Mutations renew the guest cookie's expiry.

Database constraints enforce exactly one owner and one line per concrete variant.
At most 50 lines/99 units per variant are accepted. Owners come only from auth or
the opaque cookie, never user/cart IDs in request input. Adding/increasing checks
current publication and available stock. Reductions/removal remain possible when
stock drops or products are withdrawn. Cart row locks serialize writes.

Carts expire after 30 days without a cart mutation; viewing does not extend expiry.
Expired guests initialize a new identity. Expired customer carts are emptied and
reactivated for that owner. Empty/consumed identity records are retained; a final
physical retention/purge policy is not included.

Reads recalculate current integer USD-cent prices. Caller prices/currency/product
snapshots are rejected. Lines expose server item/variant IDs, quantity, a product
summary, SKU/size/color, unitPrice, lineTotal, availableQuantity, available and issue.
Withdrawn/archived products return no private name/image/price: product/priced
fields are null with UNAVAILABLE. Insufficient stock uses INSUFFICIENT_STOCK.
Subtotal is null if any price is unavailable; otherwise it sums exact integer
line totals. Supported size/price bounds stay within the safe integer range.
Shipping/tax/discounts are not part of this subtotal.

Adding to a cart never reserves inventory. `canCheckout` describes current cart
eligibility, not a hold or implemented checkout/order. Checkout must revalidate
and reserve transactionally in the next phase. POST `/items` increments and is
not safe for blind network retries; fetch state to resolve unknown outcomes.
PATCH sets an absolute quantity. Only database-confirmed transaction conflicts
are retried internally; unknown connection outcomes are never replayed.

## Login merge

Login/registration invoke a server-side merge and add cartMerge.status: none,
merged, already_merged, expired or deferred. Matching variant quantities sum from
database state. Merge, source consumption, destination updates and audit are one
transaction. Guest rows lock before user rows. Concurrent/repeated merges cannot
double quantities or transfer consumed guest data to another account.

Over-limit merges return deferred with CART_LIMIT or QUANTITY_LIMIT; neither cart
is clipped/discarded and the guest cookie remains. Reduce/clear customer lines and
POST `/merge` to retry. Unavailable selections remain flagged rather than silently
removed. Successful merge clears the guest cookie. Auth/session creation and merge
are separate transactions: a database failure during merge can fail the login
response; retry login rather than assuming an auth cookie was issued.

## Expiry jobs and remaining integration

Every 30 seconds the API processes up to 100 persisted overdue reservations and
100 carts in independent jobs. Ticks do not overlap in one process. Each record
is locked/rechecked in its own transaction. Competing workers/restarts cannot
repeat lifecycle effects. Shutdown clears timers and waits for the current tick.
Errors log a generic message and retry on a later tick.

COMMERCE_MAINTENANCE_ENABLED defaults true outside tests and false in test mode.
Enable it on at least one live API instance or operate expiry manually. Expired
holds conservatively reduce availability until processed and cannot be committed
after their deadline. Normal low-backlog latency is one interval plus processing;
large backlogs take longer. Bounded polling has limited throughput. Redis/BullMQ
workers are a future infrastructure upgrade, not an implemented integration.
The database probe disables jobs; application health tests override the worker.

The storefront's Redux cart still uses local/demo product snapshots. Live UI wiring
must retain catalog variant UUIDs, initialize guest identity, send CSRF and render
server totals/issues/line UUIDs. No fake live cart or unused frontend adapter was
added. Admin inventory screens are likewise pending. Checkout/orders, shipping/
taxes, payments, CMS and remaining account/email work are outside this change.
