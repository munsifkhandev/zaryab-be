# Product catalog

## Status and verification

Core catalog code is implemented, with unit, HTTP-boundary and database integration
tests written. None of the new catalog checks have been run by the agent. The
catalog schema is reused. Inventory/cart development adds a cart migration and
zero PRIMARY balances; see [inventory-and-cart.md](inventory-and-cart.md).

From `backend`, run:

```sh
npm run verify
```

`verify` now includes `test:catalog` alongside typecheck, unit tests, foundation/auth
HTTP tests, lint, build and the live database connectivity probe. It stops at the
first failing check. `test:catalog` uses mocked persistence and opens no database
connection. Actual catalog persistence/SQL workflows are covered by
`npm run test:integration`, after provisioning the separate `_test` database in
[database.md](database.md). Those integration results remain pending.

## Public routes

Paths are relative to `/api/v1`:

| Method | Path | Response |
| --- | --- | --- |
| GET | `/products` | `{ items: Product[], total: number }` |
| GET | `/products/:slug` | Product |
| GET | `/categories` | Category name strings, maximum 100 |
| GET | `/collections` | Published collection objects, maximum 100 |
| GET | `/collections/:slug` | Published collection object |

Each route also supports the specification's `/store` prefix. `/store/search`
is an alias for the product listing. Aliases use the same implementation.

Product queries accept `page` (default 1, maximum 10000), `limit` (default 20,
maximum 120), `search` (maximum 100 characters), category name or slug,
published collection slug, `minPrice`, `maxPrice` and `availability`.
`sort` accepts `newest`, `price-asc` or `price-desc`. Prices are integer USD cents.
Search is a literal case-insensitive substring of the product name: `%`, `_` and
the escape character are escaped, and all user values are SQL parameters.
An inverted min/max price range receives 400; malformed DTOs receive 422.

Only published products whose publication time has arrived are public. They must
have images, a category and an active variant with Size/Color selections. Drafts,
archived products and unpublished collection details return 404. Public category
names come only from eligible products. Hidden collection links are excluded.

Listing counts, pagination and hydration share a repeatable-read transaction.
Filtering and pagination happen in PostgreSQL before loading page details.
Sorting uses publication time and ID as stable tie-breakers. Detail stock queries
restrict aggregation to the requested product. There is no application catalog
cache, and no mock fallback is used by these endpoints.

## Storefront compatibility and pricing

The legacy response preserves the existing Zod fields: id, slug, name, description,
price, originalPrice, USD currency, image URLs, category name, published collection
slugs, availability, stock, colors, sizes, optional Sale badge, material and care.
The first category by name is the legacy category field; filtering supports any
linked category. The representative price is the cheapest active eligible SKU,
including zero-stock SKUs. Its compare-at price supplies originalPrice and Sale.

An additive `variants` array includes stable variant IDs, SKU, price, originalPrice,
currency, size, color and stock. Each variant's available stock is the sum of
`on_hand - reserved` across active locations. Product stock sums eligible variants.
Display quantities are capped at 99 to satisfy the current frontend contract.
The mutually exclusive display labels are Out of Stock (0), Limited Pieces (1–3)
and In Stock (4+). This label threshold is separate from operational per-location
low-stock thresholds. The API does not fabricate initial inventory.

Product-level stock and pricing are display summaries. Future cart/checkout must
submit a specific variant ID and recheck that variant's current price and stock.
The current storefront schema strips unknown additive fields, and its local cart
does not yet use these variant IDs. Live transactional checkout is not connected.

## Protected admin routes

