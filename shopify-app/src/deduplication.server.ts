/**
 * PR-007: Webhook deduplication via KV idempotency keys
 *
 * Before queuing any webhook job, check `webhook:{webhook_id}` in KV.
 *   - Present  → return 200, skip queue, log as deduplicated.
 *   - Absent   → write key with 24-hour TTL, proceed to queue.
 *
 * The 24-hour TTL matches Shopify's guarantee that it will not re-deliver a
 * webhook with the same ID within that window.  After TTL expiry, a
 * re-delivered webhook (e.g., after an incident) is treated as a first
 * occurrence and processed normally.
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** KV key prefix for idempotency entries. */
const IDEMPOTENCY_PREFIX = "webhook:";

/** TTL for idempotency keys in seconds (24 hours). */
export const IDEMPOTENCY_TTL_SECONDS = 86_400;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeduplicationResult {
  /** Whether this webhook was a duplicate (already seen). */
  isDuplicate: boolean;
}

// ---------------------------------------------------------------------------
// Core deduplication logic
// ---------------------------------------------------------------------------

/**
 * Check whether a webhook has already been processed.
 *
 * If the idempotency key is absent from KV, it is written with a 24-hour TTL
 * so subsequent deliveries of the same webhook ID are recognised as duplicates.
 *
 * @param webhookId  - Value of the `X-Shopify-Webhook-Id` header.
 * @param shop       - Merchant shop domain (for logging).
 * @param topic      - Webhook topic (for logging).
 * @param kv         - KV namespace binding.
 * @returns          - `{ isDuplicate: true }` if already processed, else `{ isDuplicate: false }`.
 */
export async function checkDeduplication(
  webhookId: string,
  shop: string,
  topic: string,
  kv: KVNamespace
): Promise<DeduplicationResult> {
  const key = `${IDEMPOTENCY_PREFIX}${webhookId}`;

  const existing = await kv.get(key);

  if (existing !== null) {
    // Already processed — log and signal caller to skip
    log({
      shop,
      step: "webhook.deduplicated",
      status: "info",
      topic,
      webhookId,
    });
    return { isDuplicate: true };
  }

  // First occurrence — write key with 24-hour TTL before processing
  await kv.put(key, "1", { expirationTtl: IDEMPOTENCY_TTL_SECONDS });

  log({
    shop,
    step: "webhook.idempotency_key_written",
    status: "info",
    topic,
    webhookId,
  });

  return { isDuplicate: false };
}
