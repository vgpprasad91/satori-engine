/**
 * PR-018: Image compositing and R2 storage
 *
 * Composites a background-removed product cutout onto a Satori layout PNG
 * using the Cloudflare Workers OffscreenCanvas API, then uploads the result
 * to R2 with a content-addressed key.
 *
 * Pipeline:
 *   1. Decode both input PNGs via OffscreenCanvas / createImageBitmap.
 *   2. Draw the Satori layout layer first (background), then overlay the
 *      transparent product cutout on top.
 *   3. Derive a content-addressed R2 key from sha256(templateId + brandKitHash).
 *   4. Check D1 for an existing row with the same content hash — skip upload
 *      if already stored (idempotent re-runs).
 *   5. Upload the composited PNG to R2 with immutable cache headers.
 *   6. Write the R2 key, content hash, and `success` status to D1
 *      `generated_images`.
 *   7. Increment the KV usage counter on success.
 *
 * Canvas size: 1200 × 1200 px (standard square social/product card).
 */

import { log } from "./logger.js";
import { incrementUsageCounter } from "./usage.server.js";
import type { BrandKit } from "./queue.server.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default output canvas dimensions (pixels). */
export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 1200;

/** R2 Cache-Control header applied to every uploaded image. */
export const R2_CACHE_CONTROL = "public, max-age=31536000, immutable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompositingEnv {
  /** R2 bucket for storing generated images. */
  IMAGE_BUCKET: R2Bucket;
  /** D1 database for persisting image metadata. */
  DB: D1Database;
  /** KV namespace for usage counters. */
  KV_STORE: KVNamespace;
}

