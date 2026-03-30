/**
 * PR-027: Public /status page
 *
 * Standalone handler serving a public status page with:
 *   - Current queue depth (pending jobs from D1)
 *   - Average generation time p50 / p95 (from KV-cached aggregated stats)
 *   - 30-day uptime percentage (success rate from D1)
 *   - Last incident (most recent non-success event from D1)
 *
 * Auto-refreshes every 30 seconds via <meta http-equiv="refresh">.
 * No authentication required.
 *
 * The KV cache for p50/p95 is written by the Queue consumer (PR-013/026)
 * via `updateGenerationStats()` exported here.  A cron job (or the consumer
 * itself) calls this function after every completed job so the status page
 * always has fresh timing data without hitting D1 on every public request.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusEnv {
  DB: D1Database;
  KV_STORE: KVNamespace;
}

export interface StatusData {
  queueDepth: number;
  p50Ms: number | null;
  p95Ms: number | null;
  uptimePct: number | null;
  lastIncident: LastIncident | null;
  generatedAt: string;
}

export interface LastIncident {
  shop: string;
  status: string;
  occurredAt: string;
  productId: string;
}

// KV key where rolling timing percentiles are cached
const TIMING_CACHE_KEY = "status:timing-cache";

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/**
 * Fetch queue depth: count of generated_images rows with status = 'pending'
 * created in the last 24 hours (in-flight jobs).
 */
export async function fetchQueueDepth(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM generated_images
         WHERE status = 'pending'
           AND generated_at >= datetime('now', '-24 hours')`
      )
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch 30-day uptime as a percentage: (success_count / total_count) * 100.
 * Returns null if there are no jobs in the window.
 */
export async function fetchUptimePct(db: D1Database): Promise<number | null> {
  try {
    const row = await db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count
         FROM generated_images
         WHERE generated_at >= datetime('now', '-30 days')`
      )
      .first<{ total: number; success_count: number }>();

    if (!row || row.total === 0) return null;
    return Math.round((row.success_count / row.total) * 10000) / 100; // e.g. 99.87
  } catch {
    return null;
  }
}

/**
 * Fetch the most recent non-success event from D1 as the "last incident".
 */
