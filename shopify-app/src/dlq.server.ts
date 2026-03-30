/**
 * PR-019: Dead letter queue handler and failure surfacing
 *
 * DLQ consumer reads failed jobs, maps the error context to a typed category,
 * and writes the final `failed` status to D1 `generated_images`.
 *
 * Error categories surfaced to the merchant dashboard:
 *   quota_exceeded | timed_out | quality_gate | bg_removal_failed |
 *   renderer_timeout | compositing_failed | unknown_error
 *
 * Regenerate endpoint helper:
 *   `reQueueJob(productId, shop, env)` — re-enqueues with a fresh idempotency
 *   key so the merchant can retry from the dashboard.
 */

import { log } from "./logger.js";
import type { ImageJob } from "./queue.server.js";
import { validateImageJob } from "./queue.server.js";

// ---------------------------------------------------------------------------
// Error category definitions
// ---------------------------------------------------------------------------

export const ERROR_CATEGORIES = [
  "quota_exceeded",
  "timed_out",
  "quality_gate",
  "bg_removal_failed",
  "renderer_timeout",
  "compositing_failed",
  "unknown_error",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/**
 * Maps a raw error message (or D1 status string) to a typed ErrorCategory.
 *
 * Priority order:
 *   1. Exact status strings written by earlier pipeline steps.
 *   2. Substring matches on error message.
 *   3. Fallback to `unknown_error`.
 */
export function categoriseError(
  statusOrMessage: string | null | undefined
): ErrorCategory {
  const s = (statusOrMessage ?? "").toLowerCase();

  if (s.includes("quota_exceeded") || s.includes("quota exceeded")) return "quota_exceeded";
  if (s.includes("quality_gate") || s.includes("quality gate")) return "quality_gate";
  if (
    s.includes("bg_removal_failed") ||
    s.includes("bg removal") ||
    s.includes("background removal")
  )
    return "bg_removal_failed";
  if (s.includes("renderer_timeout") || s.includes("renderer timeout") || s.includes("satori")) return "renderer_timeout";
  if (s.includes("compositing_failed") || s.includes("compositing failed") || s.includes("canvas")) return "compositing_failed";
  if (s.includes("timed_out") || s.includes("timeout") || s.includes("timed out")) return "timed_out";

  return "unknown_error";
}

// ---------------------------------------------------------------------------
// DLQ environment bindings
// ---------------------------------------------------------------------------

export interface DLQEnv {
  DB: D1Database;
  KV_STORE: KVNamespace;
  IMAGE_QUEUE: Queue<ImageJob>;
}

// ---------------------------------------------------------------------------
// D1 writer
// ---------------------------------------------------------------------------

/**
 * Persist a failed job with its error category to D1 `generated_images`.
 *
 * Uses INSERT OR REPLACE so that a row already written by the main consumer
 * (e.g. `timed_out`) is overwritten with the terminal `failed` status and the
 * richer error context from the DLQ payload.
 */
export async function writeDLQStatus(
  job: ImageJob,
  category: ErrorCategory,
  rawError: string | null,
  db: D1Database
): Promise<void> {
  const errorMessage = `${category}${rawError ? `: ${rawError}` : ""}`;

  await db
    .prepare(
      `INSERT OR REPLACE INTO generated_images
         (id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at)
       VALUES
         (lower(hex(randomblob(16))), ?, ?, ?, NULL, NULL, 'failed', ?, datetime('now'))
       ON CONFLICT(shop, product_id, template_id) DO UPDATE SET
         status        = 'failed',
         error_message = excluded.error_message,
         generated_at  = excluded.generated_at`
    )
    .bind(job.shop, job.productId, job.templateId, errorMessage)
    .run();
}

// ---------------------------------------------------------------------------
// DLQ batch consumer
// ---------------------------------------------------------------------------

/**
 * Process a batch of messages from the dead letter queue.
 *
 * For every message:
 *   1. Validate the schema.
 *   2. Categorise the error from the job's status / error fields.
 *   3. Write `failed` status with error category to D1.
 *   4. Ack the message (terminal — no further retries from DLQ).
 *
 * @param batch - MessageBatch from the DLQ binding.
 * @param env   - Worker bindings.
 */
export async function handleDLQBatch(
  batch: MessageBatch<ImageJob>,
  env: DLQEnv
): Promise<void> {
  for (const message of batch.messages) {
    let job: ImageJob;

    // --- Schema validation ---------------------------------------------------
    try {
      validateImageJob(message.body);
      job = message.body;
    } catch (err) {
      log({
        shop: "unknown",
        step: "dlq.schema_invalid",
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      message.ack();
      continue;
    }

    // --- Categorise error ---------------------------------------------------
    // The error context may be embedded in a custom property if the job was
    // re-shaped by an earlier pipeline step.  We check `job._errorContext` (an
    // optional extension field) and fall back to a generic unknown message.
    const rawError = (job as ImageJob & { _errorContext?: string })._errorContext ?? null;
    const category = categoriseError(rawError);

    log({
      shop: job.shop,
      productId: job.productId,
      step: "dlq.received",
      status: "error",
      errorCategory: category,
    });

    // --- Write to D1 --------------------------------------------------------
    try {
      await writeDLQStatus(job, category, rawError, env.DB);
    } catch (dbErr) {
      log({
        shop: job.shop,
        productId: job.productId,
        step: "dlq.db_write_failed",
        status: "error",
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }

    // Always ack — DLQ is terminal
    message.ack();
  }
}

// ---------------------------------------------------------------------------
// Regenerate helper (used by POST /api/regenerate/:productId route)
// ---------------------------------------------------------------------------

export interface RegenerateResult {
  requeued: boolean;
  idempotencyKey: string;
}

/**
 * Re-queue a failed job with a fresh idempotency key.
 *
 * Steps:
 *   1. Load the most recent `generated_images` row for this shop+productId.
 *   2. Load the merchant row to recover brand kit / locale.
 *   3. Write a new KV idempotency key (24-hour TTL) to allow reprocessing.
 *   4. Enqueue the job.
 *
 * @param productId - Shopify product ID.
 * @param shop      - Merchant shop domain.
 * @param env       - Worker bindings.
 * @returns RegenerateResult with the fresh idempotency key.
 */
export async function reQueueJob(
  productId: string,
  shop: string,
  env: DLQEnv
): Promise<RegenerateResult> {
  // Load the most recent generated_images row for this product
  const row = await env.DB
    .prepare(
      `SELECT template_id FROM generated_images
       WHERE shop = ? AND product_id = ?
       ORDER BY generated_at DESC LIMIT 1`
    )
    .bind(shop, productId)
    .first<{ template_id: string }>();

  // Load the merchant row
  const merchant = await env.DB
    .prepare(
      `SELECT locale, currency_format FROM merchants WHERE shop = ?`
    )
    .bind(shop)
    .first<{ locale: string; currency_format: string }>();

  if (!merchant) {
    throw new Error(`Merchant not found: ${shop}`);
  }

  // Load brand kit from KV
  const brandKitRaw = await env.KV_STORE.get(`brandkit:${shop}`);
  const brandKit = brandKitRaw
    ? (JSON.parse(brandKitRaw) as { primaryColor: string; logoR2Key?: string; fontFamily?: string })
    : { primaryColor: "#000000" };

  const templateId = row?.template_id ?? "product-card";

  // Generate fresh idempotency key
  const ts = Date.now();
  const idempotencyKey = `regen:${shop}:${productId}:${ts}`;

  // Write to KV with 24-hour TTL (allowing this regeneration to be processed)
  await env.KV_STORE.put(`webhook:${idempotencyKey}`, "1", {
    expirationTtl: 86_400,
  });

  // Build the job
  const job: ImageJob = {
    shop,
    productId,
    productTitle: productId, // title will be refreshed by quality gate
    imageUrl: "",            // will be fetched fresh by quality gate
    templateId,
    locale: merchant.locale ?? "en",
    currencyFormat: merchant.currency_format ?? "{{amount}}",
    brandKit: {
      primaryColor: brandKit.primaryColor,
      logoR2Key: brandKit.logoR2Key ?? null,
      fontFamily: brandKit.fontFamily ?? null,
    },
    attempt: 0,
  };

  await env.IMAGE_QUEUE.send(job);

  log({
    shop,
    productId,
    step: "dlq.regenerate.queued",
    status: "ok",
    idempotencyKey,
    templateId,
  });

  return { requeued: true, idempotencyKey };
}
