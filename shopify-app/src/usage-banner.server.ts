/**
 * PR-025: In-app usage limit banner and upgrade prompt
 *
 * Determines whether the usage banner should be shown based on:
 *  - Current usage vs monthly limit (from KV + D1)
 *  - Per-session dismiss flag stored in KV
 *
 * Banner states:
 *  - "warning"  — usage >= 80% of limit
 *  - "critical" — usage >= 100% of limit (quota exhausted)
 *  - null       — banner not needed
 */

import { getUsageCount } from "./usage.server.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BannerState = "warning" | "critical" | null;

export interface UsageBannerData {
  state: BannerState;
  currentUsage: number;
  monthlyLimit: number;
  /** Percentage consumed, 0–100+. */
  usagePercent: number;
}

export interface BannerEnv {
  KV_STORE: KVNamespace;
  DB: D1Database;
}

// ---------------------------------------------------------------------------
// Session dismiss key
// ---------------------------------------------------------------------------

/**
 * Returns the KV key used to store the per-session banner dismiss flag.
 * The sessionId is a short opaque token derived from shop + YYYY-MM so the
 * flag auto-expires when the next billing period begins (32-day TTL).
 */
export function bannerDismissKey(shop: string, yearMonth: string): string {
  return `banner:dismissed:${shop}:${yearMonth}`;
}

/**
 * Mark the banner as dismissed for the current billing period.
 * The KV key expires after 32 days so it resets naturally next month.
 */
export async function dismissBanner(
  shop: string,
  kv: KVNamespace,
  now: Date = new Date()
): Promise<void> {
  const yearMonth = currentYearMonth(now);
  const key = bannerDismissKey(shop, yearMonth);
  await kv.put(key, "1", { expirationTtl: 32 * 24 * 60 * 60 });

  log({ shop, step: "usage.banner.dismissed", status: "ok" });
}

/**
 * Check whether the banner has been dismissed for the current billing period.
 */
export async function isBannerDismissed(
  shop: string,
  kv: KVNamespace,
  now: Date = new Date()
): Promise<boolean> {
  const yearMonth = currentYearMonth(now);
  const key = bannerDismissKey(shop, yearMonth);
  const value = await kv.get(key);
  return value === "1";
}

// ---------------------------------------------------------------------------
// Banner state computation
// ---------------------------------------------------------------------------

/**
 * Compute the banner data for a shop.
 *
 * Returns state=null if:
 *  - Usage is below 80% of the monthly limit, OR
 *  - The banner has been dismissed for the current billing period
 */
export async function getUsageBannerData(
  shop: string,
  env: BannerEnv,
  now: Date = new Date()
): Promise<UsageBannerData> {
  // Fetch merchant's monthly limit from D1
  const merchant = await env.DB.prepare(
    "SELECT monthly_limit FROM merchants WHERE shop = ?"
  )
    .bind(shop)
    .first<{ monthly_limit: number }>();

  const monthlyLimit = merchant?.monthly_limit ?? 100;
  const currentUsage = await getUsageCount(shop, env.KV_STORE, now);
  const usagePercent = monthlyLimit > 0 ? (currentUsage / monthlyLimit) * 100 : 0;

  let state: BannerState = null;

  if (usagePercent >= 100) {
    state = "critical";
  } else if (usagePercent >= 80) {
    state = "warning";
  }

  // Check if already dismissed this billing period
  if (state !== null) {
    const dismissed = await isBannerDismissed(shop, env.KV_STORE, now);
    if (dismissed) {
      state = null;
    }
  }

  return { state, currentUsage, monthlyLimit, usagePercent };
}

// ---------------------------------------------------------------------------
// Internal helper — duplicated from usage.server to avoid circular import
// ---------------------------------------------------------------------------

function currentYearMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
