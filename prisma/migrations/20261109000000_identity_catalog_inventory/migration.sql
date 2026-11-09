-- Initial additive migration. No existing tables or records are removed.
-- Run db:inspect first; apply only to the intended Zaryab database.
BEGIN;

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "RoleName" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'STAFF', 'CUSTOMER');
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "VariantStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED');
CREATE TYPE "StockMovementType" AS ENUM ('ADJUSTMENT', 'RESERVATION', 'RELEASE', 'COMMIT', 'RETURN');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(32),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_normalized" CHECK (email = lower(btrim(email)) AND email <> '')
);

CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" "RoleName" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id"),
    CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id"),
    CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "refresh_token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_refresh_hash_format" CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "sessions_expiry" CHECK (expires_at > created_at),
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(32),
    "line1" VARCHAR(255) NOT NULL,
    "line2" VARCHAR(255),
    "city" VARCHAR(100) NOT NULL,
    "region" VARCHAR(100),
    "postal_code" VARCHAR(32),
    "country" CHAR(2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "addresses_country_format" CHECK (country ~ '^[A-Z]{2}$'),
    CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_tokens_hash_format" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "password_reset_tokens_expiry" CHECK (expires_at > created_at),
    CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_verification_tokens_hash_format" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "email_verification_tokens_expiry" CHECK (expires_at > created_at),
    CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "short_description" VARCHAR(500) NOT NULL DEFAULT '',
    "brand" VARCHAR(100),
    "material" VARCHAR(500) NOT NULL DEFAULT '',
    "care" VARCHAR(1000) NOT NULL DEFAULT '',
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "products_publication_date" CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);

CREATE TABLE "product_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "alt_text" VARCHAR(255) NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_images_position_nonnegative" CHECK (position >= 0),
    CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "categories_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE "product_categories" (
    "product_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("product_id", "category_id"),
    CONSTRAINT "product_categories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "collections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "collections_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE "product_collections" (
    "product_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    CONSTRAINT "product_collections_pkey" PRIMARY KEY ("product_id", "collection_id"),
    CONSTRAINT "product_collections_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_collections_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Prices are integer USD cents, matching the current storefront schema.
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "barcode" VARCHAR(100),
    "price" INTEGER NOT NULL,
    "compare_at_price" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "weight_grams" INTEGER,
    "status" "VariantStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_variants_price_bounds" CHECK (price BETWEEN 0 AND 1000000000),
    CONSTRAINT "product_variants_compare_price_bounds" CHECK (compare_at_price IS NULL OR compare_at_price BETWEEN price AND 1000000000),
    CONSTRAINT "product_variants_currency" CHECK (currency = 'USD'),
    CONSTRAINT "product_variants_weight_nonnegative" CHECK (weight_grams IS NULL OR weight_grams >= 0),
    CONSTRAINT "product_variants_sku_nonempty" CHECK (sku = btrim(sku) AND sku <> ''),
    CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "product_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_options_position_nonnegative" CHECK (position >= 0),
    CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "product_option_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "value" VARCHAR(100) NOT NULL,
    "color_hex" CHAR(7),
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_option_values_color_format" CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT "product_option_values_position_nonnegative" CHECK (position >= 0)
);

CREATE TABLE "variant_option_values" (
    "variant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "value_id" UUID NOT NULL,
    CONSTRAINT "variant_option_values_pkey" PRIMARY KEY ("variant_id", "option_id")
);

