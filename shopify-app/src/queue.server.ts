/**
 * PR-013: Cloudflare Queue setup and job schema
 *
 * Defines the image generation job schema, Queue producer helper, and the
 * Queue consumer skeleton with a 30-second timeout guard.
 *
 * Queue: shopify-image-queue-{env}
 * DLQ:   shopify-image-queue-{env}-dlq
 *
 * Retry strategy:
 *   max_retries = 4 (configured in wrangler.toml)
 *   Exponential back-off: base 5 s, doubling per attempt → 5, 10, 20, 40 s.
 *   Applied via message.retry({ delaySeconds }) in the consumer.
 *
 * Timeout guard:
 *   Every job races against a 30-second AbortSignal. On breach the consumer
 *   writes `timed_out` status to D1 and acks the message (no retry — timed-out
 *   jobs are surfaced to the merchant for manual regeneration via PR-019).
 */

import { log } from "./logger.js";
import { checkQuota, writeQuotaExceededStatus } from "./usage.server.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum processing time (ms) before the timeout guard fires. */
export const JOB_TIMEOUT_MS = 30_000;

/** Base retry delay in seconds; doubles with each attempt. */
const RETRY_BASE_DELAY_SECONDS = 5;

/** Maximum retry delay cap (Cloudflare hard limit: 43200 s = 12 h). */
const RETRY_MAX_DELAY_SECONDS = 43_200;

// ---------------------------------------------------------------------------
// Brand kit type
// ---------------------------------------------------------------------------

export interface BrandKit {
  /** Primary brand colour as a CSS hex string, e.g. "#1a73e8". */
  primaryColor: string;
  /** R2 key for the merchant's logo PNG. */
  logoR2Key?: string | null;
  /** Font family name, e.g. "Inter". */
  fontFamily?: string | null;
}

// ---------------------------------------------------------------------------
// Job schema
// ---------------------------------------------------------------------------

/**
 * Payload for every image-generation job enqueued on shopify-image-queue.
 *
 * Fields must survive JSON round-trip (no Dates, no undefined).
 */
export interface ImageJob {
  /** Merchant shop domain, e.g. "mystore.myshopify.com". */
  shop: string;
  /** Shopify product GID or numeric ID as string. */
  productId: string;
  /** Product title for overlay text. */
  productTitle: string;
  /** Public Shopify CDN URL for the product's featured image. */
  imageUrl: string;
  /** Satori template ID from the templates-api catalogue. */
  templateId: string;
  /** BCP-47 locale code, e.g. "en", "ar", "he". */
  locale: string;
  /** Pre-formatted currency string, e.g. "$29.99" or "29,99 €". */
  currencyFormat: string;
  /** Merchant brand kit snapshot at time of enqueueing. */
  brandKit: BrandKit;
  /**
   * Attempt number (1-based). Populated by the consumer on each retry
   * to compute the exponential delay for the *next* attempt.
   */
  attempt?: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Required string fields on ImageJob (used for schema validation). */
const REQUIRED_STRING_FIELDS = [
  "shop",
  "productId",
  "productTitle",
  "imageUrl",
  "templateId",
  "locale",
  "currencyFormat",
] as const;

/**
 * Validates that an unknown value conforms to the ImageJob schema.
 *
 * Throws a descriptive Error on any violation so the consumer can log it
 * and ack the message without retrying (malformed jobs cannot be fixed by
 * retrying).
 */
export function validateImageJob(value: unknown): asserts value is ImageJob {
  if (typeof value !== "object" || value === null) {
    throw new Error("ImageJob must be a non-null object");
  }

  const job = value as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof job[field] !== "string" || (job[field] as string).trim() === "") {
      throw new Error(`ImageJob.${field} must be a non-empty string`);
    }
  }

  if (typeof job.brandKit !== "object" || job.brandKit === null) {
    throw new Error("ImageJob.brandKit must be an object");
  }

  const bk = job.brandKit as Record<string, unknown>;
  if (typeof bk.primaryColor !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(bk.primaryColor)) {
    throw new Error("ImageJob.brandKit.primaryColor must be a valid CSS hex colour");
  }
}

// ---------------------------------------------------------------------------
// Producer
// ---------------------------------------------------------------------------

export interface QueueProducerEnv {
  IMAGE_QUEUE: Queue<ImageJob>;
  KV_STORE: KVNamespace;
  DB: D1Database;
}

/**
 * Enqueue an image-generation job.
 *
 * Only call AFTER:
 *   1. Deduplication check (PR-007) has passed (not a duplicate).
 *   2. Quota check (PR-014) has passed (merchant has remaining quota).
 *
 * @param job  - Validated ImageJob payload.
 * @param env  - Worker bindings including IMAGE_QUEUE.
 */
export async function enqueueImageJob(
  job: ImageJob,
  env: QueueProducerEnv
): Promise<void> {
  validateImageJob(job);

  await env.IMAGE_QUEUE.send(job);

  log({
    shop: job.shop,
    productId: job.productId,
    step: "queue.enqueued",
    status: "ok",
    templateId: job.templateId,
  });
}

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

export interface QueueConsumerEnv {
  DB: D1Database;
  KV_STORE: KVNamespace;
  IMAGE_QUEUE: Queue<ImageJob>;
}

/**
 * Process a single image-generation job.
 *
 * Exported so it can be swapped out / extended by later PRs without touching
 * the consumer skeleton.  Returns the final status string written to D1.
 *
 * @param job   - Validated ImageJob.
 * @param env   - Worker bindings.
 * @param signal - AbortSignal from the 30-second timeout guard.
 */
