BEGIN;
ALTER TABLE products ADD COLUMN tax_class VARCHAR(30) NOT NULL DEFAULT 'STANDARD';
CREATE TYPE "OrderStatus" AS ENUM ('CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING','PAID','PARTIALLY_REFUNDED','REFUNDED');
CREATE TABLE shipping_methods (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) NOT NULL, countries TEXT[] NOT NULL,
 fee INTEGER NOT NULL CHECK(fee BETWEEN 0 AND 1000000000), free_above INTEGER CHECK(free_above >= 0),
 shipping_tax_bps INTEGER NOT NULL CHECK(shipping_tax_bps BETWEEN 0 AND 10000), is_active BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(cardinality(countries) BETWEEN 1 AND 100)
);
CREATE TABLE tax_rates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), country CHAR(2) NOT NULL CHECK(country ~ '^[A-Z]{2}$'),
 tax_class VARCHAR(30) NOT NULL, rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 0 AND 10000),
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX tax_rates_country_tax_class_key ON tax_rates(country,tax_class);
CREATE TABLE coupons (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(64) NOT NULL CHECK(code ~ '^[A-Z0-9_-]{2,64}$'),
 kind VARCHAR(20) NOT NULL CHECK(kind IN ('PERCENTAGE','FIXED')), value INTEGER NOT NULL CHECK(value > 0),
 minimum_subtotal BIGINT NOT NULL DEFAULT 0 CHECK(minimum_subtotal >= 0), usage_limit INTEGER CHECK(usage_limit > 0),
 per_customer_limit INTEGER CHECK(per_customer_limit > 0), starts_at TIMESTAMPTZ(3) NOT NULL, ends_at TIMESTAMPTZ(3),
 is_active BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(ends_at IS NULL OR ends_at > starts_at), CHECK((kind='PERCENTAGE' AND value<=10000) OR (kind='FIXED' AND value<=1000000000))
);
CREATE UNIQUE INDEX coupons_code_key ON coupons(code);
CREATE TABLE promotions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), coupon_id UUID NOT NULL, priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 10000),
 CONSTRAINT promotions_coupon_id_fkey FOREIGN KEY(coupon_id) REFERENCES coupons(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX promotions_coupon_id_key ON promotions(coupon_id);
CREATE INDEX promotions_priority_id_idx ON promotions(priority,id);
CREATE TABLE coupon_targets (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), coupon_id UUID NOT NULL, product_id UUID, collection_id UUID,
 CHECK((product_id IS NULL) <> (collection_id IS NULL)),
 CONSTRAINT coupon_targets_coupon_id_fkey FOREIGN KEY(coupon_id) REFERENCES coupons(id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT coupon_targets_product_id_fkey FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT coupon_targets_collection_id_fkey FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX coupon_targets_coupon_id_product_id_key ON coupon_targets(coupon_id,product_id);
CREATE UNIQUE INDEX coupon_targets_coupon_id_collection_id_key ON coupon_targets(coupon_id,collection_id);
CREATE INDEX coupon_targets_product_id_idx ON coupon_targets(product_id);
CREATE INDEX coupon_targets_collection_id_idx ON coupon_targets(collection_id);
CREATE TABLE checkout_sessions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cart_id UUID NOT NULL, request JSONB NOT NULL,
 price_hash CHAR(64) NOT NULL, expires_at TIMESTAMPTZ(3) NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT checkout_sessions_cart_id_fkey FOREIGN KEY(cart_id) REFERENCES carts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(expires_at > created_at)
);
CREATE INDEX checkout_sessions_cart_id_expires_at_idx ON checkout_sessions(cart_id,expires_at);
CREATE TABLE orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_number VARCHAR(40) NOT NULL, customer_id UUID, cart_id UUID NOT NULL,
 checkout_session_id UUID NOT NULL, guest_token_hash CHAR(64), guest_access_expires_at TIMESTAMPTZ(3),
 idempotency_key VARCHAR(256) NOT NULL, request_hash CHAR(64) NOT NULL,
 status "OrderStatus" NOT NULL DEFAULT 'CONFIRMED', fulfillment_status VARCHAR(20) NOT NULL DEFAULT 'UNFULFILLED',
 payment_status "PaymentStatus" NOT NULL DEFAULT 'PENDING', payment_method VARCHAR(20) NOT NULL DEFAULT 'COD' CHECK(payment_method='COD'),
 currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK(currency='USD'), subtotal BIGINT NOT NULL CHECK(subtotal>=0),
 discount_total BIGINT NOT NULL CHECK(discount_total BETWEEN 0 AND subtotal), shipping_total BIGINT NOT NULL CHECK(shipping_total>=0),
 tax_total BIGINT NOT NULL CHECK(tax_total>=0), grand_total BIGINT NOT NULL CHECK(grand_total>=0), shipping_name VARCHAR(100) NOT NULL,
 tax_snapshot JSONB NOT NULL DEFAULT '{}', paid_at TIMESTAMPTZ(3), created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(grand_total=subtotal-discount_total+shipping_total+tax_total),
 CHECK((customer_id IS NULL) <> (guest_token_hash IS NULL)),
 CHECK((guest_token_hash IS NULL) = (guest_access_expires_at IS NULL)),
 CHECK(fulfillment_status IN ('UNFULFILLED','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
 CONSTRAINT orders_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT orders_cart_id_fkey FOREIGN KEY(cart_id) REFERENCES carts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT orders_checkout_session_id_fkey FOREIGN KEY(checkout_session_id) REFERENCES checkout_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX orders_order_number_key ON orders(order_number);
CREATE UNIQUE INDEX orders_checkout_session_id_key ON orders(checkout_session_id);
CREATE UNIQUE INDEX orders_idempotency_key_key ON orders(idempotency_key);
CREATE INDEX orders_customer_id_created_at_id_idx ON orders(customer_id,created_at,id);
CREATE INDEX orders_guest_token_hash_guest_access_expires_at_idx ON orders(guest_token_hash,guest_access_expires_at);
CREATE INDEX orders_status_created_at_id_idx ON orders(status,created_at,id);
CREATE INDEX orders_paid_at_id_idx ON orders(paid_at,id);
CREATE TABLE order_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL, product_id UUID NOT NULL, variant_id UUID NOT NULL,
 product_name VARCHAR(200) NOT NULL, sku VARCHAR(100) NOT NULL, selection JSONB NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99), unit_price INTEGER NOT NULL CHECK(unit_price BETWEEN 0 AND 1000000000),
 discount_total BIGINT NOT NULL CHECK(discount_total BETWEEN 0 AND unit_price::bigint*quantity),
 tax_total BIGINT NOT NULL CHECK(tax_total>=0), line_total BIGINT NOT NULL,
 CHECK(line_total=unit_price::bigint*quantity-discount_total+tax_total),
 CONSTRAINT order_items_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT order_items_product_id_fkey FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT order_items_variant_id_product_id_fkey FOREIGN KEY(variant_id,product_id) REFERENCES product_variants(id,product_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX order_items_order_id_idx ON order_items(order_id);
CREATE INDEX order_items_variant_id_idx ON order_items(variant_id);
CREATE TABLE order_addresses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL, kind VARCHAR(10) NOT NULL CHECK(kind IN ('SHIPPING','BILLING')), snapshot JSONB NOT NULL,
 CONSTRAINT order_addresses_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX order_addresses_order_id_kind_key ON order_addresses(order_id,kind);
CREATE TABLE order_status_history (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL, status "OrderStatus" NOT NULL, actor_id UUID,
 reason VARCHAR(500) NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT order_status_history_actor_id_fkey FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX order_status_history_order_id_created_at_idx ON order_status_history(order_id,created_at);
CREATE TABLE order_allocations (
 order_id UUID NOT NULL, variant_id UUID NOT NULL, location_id UUID NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 CONSTRAINT order_allocations_pkey PRIMARY KEY(order_id,variant_id,location_id),
 CONSTRAINT order_allocations_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT order_allocations_variant_id_location_id_fkey FOREIGN KEY(variant_id,location_id) REFERENCES inventory_balances(variant_id,location_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX order_allocations_variant_id_location_id_idx ON order_allocations(variant_id,location_id);
CREATE TABLE coupon_redemptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), coupon_id UUID NOT NULL, order_id UUID NOT NULL, customer_id UUID,
 released_at TIMESTAMPTZ(3), created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT coupon_redemptions_coupon_id_fkey FOREIGN KEY(coupon_id) REFERENCES coupons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT coupon_redemptions_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT coupon_redemptions_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX coupon_redemptions_order_id_key ON coupon_redemptions(order_id);
CREATE INDEX coupon_redemptions_coupon_id_released_at_idx ON coupon_redemptions(coupon_id,released_at);
CREATE INDEX coupon_redemptions_coupon_id_customer_id_released_at_idx ON coupon_redemptions(coupon_id,customer_id,released_at);
CREATE TABLE payment_transactions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL, kind VARCHAR(10) NOT NULL CHECK(kind IN ('CAPTURE','REFUND')),
 amount BIGINT NOT NULL CHECK(amount>=0), idempotency_key VARCHAR(256) NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT payment_transactions_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX payment_transactions_idempotency_key_key ON payment_transactions(idempotency_key);
CREATE INDEX payment_transactions_created_at_kind_idx ON payment_transactions(created_at,kind);
CREATE INDEX payment_transactions_order_id_idx ON payment_transactions(order_id);
CREATE TABLE refunds (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL, amount BIGINT NOT NULL CHECK(amount>0), reason VARCHAR(500) NOT NULL,
 actor_id UUID NOT NULL, idempotency_key VARCHAR(256) NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT refunds_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT refunds_actor_id_fkey FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX refunds_idempotency_key_key ON refunds(idempotency_key);
CREATE INDEX refunds_order_id_idx ON refunds(order_id);
CREATE TABLE shipments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL, carrier VARCHAR(100) NOT NULL, tracking_number VARCHAR(150) NOT NULL,
 status VARCHAR(20) NOT NULL CHECK(status IN ('SHIPPED','DELIVERED')),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT shipments_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX shipments_order_id_key ON shipments(order_id);
CREATE TABLE shipment_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), shipment_id UUID NOT NULL, status VARCHAR(20) NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT shipment_events_shipment_id_fkey FOREIGN KEY(shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX shipment_events_shipment_id_created_at_idx ON shipment_events(shipment_id,created_at);
CREATE TABLE wishlist_items (
 user_id UUID NOT NULL, product_id UUID NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT wishlist_items_pkey PRIMARY KEY(user_id,product_id),
 CONSTRAINT wishlist_items_user_id_fkey FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT wishlist_items_product_id_fkey FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE product_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, product_id UUID NOT NULL,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), title VARCHAR(200) NOT NULL, body VARCHAR(2000) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PUBLISHED','REJECTED')),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT product_reviews_user_id_fkey FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT product_reviews_product_id_fkey FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX product_reviews_user_id_product_id_key ON product_reviews(user_id,product_id);
CREATE INDEX product_reviews_product_id_status_created_at_idx ON product_reviews(product_id,status,created_at);
CREATE TABLE banners (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title VARCHAR(200) NOT NULL, image VARCHAR(2048) NOT NULL, href VARCHAR(2048) NOT NULL,
 position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0), is_published BOOLEAN NOT NULL DEFAULT false, starts_at TIMESTAMPTZ(3), ends_at TIMESTAMPTZ(3),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX banners_is_published_position_id_idx ON banners(is_published,position,id);
CREATE TABLE pages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug VARCHAR(200) NOT NULL, title VARCHAR(200) NOT NULL, paragraphs TEXT[] NOT NULL,
 is_published BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX pages_slug_key ON pages(slug);
CREATE TABLE blog_categories (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) NOT NULL, slug VARCHAR(200) NOT NULL);
CREATE UNIQUE INDEX blog_categories_slug_key ON blog_categories(slug);
CREATE TABLE blog_posts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug VARCHAR(200) NOT NULL, title VARCHAR(200) NOT NULL, excerpt VARCHAR(1000) NOT NULL,
 image VARCHAR(2048) NOT NULL, paragraphs TEXT[] NOT NULL, category_id UUID, published_at TIMESTAMPTZ(3),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT blog_posts_category_id_fkey FOREIGN KEY(category_id) REFERENCES blog_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX blog_posts_slug_key ON blog_posts(slug);
CREATE INDEX blog_posts_published_at_id_idx ON blog_posts(published_at,id);
CREATE TABLE store_content (key VARCHAR(100) PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE newsletter_subscribers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email VARCHAR(254) NOT NULL CHECK(email=lower(btrim(email))),
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','UNSUBSCRIBED')),
 token_hash CHAR(64), expires_at TIMESTAMPTZ(3), created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX newsletter_subscribers_email_key ON newsletter_subscribers(email);
CREATE UNIQUE INDEX newsletter_subscribers_token_hash_key ON newsletter_subscribers(token_hash);
CREATE TABLE media_assets (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), object_key VARCHAR(255) NOT NULL, url VARCHAR(2048) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','READY','ARCHIVED')),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 2500), height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 2500),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 5242880), alt_text VARCHAR(255) NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX media_assets_object_key_key ON media_assets(object_key);
CREATE INDEX media_assets_status_created_at_id_idx ON media_assets(status,created_at,id);
COMMIT;