CREATE TABLE "inventory_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_balances" (
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("variant_id", "location_id"),
    CONSTRAINT "inventory_balances_quantity_bounds" CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand AND low_stock_threshold >= 0),
    CONSTRAINT "inventory_balances_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "inventory_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "actor_id" UUID,
    "type" "StockMovementType" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reserved_delta" INTEGER NOT NULL DEFAULT 0,
    "reason" VARCHAR(500) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_movements_nonzero_change" CHECK (quantity_delta <> 0 OR reserved_delta <> 0),
    CONSTRAINT "stock_movements_variant_id_location_id_fkey" FOREIGN KEY ("variant_id", "location_id") REFERENCES "inventory_balances"("variant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotency_key" VARCHAR(200) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_reservations_positive_quantity" CHECK (quantity > 0),
    CONSTRAINT "stock_reservations_expiry" CHECK (expires_at > created_at),
    CONSTRAINT "stock_reservations_variant_id_location_id_fkey" FOREIGN KEY ("variant_id", "location_id") REFERENCES "inventory_balances"("variant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" VARCHAR(200) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_id" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_attempts_nonnegative" CHECK (attempts >= 0)
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_status_created_at_id_idx" ON "users"("status", "created_at", "id");
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
CREATE INDEX "addresses_user_id_created_at_id_idx" ON "addresses"("user_id", "created_at", "id");
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "email_verification_tokens"("expires_at");
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE INDEX "products_status_published_at_id_idx" ON "products"("status", "published_at", "id");
CREATE INDEX "product_images_product_id_position_id_idx" ON "product_images"("product_id", "position", "id");
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "product_categories_category_id_product_id_idx" ON "product_categories"("category_id", "product_id");
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");
CREATE INDEX "collections_is_published_created_at_id_idx" ON "collections"("is_published", "created_at", "id");
CREATE INDEX "product_collections_collection_id_product_id_idx" ON "product_collections"("collection_id", "product_id");
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");
CREATE UNIQUE INDEX "product_variants_barcode_key" ON "product_variants"("barcode");
CREATE UNIQUE INDEX "product_variants_id_product_id_key" ON "product_variants"("id", "product_id");
CREATE INDEX "product_variants_product_id_status_id_idx" ON "product_variants"("product_id", "status", "id");
CREATE INDEX "product_variants_status_price_id_idx" ON "product_variants"("status", "price", "id");
CREATE UNIQUE INDEX "product_options_id_product_id_key" ON "product_options"("id", "product_id");
CREATE UNIQUE INDEX "product_options_product_id_name_key" ON "product_options"("product_id", "name");
CREATE UNIQUE INDEX "product_option_values_id_option_id_product_id_key" ON "product_option_values"("id", "option_id", "product_id");
CREATE UNIQUE INDEX "product_option_values_option_id_value_key" ON "product_option_values"("option_id", "value");
CREATE INDEX "variant_option_values_value_id_option_id_product_id_idx" ON "variant_option_values"("value_id", "option_id", "product_id");
CREATE UNIQUE INDEX "inventory_locations_code_key" ON "inventory_locations"("code");
CREATE INDEX "inventory_balances_location_id_variant_id_idx" ON "inventory_balances"("location_id", "variant_id");
CREATE UNIQUE INDEX "stock_movements_idempotency_key_key" ON "stock_movements"("idempotency_key");
CREATE INDEX "stock_movements_variant_id_location_id_created_at_id_idx" ON "stock_movements"("variant_id", "location_id", "created_at", "id");
CREATE INDEX "stock_movements_actor_id_idx" ON "stock_movements"("actor_id");
CREATE UNIQUE INDEX "stock_reservations_idempotency_key_key" ON "stock_reservations"("idempotency_key");
CREATE INDEX "stock_reservations_status_expires_at_id_idx" ON "stock_reservations"("status", "expires_at", "id");
CREATE INDEX "stock_reservations_variant_id_location_id_idx" ON "stock_reservations"("variant_id", "location_id");
CREATE INDEX "audit_logs_actor_id_created_at_id_idx" ON "audit_logs"("actor_id", "created_at", "id");
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_id_idx" ON "audit_logs"("entity_type", "entity_id", "created_at", "id");
CREATE INDEX "outbox_events_status_available_at_id_idx" ON "outbox_events"("status", "available_at", "id");
CREATE INDEX "outbox_events_aggregate_id_created_at_id_idx" ON "outbox_events"("aggregate_id", "created_at", "id");

-- Composite FKs prevent options from one product being assigned to another's SKU.
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_id_product_id_fkey"
    FOREIGN KEY ("option_id", "product_id") REFERENCES "product_options"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_variant_id_product_id_fkey"
    FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_value_id_option_id_product_id_fkey"
    FOREIGN KEY ("value_id", "option_id", "product_id") REFERENCES "product_option_values"("id", "option_id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