export async function processImageJob(
  job: ImageJob,
  env: QueueConsumerEnv,
  signal: AbortSignal
): Promise<string> {
  // Later PRs (015-018) will add pipeline steps here.
  // For now, return "pending" to indicate the skeleton ran successfully.
  void signal; // will be used for cancellation in future PRs
  void env;
  log({
    shop: job.shop,
    productId: job.productId,
    step: "queue.consumer.processing",
    status: "info",
    templateId: job.templateId,
    attempt: job.attempt ?? 1,
  });

  return "pending";
}

/**
 * Write the job status to D1 `generated_images`.
 *
 * Uses INSERT OR REPLACE so the row is created on first attempt and updated on
 * subsequent retries / timeout events.
 */
async function writeJobStatus(
  job: ImageJob,
  status: string,
  errorMessage: string | null,
  db: D1Database
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO generated_images
         (id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at)
       VALUES
         (lower(hex(randomblob(16))), ?, ?, ?, NULL, NULL, ?, ?, datetime('now'))
       ON CONFLICT(shop, product_id, template_id) DO UPDATE SET
         status        = excluded.status,
         error_message = excluded.error_message,
         generated_at  = excluded.generated_at`
    )
    .bind(job.shop, job.productId, job.templateId, status, errorMessage)
    .run();
}

/**
 * Compute exponential retry delay for a given attempt number.
 *
 * Attempt 1 → 5 s, 2 → 10 s, 3 → 20 s, 4 → 40 s.
 * Capped at RETRY_MAX_DELAY_SECONDS.
 */
export function computeRetryDelay(attempt: number): number {
  const delay = RETRY_BASE_DELAY_SECONDS * Math.pow(2, attempt - 1);
  return Math.min(delay, RETRY_MAX_DELAY_SECONDS);
}

/**
 * Queue batch consumer.
 *
 * Processes each message individually with a 30-second timeout guard.
 * On timeout: writes `timed_out` to D1 and acks the message (no retry).
 * On error:   retries with exponential back-off up to max_retries (4).
 *
 * @param processFn - Optional override for the job processor (used in tests).
 */
export async function handleQueueBatch(
  batch: MessageBatch<ImageJob>,
  env: QueueConsumerEnv,
  processFn: (
    job: ImageJob,
    env: QueueConsumerEnv,
    signal: AbortSignal
  ) => Promise<string> = processImageJob
): Promise<void> {
  const isDLQ = batch.queue.endsWith("-dlq");

  for (const message of batch.messages) {
    let job: ImageJob;

    // --- Validate schema ---------------------------------------------------
    try {
      validateImageJob(message.body);
      job = message.body;
    } catch (err) {
      log({
        shop: "unknown",
        step: "queue.schema_invalid",
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      // Ack malformed messages — retrying cannot fix a schema error
      message.ack();
      continue;
    }

    // --- DLQ handler path --------------------------------------------------
    if (isDLQ) {
      log({
        shop: job.shop,
        productId: job.productId,
        step: "queue.dlq.received",
        status: "error",
      });
      await writeJobStatus(job, "failed", "Exceeded maximum retries", env.DB).catch(() => {});
      message.ack();
      continue;
    }

    // --- Quota check BEFORE any pipeline work (PR-014) --------------------
    try {
      const quota = await checkQuota(job.shop, env);
      if (!quota.allowed) {
        await writeQuotaExceededStatus(job.shop, job.productId, job.templateId, env.DB).catch(
          () => {}
        );
        log({
          shop: job.shop,
          productId: job.productId,
          step: "queue.consumer.quota_exceeded",
          status: "warn",
          currentUsage: quota.currentUsage,
          monthlyLimit: quota.monthlyLimit,
        });
        // Ack without retrying — quota state won't change during this message's lifetime
        message.ack();
        continue;
      }
    } catch (quotaErr) {
      // If quota check fails, let the job proceed (fail open to avoid blocking merchants)
      log({
        shop: job.shop,
        productId: job.productId,
        step: "queue.consumer.quota_check_error",
        status: "warn",
        error: quotaErr instanceof Error ? quotaErr.message : String(quotaErr),
      });
    }

    // --- Main consumer path with 30-second timeout guard ------------------
    const attempt = (typeof job.attempt === "number" ? job.attempt : 0) + 1;
    const jobWithAttempt: ImageJob = { ...job, attempt };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS);

    try {
      await Promise.race([
        processFn(jobWithAttempt, env, controller.signal),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () =>
            reject(new Error("timeout"))
          )
        ),
      ]);

      clearTimeout(timeoutId);
      message.ack();

      log({
        shop: job.shop,
        productId: job.productId,
        step: "queue.consumer.acked",
        status: "ok",
        attempt,
      });
    } catch (err) {
      clearTimeout(timeoutId);

      const isTimeout = err instanceof Error && err.message === "timeout";

      if (isTimeout) {
        log({
          shop: job.shop,
          productId: job.productId,
          step: "queue.consumer.timed_out",
          status: "error",
          attempt,
        });

        // Write timed_out status to D1 and ack (no retry for timeouts)
        await writeJobStatus(job, "timed_out", "Processing exceeded 30-second limit", env.DB).catch(
          () => {}
        );
        message.ack();
      } else {
        // Retriable error — apply exponential back-off
        const delaySeconds = computeRetryDelay(attempt);

        log({
          shop: job.shop,
          productId: job.productId,
          step: "queue.consumer.retry",
          status: "error",
          attempt,
          delaySeconds,
          error: err instanceof Error ? err.message : String(err),
        });

        message.retry({ delaySeconds });
      }
    }
  }
}
