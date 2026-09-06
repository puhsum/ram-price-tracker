-- Run this once against your Neon database before milestone 3.
-- Two tables: the kits we track, and one row per price observation we
-- pull from Rakuten. Everything the REST API and cron job read/write
-- lives in these two tables -- no ORM, so this file IS the schema.

CREATE TABLE IF NOT EXISTS products (
  id              SERIAL PRIMARY KEY,
  label           TEXT NOT NULL,        -- display name, e.g. "Crucial 32GB DDR5-5600"
  search_keyword  TEXT NOT NULL,        -- sent to Rakuten's keyword search, e.g. "DDR5 32GB 5600"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price       INTEGER NOT NULL,         -- whole yen, no decimals
  shop_name   TEXT NOT NULL,
  item_url    TEXT NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The history endpoint (GET /api/products/:id/history) always filters and
-- sorts by (product_id, fetched_at), so index that access pattern directly.
CREATE INDEX IF NOT EXISTS idx_price_snapshots_product_fetched_at
  ON price_snapshots (product_id, fetched_at);
