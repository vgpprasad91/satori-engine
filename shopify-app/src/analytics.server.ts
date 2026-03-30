/**
 * PR-026: Cloudflare Workers Analytics Engine metrics
 *
 * Emits structured data points to Cloudflare Analytics Engine for:
 *   - Queue consumer events: { shop, template_id, duration_ms, status, bg_removal_cost_credits }
 *   - Webhook handler events: { shop, webhook_type, deduplicated }
 *
 * Analytics Engine data points are written via the `writeDataPoint` API on
 * the AnalyticsEngineDataset binding (AE_METRICS).
 *
 * The internal admin route `/internal/metrics` queries D1 and KV to expose
 * per-shop generation counts and Remove.bg credit burn rate.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the Cloudflare Analytics Engine dataset binding.
 * The actual type is provided by the Workers runtime; we declare it here so
 * unit tests can provide a mock implementation.
 */
export interface AnalyticsEngineDataset {
  writeDataPoint(event: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

export interface AnalyticsEnv {
  AE_METRICS: AnalyticsEngineDataset;
}

// ---------------------------------------------------------------------------
// Queue consumer metric
// ---------------------------------------------------------------------------

export interface QueueMetricPayload {
  /** Merchant shop domain */
  shop: string;
  /** Satori template ID */
  templateId: string;
  /** Total processing duration in milliseconds */
  durationMs: number;
  /** Final job status: success | quota_exceeded | timed_out | failed | bg_removal_failed | renderer_timeout | compositing_failed */
  status: string;
  /** Number of Remove.bg credits consumed (0 if primary path was skipped or failed) */
  bgRemovalCostCredits: number;
}

/**
 * Emit a queue consumer data point to Analytics Engine.
 *
 * Index:  shop (for per-shop filtering in AE SQL queries)
 * Blobs:  [shop, templateId, status]
 * Doubles: [durationMs, bgRemovalCostCredits]
 */
export function emitQueueMetric(
  env: AnalyticsEnv,
  payload: QueueMetricPayload
): void {
  try {
    env.AE_METRICS.writeDataPoint({
      indexes: [payload.shop],
      blobs: [payload.shop, payload.templateId, payload.status],
      doubles: [payload.durationMs, payload.bgRemovalCostCredits],
    });
  } catch {
    // Analytics Engine writes are best-effort; never let them break the pipeline
  }
}

// ---------------------------------------------------------------------------
// Webhook handler metric
// ---------------------------------------------------------------------------

export interface WebhookMetricPayload {
  /** Merchant shop domain */
  shop: string;
  /** Shopify webhook topic, e.g. "products/create" */
  webhookType: string;
  /** Whether this webhook was a duplicate (and therefore skipped) */
  deduplicated: boolean;
}

/**
 * Emit a webhook handler data point to Analytics Engine.
 *
 * Index:  shop
 * Blobs:  [shop, webhookType, deduplicated]
 * Doubles: [deduplicatedNumeric]  (1 = deduplicated, 0 = processed)
 */
export function emitWebhookMetric(
  env: AnalyticsEnv,
  payload: WebhookMetricPayload
): void {
  try {
    env.AE_METRICS.writeDataPoint({
      indexes: [payload.shop],
      blobs: [payload.shop, payload.webhookType, String(payload.deduplicated)],
      doubles: [payload.deduplicated ? 1 : 0],
    });
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Internal /internal/metrics handler
// ---------------------------------------------------------------------------

export interface MetricsEnv {
  DB: D1Database;
  KV_STORE: KVNamespace;
  INTERNAL_API_KEY: string;
}

export interface ShopGenerationStats {
  shop: string;
  totalGenerated: number;
  successCount: number;
  failedCount: number;
  quotaExceededCount: number;
  timedOutCount: number;
}

export interface RemoveBgBurnEntry {
  /** YYYY-MM key */
  month: string;
  shop: string;
  /** Stored as string in KV; parsed to number here */
  creditsUsed: number;
}

/** PR-038: Webhook health per merchant, sourced from KV `webhook-health:{shop}` */
export interface WebhookHealthEntry {
  shop: string;
  missingCount: number;
  reregisteredCount: number;
  auditSuccess: boolean;
  lastAuditAt: string;
}

export interface MetricsResponse {
  perShopGenerations: ShopGenerationStats[];
  removeBgCreditBurnRate: RemoveBgBurnEntry[];
  /** PR-038: webhook health per merchant from last audit cron run */
  webhookHealth: WebhookHealthEntry[];
}

/**
 * Handle GET /internal/metrics.
 *
 * Requires the `X-Internal-Api-Key` request header to match the
 * `INTERNAL_API_KEY` binding value. Returns 403 on mismatch.
 *
 * Queries:
 *   - D1 `generated_images` — per-shop status counts
 *   - KV `rembg-credits:{shop}:{YYYY-MM}` — Remove.bg credit burn per shop/month
 */
export async function handleInternalMetrics(
  request: Request,
  env: MetricsEnv
): Promise<Response> {
  // Auth guard
  const apiKey = request.headers.get("X-Internal-Api-Key");
  if (!apiKey || apiKey !== env.INTERNAL_API_KEY) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Per-shop generation counts from D1 -----------------------------------
  let perShopGenerations: ShopGenerationStats[] = [];

  try {
    const rows = await env.DB.prepare(
      `SELECT
         shop,
         COUNT(*) AS total_generated,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
         SUM(CASE WHEN status = 'quota_exceeded' THEN 1 ELSE 0 END) AS quota_exceeded_count,
         SUM(CASE WHEN status = 'timed_out' THEN 1 ELSE 0 END) AS timed_out_count
       FROM generated_images
       GROUP BY shop
       ORDER BY total_generated DESC`
    ).all<{
      shop: string;
      total_generated: number;
      success_count: number;
      failed_count: number;
      quota_exceeded_count: number;
      timed_out_count: number;
    }>();

    perShopGenerations = (rows.results ?? []).map((r) => ({
      shop: r.shop,
      totalGenerated: r.total_generated,
      successCount: r.success_count,
      failedCount: r.failed_count,
      quotaExceededCount: r.quota_exceeded_count,
      timedOutCount: r.timed_out_count,
    }));
  } catch {
    perShopGenerations = [];
  }

  // --- Remove.bg credit burn rate from KV -----------------------------------
  // Keys follow the pattern: rembg-credits:{shop}:{YYYY-MM}
  // We list all matching keys and aggregate
  let removeBgCreditBurnRate: RemoveBgBurnEntry[] = [];

  try {
    const listResult = await env.KV_STORE.list({ prefix: "rembg-credits:" });

    const entries = await Promise.all(
      listResult.keys.map(async (key) => {
        const raw = await env.KV_STORE.get(key.name);
        const creditsUsed = raw ? parseInt(raw, 10) : 0;

        // Key format: rembg-credits:{shop}:{YYYY-MM}
        const parts = key.name.split(":");
        const month = parts.at(-1) ?? "";
        const shop = parts.slice(1, -1).join(":"); // handle shop names with colons

        return { month, shop, creditsUsed: isNaN(creditsUsed) ? 0 : creditsUsed };
      })
    );

    removeBgCreditBurnRate = entries.sort((a, b) => b.month.localeCompare(a.month));
  } catch {
    removeBgCreditBurnRate = [];
  }

  // --- PR-038: Webhook health per merchant from KV ----------------------------
  // Keys follow the pattern: webhook-health:{shop}
  let webhookHealth: WebhookHealthEntry[] = [];

  try {
    const listResult = await env.KV_STORE.list({ prefix: "webhook-health:" });

    const healthEntries = await Promise.all(
      listResult.keys.map(async (key) => {
        const raw = await env.KV_STORE.get(key.name);
        if (!raw) return null;

        try {
          const snapshot = JSON.parse(raw) as {
            shop: string;
            missingCount: number;
            reregisteredCount: number;
            auditSuccess: boolean;
            lastAuditAt: string;
          };
          return {
            shop: snapshot.shop,
            missingCount: snapshot.missingCount ?? 0,
            reregisteredCount: snapshot.reregisteredCount ?? 0,
            auditSuccess: snapshot.auditSuccess ?? true,
            lastAuditAt: snapshot.lastAuditAt ?? "",
          } satisfies WebhookHealthEntry;
        } catch {
          return null;
        }
      })
    );

    webhookHealth = healthEntries
      .filter((e): e is WebhookHealthEntry => e !== null)
      .sort((a, b) => a.shop.localeCompare(b.shop));
  } catch {
    webhookHealth = [];
  }

  const body: MetricsResponse = {
    perShopGenerations,
    removeBgCreditBurnRate,
    webhookHealth,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Remove.bg credit tracking helpers
// ---------------------------------------------------------------------------

/**
 * Increment the Remove.bg credit counter for a shop in the current month.
 *
 * Key: `rembg-credits:{shop}:{YYYY-MM}`
 * TTL: 90 days (3 months of history retained)
 */
export async function trackRemoveBgCredit(
  shop: string,
  credits: number,
  kv: KVNamespace
): Promise<void> {
  if (credits <= 0) return;

  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const key = `rembg-credits:${shop}:${month}`;

  try {
    const existing = await kv.get(key);
    const current = existing ? parseInt(existing, 10) : 0;
    const next = (isNaN(current) ? 0 : current) + credits;
    await kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 90 });
  } catch {
    // Best-effort
  }
}
