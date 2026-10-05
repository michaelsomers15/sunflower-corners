-- Sunflower Corners Feed & Seed - database schema
-- Run automatically on server boot (server.js calls ensureSchema())

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  sort_order INT DEFAULT 0
);

-- A "product" is the listing shown on the site (name, description, photo,
-- category, visibility). Price/unit/stock live on product_variants below,
-- so one product can carry multiple sizes (e.g. Oats — 23 lb / 45 lb bag),
-- each with its own price and stock status, without duplicating the listing.
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  visible BOOLEAN NOT NULL DEFAULT true,
  photo BYTEA,
  photo_mime VARCHAR(50),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  -- Legacy columns from the single-price version of this app. No longer
  -- read or written by the app (all price/unit/stock data now lives in
  -- product_variants) — kept only so upgrading an existing database never
  -- requires a destructive column drop.
  price NUMERIC(10,2),
  unit VARCHAR(50) DEFAULT 'each',
  in_stock BOOLEAN DEFAULT true
);

-- Backfill for databases created before the "visible" column existed.
ALTER TABLE products ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS product_variants (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label VARCHAR(80) NOT NULL,       -- e.g. "23 lb bag", "45 lb bag", "per quart"
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Legacy flag, kept in sync with status (true only when status = 'in_stock').
  in_stock BOOLEAN NOT NULL DEFAULT true,
  -- 'in_stock' | 'sold_out' | 'coming_soon'
  status VARCHAR(20) NOT NULL DEFAULT 'in_stock',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Backfill for databases created before the three-way "status" column
-- existed: derive it from the old in_stock flag. Idempotent — the UPDATE
-- only touches rows still NULL, and SET DEFAULT / SET NOT NULL are no-ops
-- once applied.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS status VARCHAR(20);
UPDATE product_variants SET status = CASE WHEN in_stock THEN 'in_stock' ELSE 'sold_out' END WHERE status IS NULL;
ALTER TABLE product_variants ALTER COLUMN status SET DEFAULT 'in_stock';
ALTER TABLE product_variants ALTER COLUMN status SET NOT NULL;

-- One-time backfill: any product left over from the old single-price schema
-- (or created before this migration ran) gets its old price/unit/in_stock
-- turned into its first size/variant. Safe to run on every boot — it only
-- inserts for a product that doesn't already have at least one variant, so
-- it's a no-op once every product has been migrated.
INSERT INTO product_variants (product_id, label, price, in_stock, status, sort_order)
SELECT p.id, COALESCE(NULLIF(TRIM(p.unit), ''), 'each'), COALESCE(p.price, 0), COALESCE(p.in_stock, true),
       CASE WHEN COALESCE(p.in_stock, true) THEN 'in_stock' ELSE 'sold_out' END, 0
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);

-- Simple key/value store for site-wide settings (hours, address, phone, about text, etc.)
CREATE TABLE IF NOT EXISTS site_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_visible ON products(visible);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

-- Amazon affiliate "Our Picks" — recommended items (bird houses, feeders,
-- garden supplies) that link out to Amazon. The site's Associate tag is
-- added to amazon.com links at render time (see lib/affiliate.js), so links
-- can be pasted in plain. No prices are stored: Amazon's Associates rules
-- don't allow showing prices that aren't pulled live from Amazon.
CREATE TABLE IF NOT EXISTS affiliate_links (
  id SERIAL PRIMARY KEY,
  section VARCHAR(100) NOT NULL DEFAULT 'Recommended',   -- e.g. "Bird Houses & Feeders"
  title VARCHAR(150) NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  photo BYTEA,
  photo_mime VARCHAR(50),
  visible BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_links_visible ON affiliate_links(visible);