export interface CompositeResult {
  /** R2 key where the image was stored. */
  r2Key: string;
  /** Hex-encoded SHA-256 content hash (used for cache hit detection). */
  contentHash: string;
  /** Whether the image was already in R2 (cache hit — upload skipped). */
  cacheHit: boolean;
  /** Composited PNG bytes. */
  pngBytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Hashing utilities
// ---------------------------------------------------------------------------

/**
 * Compute a hex-encoded SHA-256 digest of a string.
 *
 * Uses the Web Crypto API available in Cloudflare Workers.
 */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Derive a stable hash from the brand kit fields that affect image output.
 *
 * Only fields that change the rendered image are included — logoR2Key and
 * fontFamily are considered stable visual inputs.
 */
export function brandKitHash(brandKit: BrandKit): string {
  return [
    brandKit.primaryColor,
    brandKit.logoR2Key ?? "",
    brandKit.fontFamily ?? "",
  ].join("|");
}

/**
 * Generate a content-addressed R2 key for a generated product image.
 *
 * Format: `{shop}/{productId}/{sha256(templateId + brandKitString)}.png`
 *
 * @param shop        - Merchant shop domain, e.g. "mystore.myshopify.com".
 * @param productId   - Shopify product ID string.
 * @param templateId  - Satori template ID.
 * @param brandKit    - Merchant brand kit (used for hash).
 * @returns Hex content hash and the R2 key string.
 */
export async function buildR2Key(
  shop: string,
  productId: string,
  templateId: string,
  brandKit: BrandKit
): Promise<{ hash: string; r2Key: string }> {
  const hashInput = templateId + brandKitHash(brandKit);
  const hash = await sha256Hex(hashInput);
  const r2Key = `${shop}/${productId}/${hash}.png`;
  return { hash, r2Key };
}

// ---------------------------------------------------------------------------
// Canvas compositing
// ---------------------------------------------------------------------------

/**
 * Composite a product cutout (transparent PNG) onto a layout background PNG.
 *
 * Renders to an OffscreenCanvas and returns the result as a PNG Uint8Array.
 *
 * Layout layer (Satori output) is drawn first; product cutout is drawn on top
 * centred within the canvas, scaled to fit within 80% of the canvas area while
 * preserving aspect ratio.
 *
 * @param layoutPng   - Satori layout PNG as ArrayBuffer.
 * @param cutoutPng   - Background-removed product PNG as ArrayBuffer.
 * @param width       - Output canvas width in pixels.
 * @param height      - Output canvas height in pixels.
 * @returns Composited image as Uint8Array (PNG).
 */
export async function compositePngs(
  layoutPng: ArrayBuffer,
  cutoutPng: ArrayBuffer,
  width: number = CANVAS_WIDTH,
  height: number = CANVAS_HEIGHT
): Promise<Uint8Array> {
  // OffscreenCanvas is available in Cloudflare Workers (v8 isolate).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canvas = new (globalThis as any).OffscreenCanvas(width, height) as {
    getContext(id: "2d"): {
      drawImage(image: unknown, x: number, y: number, w?: number, h?: number): void;
    } | null;
    convertToBlob(opts?: { type?: string; quality?: number }): Promise<Blob>;
  };
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to get 2D rendering context from OffscreenCanvas");
  }

  // createImageBitmap is available in Cloudflare Workers (v8 isolate).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _createImageBitmap = (globalThis as any).createImageBitmap as (
    blob: Blob
  ) => Promise<{ width: number; height: number; close(): void }>;

  // Draw background layout layer (Satori PNG)
  const layoutBlob = new Blob([layoutPng], { type: "image/png" });
  const layoutBitmap = await _createImageBitmap(layoutBlob);
  ctx.drawImage(layoutBitmap, 0, 0, width, height);
  layoutBitmap.close();

  // Draw product cutout — centre + scale to 80% of canvas
  const cutoutBlob = new Blob([cutoutPng], { type: "image/png" });
  const cutoutBitmap = await _createImageBitmap(cutoutBlob);

  const maxW = width * 0.8;
  const maxH = height * 0.8;
  const scale = Math.min(maxW / cutoutBitmap.width, maxH / cutoutBitmap.height, 1);
  const scaledW = cutoutBitmap.width * scale;
  const scaledH = cutoutBitmap.height * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = (height - scaledH) / 2;

  ctx.drawImage(cutoutBitmap, offsetX, offsetY, scaledW, scaledH);
  cutoutBitmap.close();

  // Export to PNG
  const outputBlob = await canvas.convertToBlob({ type: "image/png" });
  const outputBuffer = await outputBlob.arrayBuffer();
  return new Uint8Array(outputBuffer);
}

// ---------------------------------------------------------------------------
// D1 helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a generated image with a given content hash already exists
 * in D1 for this shop + product + template combination.
 *
 * Returns the existing R2 key if found, otherwise null.
 */
export async function findExistingImage(
  shop: string,
  productId: string,
  templateId: string,
  contentHash: string,
  db: D1Database
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT r2_key FROM generated_images
       WHERE shop = ? AND product_id = ? AND template_id = ? AND content_hash = ?
       LIMIT 1`
    )
    .bind(shop, productId, templateId, contentHash)
    .first<{ r2_key: string }>();

  return row?.r2_key ?? null;
}

/**
 * Write (upsert) a `success` row to D1 `generated_images` after a successful
 * upload to R2.
 */
export async function writeSuccessRow(
  shop: string,
  productId: string,
  templateId: string,
  r2Key: string,
  contentHash: string,
  db: D1Database
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO generated_images
         (id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at)
       VALUES
         (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, 'success', NULL, datetime('now'))
       ON CONFLICT(shop, product_id, template_id) DO UPDATE SET
         r2_key       = excluded.r2_key,
         content_hash = excluded.content_hash,
         status       = 'success',
         error_message = NULL,
         generated_at = excluded.generated_at`
    )
    .bind(shop, productId, templateId, r2Key, contentHash)
    .run();
}

// ---------------------------------------------------------------------------
// Main compositing + upload orchestrator
// ---------------------------------------------------------------------------

