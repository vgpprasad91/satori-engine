/**
 * PR-014: Usage metering — KV counters and quota enforcement
 *
 * Per-merchant monthly usage counter in KV:
 *   Key format: `usage:{shop}:{YYYY-MM}`
 *   Value: string-encoded integer (e.g. "42")
 *
 * Quota is enforced at Queue consumer entry — before any pipeline work —
 * so that Remove.bg credits are never consumed for quota-exceeded shops.
 *
 * Monthly reset Cron Trigger (`0 0 1 * *`):
 *   Lists all `usage:` prefixed keys and deletes them.
 *   Writes a reset log entry to D1 `webhook_log`.
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageEnv {
  KV_STORE: KVNamespace;
  DB: D1Database;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the current YYYY-MM string in UTC.
 * Extracted so tests can override `Date` without monkey-patching.
 */
export function currentYearMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Returns the KV key for a shop's monthly usage counter.
 */
export function usageKey(shop: string, yearMonth: string): string {
  return `usage:${shop}:${yearMonth}`;
}

// ---------------------------------------------------------------------------
// Counter operations
// ---------------------------------------------------------------------------

/**
 * Increment the per-merchant monthly usage counter by 1.
 * Reads the current value, increments, and writes back.
 *
 * @returns The new counter value after incrementing.
 */
export async function incrementUsageCounter(
  shop: string,
  kv: KVNamespace,
  now: Date = new Date()
): Promise<number> {
  const key = usageKey(shop, currentYearMonth(now));
  const current = await kv.get(key);
  const newCount = (parseInt(current ?? "0", 10) || 0) + 1;

  // 32-day TTL so the key expires naturally after the month ends
  await kv.put(key, String(newCount), { expirationTtl: 32 * 24 * 60 * 60 });

  log({
    shop,
    step: "usage.counter.incremented",
    status: "ok",
    usageCount: newCount,
  });

  return newCount;
}

/**
 * Get the current monthly usage count for a shop.
 * Returns 0 if no counter exists yet.
 */
export async function getUsageCount(
  shop: string,
  kv: KVNamespace,
  now: Date = new Date()
): Promise<number> {
  const key = usageKey(shop, currentYearMonth(now));
  const value = await kv.get(key);
  return parseInt(value ?? "0", 10) || 0;
}

// ---------------------------------------------------------------------------
// Quota enforcement
// ---------------------------------------------------------------------------

export interface QuotaCheckResult {
  allowed: boolean;
  currentUsage: number;
  monthlyLimit: number;
}

/**
 * Check whether a shop has remaining quota for the current month.
 *
 * Fetches the monthly_limit from D1 `merchants` and compares against the
 * KV usage counter. A limit of 0 means unlimited (Hobby free tier — the
 * quota is enforced separately via plan checks in billing).
 *
 * @returns QuotaCheckResult with `allowed=false` if quota is exhausted.
 */
export async function checkQuota(
  shop: string,
  env: UsageEnv,
  now: Date = new Date()
): Promise<QuotaCheckResult> {
  // Fetch merchant's monthly limit from D1
  const merchant = await env.DB.prepare(
    "SELECT monthly_limit FROM merchants WHERE shop = ?"
  )
    .bind(shop)
    .first<{ monthly_limit: number }>();

  const monthlyLimit = merchant?.monthly_limit ?? 100; // default to Hobby tier

  const currentUsage = await getUsageCount(shop, env.KV_STORE, now);

  const allowed = currentUsage < monthlyLimit;

  if (!allowed) {
    log({
      shop,
      step: "usage.quota.exceeded",
      status: "warn",
      currentUsage,
      monthlyLimit,
    });
  }

  return { allowed, currentUsage, monthlyLimit };
}

/**
 * Write `quota_exceeded` status to D1 `generated_images` for a job
 * that was rejected before entering the pipeline.
 */
export async function writeQuotaExceededStatus(
  shop: string,
  productId: string,
  templateId: string,
  db: D1Database
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO generated_images
         (id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at)
       VALUES
         (lower(hex(randomblob(16))), ?, ?, ?, NULL, NULL, 'quota_exceeded', 'Monthly image limit reached', datetime('now'))
       ON CONFLICT(shop, product_id, template_id) DO UPDATE SET
         status        = 'quota_exceeded',
         error_message = 'Monthly image limit reached',
         generated_at  = datetime('now')`
    )
    .bind(shop, productId, templateId)
    .run();
}

// ---------------------------------------------------------------------------
// Monthly reset cron
// ---------------------------------------------------------------------------

/**
 * Reset all usage counters on the first of each month.
 *
 * Lists all KV keys with the `usage:` prefix, deletes them, and writes a
 * reset log entry to D1 `webhook_log` for billing reconciliation.
 *
 * Called by the Cloudflare Cron Trigger `0 0 1 * *`.
 */
export async function resetAllUsageCounters(env: UsageEnv): Promise<void> {
  const deletedShops: string[] = [];
  let cursor: string | undefined;

  // Paginate through all usage keys
  do {
    const listResult: KVNamespaceListResult<unknown, string> = await env.KV_STORE.list({
      prefix: "usage:",
      cursor,
    });

    for (const key of listResult.keys) {
      await env.KV_STORE.delete(key.name);

      // Extract shop from key format: usage:{shop}:{YYYY-MM}
      const parts = key.name.split(":");
      if (parts.length >= 2 && parts[1] !== undefined) {
        deletedShops.push(parts[1]);
      }
    }

    cursor = listResult.list_complete ? undefined : (listResult as KVNamespaceListResult<unknown, string> & { cursor?: string }).cursor;
  } while (cursor);

  const uniqueShops = [...new Set(deletedShops)];

  log({
    shop: "system",
    step: "usage.monthly_reset",
    status: "ok",
    shopsReset: uniqueShops.length,
    keysDeleted: deletedShops.length,
  });

  // Write reset log to D1 webhook_log for billing reconciliation
  await env.DB.prepare(
    `INSERT INTO webhook_log (webhook_id, shop, type, processed_at)
     VALUES (lower(hex(randomblob(16))), 'system', 'usage_counters_reset', datetime('now'))`
  ).run();
}
