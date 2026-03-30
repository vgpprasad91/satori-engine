/**
 * PR-011: app/uninstalled grace period and session cleanup
 *
 * On app/uninstalled webhook:
 *  1. Nullify access_token and set billing_status = 'uninstalled' in D1
 *  2. Cancel active Shopify subscription
 *  3. Halt all queued jobs for the shop (mark queue as halted in KV)
 *  4. Purge merchant KV keys: brand kit, usage counter, rate limiter state
 *  5. Log uninstall event with timestamp
 */

import { log } from "./logger.js";
import { cancelSubscription } from "./billing.server.js";

// ---------------------------------------------------------------------------
// KV key helpers
// ---------------------------------------------------------------------------

/** KV key prefix for brand kit data per merchant. */
export const BRAND_KIT_PREFIX = "brandkit:";

/** KV key prefix for monthly usage counters. */
export const USAGE_PREFIX = "usage:";

/** KV key prefix for rate limiter token buckets. */
export const RATE_LIMIT_PREFIX = "ratelimit:";

/** KV key to signal that a shop's queue processing should halt. */
export const QUEUE_HALT_PREFIX = "queue_halt:";

/** TTL for the queue halt signal in seconds (7 days grace period). */
export const QUEUE_HALT_TTL_SECONDS = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UninstallEnv {
  DB: D1Database;
  KV_STORE: KVNamespace;
}

export interface UninstallResult {
  shop: string;
  tokenPurged: boolean;
  subscriptionCancelled: boolean;
  kvKeysPurged: string[];
  queueHalted: boolean;
  uninstalledAt: string;
}

// ---------------------------------------------------------------------------
// KV purge helpers
// ---------------------------------------------------------------------------

/**
 * Purges all merchant KV keys matching the given prefix for a shop.
 * Lists all keys with the prefix and deletes them.
 */
async function purgeKVByPrefix(
  prefix: string,
  kv: KVNamespace
): Promise<string[]> {
  const purgedKeys: string[] = [];
  let cursor: string | undefined;

  do {
    const result = await kv.list({ prefix, cursor });
    for (const key of result.keys) {
      await kv.delete(key.name);
      purgedKeys.push(key.name);
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return purgedKeys;
}

// ---------------------------------------------------------------------------
// Main uninstall handler
// ---------------------------------------------------------------------------

/**
 * Handles the app/uninstalled lifecycle event for a merchant.
 *
 * Must be called from within ctx.waitUntil() after returning 200 to Shopify.
 *
 * @param shop         - The merchant's myshopify.com domain
 * @param env          - Worker bindings (DB, KV_STORE)
 * @param accessToken  - Current access token (needed to cancel subscription; may be null if already purged)
 * @param subscriptionId - Active Shopify subscription ID to cancel (or "free" / null)
 */
export async function handleUninstall(
  shop: string,
  env: UninstallEnv,
  accessToken: string | null,
  subscriptionId: string | null
): Promise<UninstallResult> {
  const start = Date.now();
  const uninstalledAt = new Date().toISOString();

  log({
    shop,
    step: "uninstall.started",
    status: "info",
    uninstalledAt,
  });

  let tokenPurged = false;
  let subscriptionCancelled = false;
  const kvKeysPurged: string[] = [];
  let queueHalted = false;

  // -------------------------------------------------------------------------
  // Step 1: Nullify access_token and set billing_status = 'uninstalled' in D1
  // -------------------------------------------------------------------------
  try {
    const result = await env.DB.prepare(
      `UPDATE merchants
         SET access_token = NULL,
             billing_status = 'uninstalled'
       WHERE shop = ?`
    )
      .bind(shop)
      .run();

    tokenPurged = (result.meta?.changes ?? 0) > 0;

    log({
      shop,
      step: "uninstall.token_purged",
      status: "ok",
      rowsAffected: result.meta?.changes ?? 0,
    });
  } catch (err) {
    log({
      shop,
      step: "uninstall.token_purge_error",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    // Non-fatal — continue cleanup
  }

  // -------------------------------------------------------------------------
  // Step 2: Cancel active Shopify subscription
  // -------------------------------------------------------------------------
  if (accessToken && subscriptionId && subscriptionId !== "free") {
    try {
      await cancelSubscription(shop, accessToken, subscriptionId);
      subscriptionCancelled = true;

      log({
        shop,
        step: "uninstall.subscription_cancelled",
        status: "ok",
        subscriptionId,
      });
    } catch (err) {
      log({
        shop,
        step: "uninstall.subscription_cancel_error",
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      // Non-fatal — subscription may have already been cancelled by Shopify
    }
  } else {
    // Free plan or already purged token — nothing to cancel
    subscriptionCancelled = true;
  }

  // -------------------------------------------------------------------------
  // Step 3: Halt all queued jobs for this shop via KV signal
  // -------------------------------------------------------------------------
  try {
    const haltKey = `${QUEUE_HALT_PREFIX}${shop}`;
    await env.KV_STORE.put(haltKey, uninstalledAt, {
      expirationTtl: QUEUE_HALT_TTL_SECONDS,
    });
    queueHalted = true;

    log({
      shop,
      step: "uninstall.queue_halted",
      status: "ok",
      haltKey,
    });
  } catch (err) {
    log({
      shop,
      step: "uninstall.queue_halt_error",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // -------------------------------------------------------------------------
  // Step 4: Purge merchant KV keys (brand kit, usage counters, rate limiters)
  // -------------------------------------------------------------------------
  const prefixesToPurge = [
    `${BRAND_KIT_PREFIX}${shop}`,
    `${USAGE_PREFIX}${shop}:`,
    `${RATE_LIMIT_PREFIX}removebg:`,
    `${RATE_LIMIT_PREFIX}${shop}:`,
  ];

  for (const prefix of prefixesToPurge) {
    try {
      const purged = await purgeKVByPrefix(prefix, env.KV_STORE);
      kvKeysPurged.push(...purged);
    } catch (err) {
      log({
        shop,
        step: "uninstall.kv_purge_error",
        status: "error",
        prefix,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Also delete direct brand kit key (may be stored without suffix)
  try {
    const brandKitKey = `${BRAND_KIT_PREFIX}${shop}`;
    const existing = await env.KV_STORE.get(brandKitKey);
    if (existing !== null) {
      await env.KV_STORE.delete(brandKitKey);
      if (!kvKeysPurged.includes(brandKitKey)) {
        kvKeysPurged.push(brandKitKey);
      }
    }
  } catch {
    // ignore
  }

  log({
    shop,
    step: "uninstall.kv_purged",
    status: "ok",
    keysCount: kvKeysPurged.length,
  });

  // -------------------------------------------------------------------------
  // Step 5: Log final uninstall event with timestamp
  // -------------------------------------------------------------------------
  log({
    shop,
    step: "uninstall.completed",
    status: "ok",
    uninstalledAt,
    tokenPurged,
    subscriptionCancelled,
    kvKeysPurgedCount: kvKeysPurged.length,
    queueHalted,
    durationMs: Date.now() - start,
  });

  return {
    shop,
    tokenPurged,
    subscriptionCancelled,
    kvKeysPurged,
    queueHalted,
    uninstalledAt,
  };
}

/**
 * Checks whether a shop's queue processing has been halted (i.e. the shop
 * has uninstalled the app).
 *
 * Queue consumer Workers should call this before processing any job.
 */
export async function isQueueHalted(
  shop: string,
  kv: KVNamespace
): Promise<boolean> {
  const haltKey = `${QUEUE_HALT_PREFIX}${shop}`;
  const value = await kv.get(haltKey);
  return value !== null;
}
