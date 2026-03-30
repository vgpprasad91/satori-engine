-- Migration: 0002_create_products
-- Creates the products table for caching Shopify product data.

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  shop TEXT NOT NULL,
  shopify_product_id TEXT NOT NULL,
  title TEXT NOT NULL,
  image_url TEXT,
  last_synced TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop) REFERENCES merchants (shop) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_products_shop ON products (shop);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shop_product ON products (shop, shopify_product_id);