/**
 * Composite the product cutout onto the Satori layout PNG and store the
 * result in R2, D1, and update KV usage counters.
 *
 * Steps:
 *   1. Compute content-addressed R2 key from sha256(templateId + brandKit).
 *   2. Check D1 for an existing row with the same hash — return early if found.
 *   3. Composite the two PNGs on an OffscreenCanvas.
 *   4. Upload composited PNG to R2 with immutable cache headers.
 *   5. Write `success` row to D1.
 *   6. Increment KV usage counter.
 *
 * @param shop        - Merchant shop domain.
 * @param productId   - Shopify product ID string.
 * @param templateId  - Satori template ID.
 * @param brandKit    - Merchant brand kit.
 * @param layoutPng   - Satori layout layer PNG bytes (ArrayBuffer).
 * @param cutoutPng   - Background-removed product cutout PNG bytes (ArrayBuffer).
 * @param env         - Worker bindings.
 * @returns CompositeResult with R2 key, content hash, and cache hit status.
 */
export async function compositeAndStore(
  shop: string,
  productId: string,
  templateId: string,
  brandKit: BrandKit,
  layoutPng: ArrayBuffer,
  cutoutPng: ArrayBuffer,
  env: CompositingEnv
): Promise<CompositeResult> {
  const start = Date.now();

  // Step 1: derive content-addressed key
  const { hash: contentHash, r2Key } = await buildR2Key(
    shop,
    productId,
    templateId,
    brandKit
  );

  log({
    shop,
    productId,
    step: "compositing.start",
    status: "info",
    templateId,
    r2Key,
  });

  // Step 2: cache hit check — skip compositing + upload if hash already stored
  const existingKey = await findExistingImage(
    shop,
    productId,
    templateId,
    contentHash,
    env.DB
  );

  if (existingKey !== null) {
    log({
      shop,
      productId,
      step: "compositing.cache_hit",
      status: "ok",
      templateId,
      r2Key: existingKey,
      contentHash,
    });

    // Return a placeholder pngBytes since the real image is already in R2
    return {
      r2Key: existingKey,
      contentHash,
      cacheHit: true,
      pngBytes: new Uint8Array(0),
    };
  }

  // Step 3: composite the two PNGs
  let pngBytes: Uint8Array;
  try {
    pngBytes = await compositePngs(layoutPng, cutoutPng);
  } catch (err) {
    log({
      shop,
      productId,
      step: "compositing.composite_error",
      status: "error",
      templateId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(
      `compositing_failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Step 4: upload to R2 with immutable cache headers
  try {
    await env.IMAGE_BUCKET.put(r2Key, pngBytes.buffer as ArrayBuffer, {
      httpMetadata: {
        contentType: "image/png",
        cacheControl: R2_CACHE_CONTROL,
      },
      customMetadata: {
        shop,
        productId,
        templateId,
        contentHash,
      },
    });
  } catch (err) {
    log({
      shop,
      productId,
      step: "compositing.r2_upload_error",
      status: "error",
      templateId,
      r2Key,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(
      `r2_upload_failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Step 5: write success row to D1
  try {
    await writeSuccessRow(shop, productId, templateId, r2Key, contentHash, env.DB);
  } catch (err) {
    // Log but do not fail — the image is already safely in R2
    log({
      shop,
      productId,
      step: "compositing.d1_write_error",
      status: "warn",
      templateId,
      r2Key,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 6: increment KV usage counter on success
  try {
    await incrementUsageCounter(shop, env.KV_STORE);
  } catch (err) {
    // Log but do not fail — usage counters are best-effort
    log({
      shop,
      productId,
      step: "compositing.usage_increment_error",
      status: "warn",
      templateId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const durationMs = Date.now() - start;

  log({
    shop,
    productId,
    step: "compositing.success",
    status: "ok",
    templateId,
    r2Key,
    contentHash,
    bytes: pngBytes.byteLength,
    durationMs,
  });

  return {
    r2Key,
    contentHash,
    cacheHit: false,
    pngBytes,
  };
}
