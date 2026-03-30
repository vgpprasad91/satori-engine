/**
 * PR-030: Monthly usage counter reset cron
 *
 * Cloudflare Cron Trigger fires at "0 0 1 * *" (first of each month, midnight UTC).
 *
 * Pipeline:
 *   1. Scan all `usage:{shop}:{YYYY-MM}` KV keys.
 *   2. Collect per-shop generation totals before deleting.
 *   3. Send Resend email to internal address with monthly totals.
 *   4. Zero all usage counters (delete keys).
 *   5. Write reset log to D1 `webhook_log` for billing reconciliation.
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonthlyResetEnv {
  KV_STORE: KVNamespace;
  DB: D1Database;
  RESEND_API_KEY: string;
  /** Internal email address to receive the monthly totals report. */
  INTERNAL_REPORT_EMAIL: string;
}

export interface ShopUsageTotals {
  shop: string;
  /** Total images generated across all months recorded in the keys being reset. */
  total: number;
  /** The KV keys that were deleted for this shop. */
  keys: string[];
}

export interface MonthlyResetResult {
  shopsProcessed: number;
  keysDeleted: number;
  emailSent: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// KV scan helpers
// ---------------------------------------------------------------------------

/**
 * Scan all `usage:` prefixed KV keys and aggregate per-shop totals.
 *
 * Returns a map of shop → ShopUsageTotals and a flat list of all keys found.
 */
export async function scanUsageKeys(
  kv: KVNamespace
): Promise<{ shopTotals: Map<string, ShopUsageTotals>; allKeys: string[] }> {
  const shopTotals = new Map<string, ShopUsageTotals>();
  const allKeys: string[] = [];
  let cursor: string | undefined;

  do {
    const listResult = await kv.list<string>({ prefix: "usage:", cursor });

    for (const keyMeta of listResult.keys) {
      allKeys.push(keyMeta.name);

      // Key format: usage:{shop}:{YYYY-MM}
      const parts = keyMeta.name.split(":");
      // parts[0] = "usage", parts[1] = shop (may contain dots), parts[2] = YYYY-MM
      // Rejoin parts[1..n-1] to handle shop names with colons (none expected, but defensive)
      const shop = parts.slice(1, parts.length - 1).join(":");
      if (!shop) continue;

      const raw = await kv.get(keyMeta.name);
      const count = parseInt(raw ?? "0", 10) || 0;

      const existing = shopTotals.get(shop);
      if (existing) {
        existing.total += count;
        existing.keys.push(keyMeta.name);
      } else {
        shopTotals.set(shop, { shop, total: count, keys: [keyMeta.name] });
      }
    }

    cursor = listResult.list_complete
      ? undefined
      : (listResult as { cursor?: string }).cursor;
  } while (cursor);

  return { shopTotals, allKeys };
}

// ---------------------------------------------------------------------------
// Delete helpers
// ---------------------------------------------------------------------------

/**
 * Delete all provided KV keys one by one.
 * Returns the number of keys successfully deleted.
 */
export async function deleteUsageKeys(
  kv: KVNamespace,
  keys: string[]
): Promise<number> {
  let deleted = 0;
  for (const key of keys) {
    await kv.delete(key);
    deleted++;
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Resend email
// ---------------------------------------------------------------------------

export interface MonthlyReportEmailOpts {
  resendApiKey: string;
  to: string;
  yearMonth: string;
  shopTotals: ShopUsageTotals[];
}

/**
 * Build the HTML body for the monthly totals report email.
 */
export function buildReportEmailHtml(
  yearMonth: string,
  shopTotals: ShopUsageTotals[]
): string {
  const rows = shopTotals
    .sort((a, b) => b.total - a.total)
    .map(
      (s) =>
        `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${s.shop}</td>` +
        `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${s.total.toLocaleString()}</td></tr>`
    )
    .join("\n");

  const grandTotal = shopTotals.reduce((sum, s) => sum + s.total, 0);

  return `
    <h2>MailCraft — Monthly Generation Report: ${yearMonth}</h2>
    <p>The usage counters for <strong>${yearMonth}</strong> have been reset.</p>
    <p>Grand total images generated this month: <strong>${grandTotal.toLocaleString()}</strong> across ${shopTotals.length} merchant${shopTotals.length !== 1 ? "s" : ""}.</p>
    <table style="border-collapse:collapse;width:100%;max-width:600px;">
      <thead>
        <tr>
          <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Shop</th>
          <th style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Images Generated</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="2" style="padding:8px;text-align:center;color:#888;">No usage recorded</td></tr>'}
      </tbody>
    </table>
    <p style="margin-top:16px;color:#666;font-size:12px;">
      Generated by MailCraft usage reset cron at ${new Date().toISOString()}
    </p>
  `;
}

/**
 * Send the monthly totals report email via Resend.
 * Returns true on success, false on failure (non-throwing — never block the reset).
 */
export async function sendMonthlyReportEmail(
  opts: MonthlyReportEmailOpts
): Promise<boolean> {
  const { resendApiKey, to, yearMonth, shopTotals } = opts;

  const html = buildReportEmailHtml(yearMonth, shopTotals);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "MailCraft System <system@mailcraft.io>",
        to: [to],
        subject: `MailCraft Monthly Report — ${yearMonth}`,
        html,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      log({
        shop: "system",
        step: "monthly_reset.email.failed",
        status: "error",
        error: `Resend ${res.status}: ${text}`,
      });
      return false;
    }

    log({
      shop: "system",
      step: "monthly_reset.email.sent",
      status: "ok",
      to,
      yearMonth,
      shopCount: shopTotals.length,
    });
    return true;
  } catch (err) {
    log({
      shop: "system",
      step: "monthly_reset.email.exception",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// D1 log write
// ---------------------------------------------------------------------------

/**
 * Write a monthly reset log entry to D1 `webhook_log` for billing reconciliation.
 */
export async function writeResetLog(
  db: D1Database,
  yearMonth: string,
  shopsCount: number,
  keysDeleted: number,
  grandTotal: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO webhook_log (webhook_id, shop, type, processed_at)
       VALUES (lower(hex(randomblob(16))), ?, 'monthly_usage_reset', datetime('now'))`
    )
    .bind(
      JSON.stringify({
        yearMonth,
        shopsCount,
        keysDeleted,
        grandTotal,
      })
    )
    .run();
}

// ---------------------------------------------------------------------------
// Main scheduled handler
// ---------------------------------------------------------------------------

/**
 * Returns the previous YYYY-MM string (the month being reset).
 * On the 1st of the month at midnight we are resetting the prior month's counters.
 */
export function previousYearMonth(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Run the full monthly usage reset pipeline:
 *   1. Scan all usage KV keys and collect per-shop totals.
 *   2. Send Resend report email before deletion.
 *   3. Delete all usage keys.
 *   4. Write reset log to D1.
 *
 * Called by the Cloudflare Cron Trigger `0 0 1 * *`.
 */
export async function runMonthlyUsageReset(
  env: MonthlyResetEnv,
  now: Date = new Date()
): Promise<MonthlyResetResult> {
  const yearMonth = previousYearMonth(now);

  log({
    shop: "system",
    step: "monthly_reset.start",
    status: "ok",
    yearMonth,
  });

  try {
    // Step 1: Scan all usage keys and aggregate per-shop totals
    const { shopTotals: shopTotalsMap, allKeys } = await scanUsageKeys(
      env.KV_STORE
    );
    const shopTotals = Array.from(shopTotalsMap.values());
    const grandTotal = shopTotals.reduce((sum, s) => sum + s.total, 0);

    log({
      shop: "system",
      step: "monthly_reset.scanned",
      status: "ok",
      shopsFound: shopTotals.length,
      keysFound: allKeys.length,
      grandTotal,
    });

    // Step 2: Send Resend email with monthly totals BEFORE deletion
    const emailSent = await sendMonthlyReportEmail({
      resendApiKey: env.RESEND_API_KEY,
      to: env.INTERNAL_REPORT_EMAIL,
      yearMonth,
      shopTotals,
    });

    // Step 3: Delete all usage keys
    const keysDeleted = await deleteUsageKeys(env.KV_STORE, allKeys);

    // Step 4: Write reset log to D1
    await writeResetLog(
      env.DB,
      yearMonth,
      shopTotals.length,
      keysDeleted,
      grandTotal
    );

    log({
      shop: "system",
      step: "monthly_reset.complete",
      status: "ok",
      shopsProcessed: shopTotals.length,
      keysDeleted,
      grandTotal,
      emailSent,
    });

    return {
      shopsProcessed: shopTotals.length,
      keysDeleted,
      emailSent,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log({
      shop: "system",
      step: "monthly_reset.failed",
      status: "error",
      error,
    });
    return {
      shopsProcessed: 0,
      keysDeleted: 0,
      emailSent: false,
      error,
    };
  }
}
