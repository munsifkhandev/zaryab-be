BEGIN;
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'MERGED', 'EXPIRED');
CREATE TABLE "carts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "guest_token_hash" CHAR(64),
  "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
  "merged_into_id" UUID,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "carts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "carts_owner" CHECK ((user_id IS NULL) <> (guest_token_hash IS NULL)),
  CONSTRAINT "carts_guest_hash_format" CHECK (guest_token_hash IS NULL OR guest_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "carts_expiry" CHECK (expires_at > created_at),
  CONSTRAINT "carts_merge_state" CHECK ((status = 'MERGED') = (merged_into_id IS NOT NULL)),
  CONSTRAINT "carts_merge_owner" CHECK (status <> 'MERGED' OR user_id IS NULL),
  CONSTRAINT "carts_merge_target" CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  CONSTRAINT "carts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "carts_merged_into_id_fkey" FOREIGN KEY (merged_into_id) REFERENCES carts(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "carts_user_id_key" ON carts(user_id);
CREATE UNIQUE INDEX "carts_guest_token_hash_key" ON carts(guest_token_hash);
CREATE INDEX "carts_status_expires_at_id_idx" ON carts(status, expires_at, id);
CREATE INDEX "carts_merged_into_id_idx" ON carts(merged_into_id);
CREATE TABLE "cart_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cart_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cart_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "cart_items_quantity" CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON cart_items(cart_id, variant_id);
CREATE INDEX "cart_items_variant_id_idx" ON cart_items(variant_id);
-- Track pre-existing SKUs at the seeded primary warehouse without changing existing stock.
INSERT INTO inventory_balances (variant_id, location_id)
SELECT v.id, l.id FROM product_variants v CROSS JOIN inventory_locations l WHERE l.code = 'PRIMARY'
ON CONFLICT (variant_id, location_id) DO NOTHING;
COMMIT;
