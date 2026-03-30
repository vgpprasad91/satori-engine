-- Migration: 0003_create_generated_images
-- Tracks every image generation job: status, R2 location, and error info.

CREATE TABLE IF NOT EXISTS generated_images (
  id TEXT PRIMARY KEY NOT NULL,
  shop TEXT NOT NULL,
  product_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  r2_key TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- status values: pending | success | failed | quota_exceeded | timed_out
  --                quality_gate | bg_removal_failed | renderer_timeout | compositing_failed
  error_message TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop) REFERENCES merchants (shop) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_generated_images_shop ON generated_images (shop);
CREATE INDEX IF NOT EXISTS idx_generated_images_product ON generated_images (shop, product_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_status ON generated_images (status);
CREATE INDEX IF NOT EXISTS idx_generated_images_content_hash ON generated_images (content_hash);
