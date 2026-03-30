-- Migration: 0001_create_merchants
-- Creates the merchants table for storing Shopify store sessions and billing info.

CREATE TABLE IF NOT EXISTS merchants (
  shop TEXT PRIMARY KEY NOT NULL,
  access_token TEXT,
  plan TEXT NOT NULL DEFAULT 'hobby',
  billing_status TEXT NOT NULL DEFAULT 'active',
  monthly_limit INTEGER NOT NULL DEFAULT 100,
  locale TEXT NOT NULL DEFAULT 'en',
  currency_format TEXT NOT NULL DEFAULT '$ {{amount}}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchants_billing_status ON merchants (billing_status);