All admin mutations require a session cookie, allowed Origin and X-CSRF-Token.
See [authentication.md](authentication.md). Actor IDs come from authenticated
context and cannot be supplied in request bodies.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/admin/products` | products.read |
| GET | `/admin/products/:id` | products.read |
| POST | `/admin/products` | products.create |
| PATCH | `/admin/products/:id` | products.update |
| POST | `/admin/products/:id/publish` | products.update |
| POST | `/admin/products/:id/unpublish` | products.update |
| DELETE | `/admin/products/:id` | products.delete |
| POST | `/admin/products/:id/variants` | products.update |
| PATCH | `/admin/products/:id/variants/:variantId` | products.update |
| DELETE | `/admin/products/:id/variants/:variantId` | products.update |
| GET | `/admin/categories` | products.read |
| POST | `/admin/categories` | products.create |
| GET | `/admin/collections` | products.read |
| POST | `/admin/collections` | products.create |
| PATCH | `/admin/collections/:id/publication` | products.update |

Product reads return catalog records and available-stock summaries to authorized
staff. Raw on-hand/reserved balances are excluded and belong to inventory APIs.
Product lists use
`{ items, total }`, accepting page, limit and optional status. Category/collection
admin lists return paged arrays, accepting page/limit. Private responses are no-store.

Create category with `{ name, slug }`; create collection with
`{ name, slug, title, description }`. Collections start unpublished; set publication
with `{ "isPublished": true }` or false. Category/collection metadata editing and
deletion APIs are not included yet.

Create a product with this structure, replacing UUIDs and the image URL with real
category/collection IDs and a configured image source:

```json
{
  "name": "Linen Shirt",
  "slug": "linen-shirt",
  "description": "Product description",
  "material": "Linen",
  "care": "Follow the garment care label",
  "categoryIds": ["category-uuid"],
  "collectionIds": [],
  "images": [{ "url": "https://example.com/shirt.jpg", "altText": "Linen Shirt" }],
  "variants": [
    { "sku": "LINEN-M-BLACK", "size": "M", "colorName": "Black", "colorHex": "#282828", "price": 1000, "compareAtPrice": 1200 }
  ]
}
```

Creation returns `{ id, slug, status: "DRAFT" }`. It requires 1–10 categories,
0–20 collections, 1–12 HTTPS image URLs and 1–60 variants. Product edits accept
these metadata fields independently, including replacement image/category/collection
arrays. Unknown properties, null metadata and empty required arrays are rejected.
Images are URL references; binary upload/storage integration is still pending.

Variants normalize SKU and size to uppercase. SKU is globally unique, including
archived SKUs. Active size/color combinations cannot repeat within a product.
Color names are matched case-insensitively within the product and cannot acquire
conflicting hex values. Variant option identity is immutable through the current
API: add/archive variants rather than rewriting existing SKU choices. Each product
is capped at 60 total variants including archived history. Price edits require
`price`; omitting or clearing compareAtPrice removes the comparison price.

Publishing verifies images, a category and valid active variants. It uses the
database clock. Parent row locks serialize product/variant mutations and publishing.
The last eligible published variant cannot be archived without unpublishing the
product first. Product deletion archives records; it does not delete variants,
inventory or option history. Archived products cannot be edited or republished
through these APIs. Writes and their non-sensitive audit entries share a transaction.
Duplicate slugs/SKUs/combinations return 409; invalid references return 400.

## Remaining integration work

Stock adjustment/reservation APIs are now implemented. New catalog variants get a
zero PRIMARY balance and become available only after an actual authorized stock
adjustment. No successful purchase is claimed from creation alone. Their new
checks have not been executed by the agent.

The frontend already calls these product/collection/category paths, but its global
live-mode flag also switches article requests to the backend. Articles/CMS endpoints
are not implemented yet, so its demo environment has not been switched to live mode.
The storefront's server cache also needs explicit invalidation/freshness handling,
its image allowlist must match the configured CDN, and checkout must adopt variant
IDs. Full storefront integration remains pending; API compatibility is not a claim
that the whole site can already run in live mode.

Brand/SEO editing, arbitrary option axes, barcode/weight editing, bulk imports,
media storage, category/collection metadata management and an admin editing UI are
outside this catalog slice and remain unfinished. Multi-process write/load tests
have not been run. No third-party service credentials were added.
