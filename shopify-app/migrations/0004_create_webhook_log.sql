-- Migration: 0004_create_webhook_log
-- Append-only log of every webhook received (used for billing reconciliation and auditing).

CREATE TABLE IF NOT EXISTS webhook_log (
  webhook_id TEXT PRIMARY KEY NOT NULL,
  shop TEXT NOT NULL,
  type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_shop ON webhook_log (shop);
CREATE INDEX IF NOT EXISTS idx_webhook_log_type ON webhook_log (type);
CREATE INDEX IF NOT EXISTS idx_webhook_log_processed_at ON webhook_log (processed_at);