export async function fetchLastIncident(
  db: D1Database
): Promise<LastIncident | null> {
  try {
    const row = await db
      .prepare(
        `SELECT shop, product_id, status, generated_at
         FROM generated_images
         WHERE status NOT IN ('success', 'pending')
         ORDER BY generated_at DESC
         LIMIT 1`
      )
      .first<{
        shop: string;
        product_id: string;
        status: string;
        generated_at: string;
      }>();

    if (!row || !row.shop || !row.status) return null;
    return {
      shop: row.shop,
      status: row.status,
      occurredAt: row.generated_at,
      productId: row.product_id,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Timing percentile cache
// ---------------------------------------------------------------------------

export interface TimingCache {
  p50Ms: number;
  p95Ms: number;
  sampleCount: number;
  updatedAt: string;
}

/**
 * Read cached p50/p95 timing stats from KV.
 * Written by `updateGenerationStats()` after each Queue consumer job.
 */
export async function readTimingCache(
  kv: KVNamespace
): Promise<TimingCache | null> {
  try {
    const raw = await kv.get(TIMING_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TimingCache;
  } catch {
    return null;
  }
}

/**
 * Update the rolling timing percentile cache in KV.
 *
 * Maintains a fixed-size window of the last `WINDOW` duration values.
 * On every call with a new `durationMs`, appends it to the stored array,
 * trims to `WINDOW` entries, then recomputes p50 and p95.
 *
 * TTL: 7 days (cache self-heals if never updated for a week).
 */
const TIMING_WINDOW = 500; // keep last 500 samples

export async function updateGenerationStats(
  kv: KVNamespace,
  durationMs: number
): Promise<void> {
  try {
    const existing = await kv.get(`${TIMING_CACHE_KEY}:samples`);
    const samples: number[] = existing ? (JSON.parse(existing) as number[]) : [];

    samples.push(durationMs);
    if (samples.length > TIMING_WINDOW) {
      samples.splice(0, samples.length - TIMING_WINDOW);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

    const cache: TimingCache = {
      p50Ms: p50,
      p95Ms: p95,
      sampleCount: sorted.length,
      updatedAt: new Date().toISOString(),
    };

    await Promise.all([
      kv.put(TIMING_CACHE_KEY, JSON.stringify(cache), {
        expirationTtl: 60 * 60 * 24 * 7,
      }),
      kv.put(`${TIMING_CACHE_KEY}:samples`, JSON.stringify(samples), {
        expirationTtl: 60 * 60 * 24 * 7,
      }),
    ]);
  } catch {
    // Best-effort; never block queue consumer
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Gather all status data in parallel, then render the HTML page.
 */
export async function buildStatusData(env: StatusEnv): Promise<StatusData> {
  const [queueDepth, uptimePct, lastIncident, timingCache] = await Promise.all([
    fetchQueueDepth(env.DB),
    fetchUptimePct(env.DB),
    fetchLastIncident(env.DB),
    readTimingCache(env.KV_STORE),
  ]);

  return {
    queueDepth,
    p50Ms: timingCache?.p50Ms ?? null,
    p95Ms: timingCache?.p95Ms ?? null,
    uptimePct,
    lastIncident,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Render the status page as an HTML string.
 */
export function renderStatusHtml(data: StatusData): string {
  const uptimeDisplay =
    data.uptimePct !== null ? `${data.uptimePct.toFixed(2)}%` : "N/A";

  const p50Display = data.p50Ms !== null ? `${data.p50Ms.toLocaleString()}ms` : "N/A";
  const p95Display = data.p95Ms !== null ? `${data.p95Ms.toLocaleString()}ms` : "N/A";

  const overallStatus =
    data.uptimePct === null || data.uptimePct >= 99
      ? { label: "All Systems Operational", color: "#22c55e", dot: "#16a34a" }
      : data.uptimePct >= 95
      ? { label: "Degraded Performance", color: "#f59e0b", dot: "#d97706" }
      : { label: "Partial Outage", color: "#ef4444", dot: "#dc2626" };

  const lastIncidentHtml = data.lastIncident
    ? `
      <div class="incident-card">
        <div class="incident-header">Last Incident</div>
        <div class="incident-status">${escapeHtml(data.lastIncident.status.replace(/_/g, " "))}</div>
        <div class="incident-meta">
          Shop: <strong>${escapeHtml(data.lastIncident.shop)}</strong>
          &nbsp;·&nbsp;
          ${escapeHtml(data.lastIncident.occurredAt)}
        </div>
      </div>`
    : `<div class="no-incident">No incidents in recorded history.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="refresh" content="30" />
  <title>MailCraft Shopify App — Status</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px 16px;
    }
    .container { width: 100%; max-width: 680px; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; }
    .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 32px; }
    .status-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #1e293b;
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 24px;
      border: 1px solid #334155;
    }
    .dot {
      width: 14px; height: 14px;
      border-radius: 50%;
      background: ${overallStatus.dot};
      flex-shrink: 0;
      box-shadow: 0 0 0 4px ${overallStatus.color}33;
    }
    .status-label { font-size: 1rem; font-weight: 600; color: ${overallStatus.color}; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .metric-card {
      background: #1e293b;
      border-radius: 12px;
      padding: 20px;
      border: 1px solid #334155;
    }
    .metric-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 8px; }
    .metric-value { font-size: 1.75rem; font-weight: 700; color: #f1f5f9; }
    .metric-unit { font-size: 0.75rem; color: #94a3b8; margin-top: 2px; }
    .section-title { font-size: 0.875rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .incident-card {
      background: #1e293b;
      border-radius: 12px;
      padding: 20px 24px;
      border: 1px solid #334155;
      margin-bottom: 16px;
    }
    .incident-header { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 6px; }
    .incident-status { font-size: 1rem; font-weight: 600; color: #f87171; text-transform: capitalize; margin-bottom: 4px; }
    .incident-meta { font-size: 0.75rem; color: #64748b; }
    .no-incident { color: #22c55e; font-size: 0.875rem; padding: 16px 0; }
    .refresh-note { margin-top: 32px; font-size: 0.75rem; color: #475569; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>MailCraft Shopify App</h1>
    <p class="subtitle">Service Status &mdash; auto-refreshes every 30 seconds</p>

    <div class="status-banner">
      <div class="dot"></div>
      <div class="status-label">${overallStatus.label}</div>
    </div>

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Queue Depth</div>
        <div class="metric-value">${data.queueDepth}</div>
        <div class="metric-unit">pending jobs</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Gen Time p50</div>
        <div class="metric-value">${p50Display}</div>
        <div class="metric-unit">median latency</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Gen Time p95</div>
        <div class="metric-value">${p95Display}</div>
        <div class="metric-unit">95th percentile</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">30-day Uptime</div>
        <div class="metric-value">${uptimeDisplay}</div>
        <div class="metric-unit">success rate</div>
      </div>
    </div>

    <div class="section-title">Incident History</div>
    ${lastIncidentHtml}

    <p class="refresh-note">Last updated: ${escapeHtml(data.generatedAt)}</p>
  </div>
</body>
</html>`;
}

/**
 * HTTP handler for the public /status page.
 * Returns an HTML response with no authentication requirement.
 */
export async function handleStatusPage(env: StatusEnv): Promise<Response> {
  const data = await buildStatusData(env);
  const html = renderStatusHtml(data);

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Allow public CDN caching for 20 seconds, then serve stale while revalidating
      "Cache-Control": "public, max-age=20, stale-while-revalidate=10",
      // Security headers appropriate for a public page
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
