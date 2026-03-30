/**
 * PR-028: App performance monitoring and SLA alerts
 *
 * Runs three periodic alert checks via Cloudflare Cron Trigger:
 *
 *   1. checkP95Alert      — p95 generation time > 25 s  → Sentry alert
 *   2. checkSuccessRateAlert — success rate < 95% over last hour → Sentry alert
 *   3. checkDLQDepthAlert — DLQ depth > 50 → Sentry alert
 *
 * All checks are best-effort: a failure in one check does not prevent the
 * others from running.  Results are returned as typed objects for observability.
 *
 * The KV-cached timing percentile produced by status.server.ts
 * (`updateGenerationStats`) is re-used here so we do not need a live
 * Analytics Engine SQL query (which is unavailable inside Workers at runtime).
 *
 * DLQ depth is approximated from D1 `generated_images` rows with
 * status = 'failed' written in the last hour — because Cloudflare Queues
 * does not expose a runtime metrics API inside the Worker itself.
 *
 * NOTE: access_token is never included in any alert payload.
 */

import type { SentryClient } from "./sentry.server.js";
import type { TimingCache } from "./status.server.js";

// ---------------------------------------------------------------------------
// Environment bindings required by this module
// ---------------------------------------------------------------------------

export interface PerformanceMonitorEnv {
  DB: D1Database;
  KV_STORE: KVNamespace;
  SENTRY_DSN: string;
  ENVIRONMENT?: string;
  RELEASE?: string;
}

// ---------------------------------------------------------------------------
// SLA thresholds
// ---------------------------------------------------------------------------

/** Fire p95 alert when p95 generation time exceeds this value (milliseconds). */
export const P95_THRESHOLD_MS = 25_000;

/** Fire success-rate alert when 1-hour success rate falls below this value (0–100). */
export const SUCCESS_RATE_THRESHOLD_PCT = 95;

/** Fire DLQ-depth alert when failed-job count in last hour exceeds this value. */
export const DLQ_DEPTH_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Alert result types
// ---------------------------------------------------------------------------

export type AlertStatus = "ok" | "alert" | "error";

export interface P95AlertResult {
  status: AlertStatus;
  /** p95 value read from KV cache (ms), or null if cache is absent */
  p95Ms: number | null;
  /** Whether the Sentry alert was fired */
  alertFired: boolean;
  /** Error message if the check itself failed */
  errorMessage?: string;
}

export interface SuccessRateAlertResult {
  status: AlertStatus;
  /** Measured success rate (0–100), or null if no jobs in the window */
  successRatePct: number | null;
  /** Number of jobs analysed in the last hour */
  jobCount: number;
  alertFired: boolean;
  errorMessage?: string;
}

export interface DLQDepthAlertResult {
  status: AlertStatus;
  /** Number of failed jobs written to D1 in the last hour */
  dlqDepth: number;
  alertFired: boolean;
  errorMessage?: string;
}

export interface PerformanceAlertSummary {
  p95: P95AlertResult;
  successRate: SuccessRateAlertResult;
  dlqDepth: DLQDepthAlertResult;
  /** ISO timestamp of this run */
  runAt: string;
}

// ---------------------------------------------------------------------------
// KV key re-used from status.server.ts
// ---------------------------------------------------------------------------

const TIMING_CACHE_KEY = "status:timing-cache";

// ---------------------------------------------------------------------------
// check: p95 generation time
// ---------------------------------------------------------------------------

/**
 * Reads the p95 timing from the KV cache written by `updateGenerationStats()`
 * in status.server.ts, then fires a Sentry alert if p95 > 25 s.
 */
export async function checkP95Alert(
  env: PerformanceMonitorEnv,
  sentry: SentryClient
): Promise<P95AlertResult> {
  try {
    const raw = await env.KV_STORE.get(TIMING_CACHE_KEY);
    if (!raw) {
      return { status: "ok", p95Ms: null, alertFired: false };
    }

    let cache: TimingCache;
    try {
      cache = JSON.parse(raw) as TimingCache;
    } catch {
      return {
        status: "error",
        p95Ms: null,
        alertFired: false,
        errorMessage: "Failed to parse timing cache from KV",
      };
    }

    const p95Ms = cache.p95Ms ?? null;

    if (p95Ms !== null && p95Ms > P95_THRESHOLD_MS) {
      sentry.captureMessage(
        `SLA BREACH: p95 generation time ${p95Ms}ms exceeds ${P95_THRESHOLD_MS}ms threshold`,
        "error",
        {
          step: "performance-monitor/p95-alert",
          p95Ms,
          thresholdMs: P95_THRESHOLD_MS,
          sampleCount: cache.sampleCount,
          cacheUpdatedAt: cache.updatedAt,
        }
      );
      return { status: "alert", p95Ms, alertFired: true };
    }

    return { status: "ok", p95Ms, alertFired: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      p95Ms: null,
      alertFired: false,
      errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// check: success rate over last 1 hour
// ---------------------------------------------------------------------------

/**
 * Queries D1 for the success rate over the last 1 hour.
 * Fires a Sentry alert if success rate < 95%.
 */
export async function checkSuccessRateAlert(
  env: PerformanceMonitorEnv,
  sentry: SentryClient
): Promise<SuccessRateAlertResult> {
  try {
    const row = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count
       FROM generated_images
       WHERE generated_at >= datetime('now', '-1 hour')`
    ).first<{ total: number; success_count: number }>();

    const total = row?.total ?? 0;
    const successCount = row?.success_count ?? 0;

    if (total === 0) {
      // No jobs in the window — nothing to alert on
      return {
        status: "ok",
        successRatePct: null,
        jobCount: 0,
        alertFired: false,
      };
    }

    const successRatePct = Math.round((successCount / total) * 10000) / 100;

    if (successRatePct < SUCCESS_RATE_THRESHOLD_PCT) {
      sentry.captureMessage(
        `SLA BREACH: 1-hour success rate ${successRatePct.toFixed(2)}% is below ${SUCCESS_RATE_THRESHOLD_PCT}% threshold`,
        "error",
        {
          step: "performance-monitor/success-rate-alert",
          successRatePct,
          thresholdPct: SUCCESS_RATE_THRESHOLD_PCT,
          successCount,
          totalCount: total,
        }
      );
      return {
        status: "alert",
        successRatePct,
        jobCount: total,
        alertFired: true,
      };
    }

    return {
      status: "ok",
      successRatePct,
      jobCount: total,
      alertFired: false,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      successRatePct: null,
      jobCount: 0,
      alertFired: false,
      errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// check: DLQ depth
// ---------------------------------------------------------------------------

/**
 * Approximates the DLQ depth by counting D1 `generated_images` rows
 * with a failed status written in the last hour.
 *
 * Fires a Sentry alert if the count exceeds DLQ_DEPTH_THRESHOLD (50).
 *
 * Counted statuses: failed, timed_out, bg_removal_failed, renderer_timeout,
 * compositing_failed, quality_gate (all non-transient failure outcomes).
 */
export async function checkDLQDepthAlert(
  env: PerformanceMonitorEnv,
  sentry: SentryClient
): Promise<DLQDepthAlertResult> {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS dlq_depth
       FROM generated_images
       WHERE status IN (
         'failed',
         'timed_out',
         'bg_removal_failed',
         'renderer_timeout',
         'compositing_failed',
         'quality_gate'
       )
       AND generated_at >= datetime('now', '-1 hour')`
    ).first<{ dlq_depth: number }>();

    const dlqDepth = row?.dlq_depth ?? 0;

    if (dlqDepth > DLQ_DEPTH_THRESHOLD) {
      sentry.captureMessage(
        `SLA BREACH: DLQ depth ${dlqDepth} exceeds threshold of ${DLQ_DEPTH_THRESHOLD}`,
        "error",
        {
          step: "performance-monitor/dlq-depth-alert",
          dlqDepth,
          threshold: DLQ_DEPTH_THRESHOLD,
        }
      );
      return { status: "alert", dlqDepth, alertFired: true };
    }

    return { status: "ok", dlqDepth, alertFired: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      dlqDepth: 0,
      alertFired: false,
      errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// runPerformanceAlerts — orchestrator called from scheduled handler
// ---------------------------------------------------------------------------

/**
 * Runs all three SLA alert checks concurrently and returns a summary.
 *
 * Each check is independent: a failure in one does not prevent the others.
 * The caller (scheduled handler in worker entry point) should await this and
 * optionally log the summary.
 *
 * @param env    - Worker environment bindings
 * @param sentry - Pre-initialised SentryClient
 */
export async function runPerformanceAlerts(
  env: PerformanceMonitorEnv,
  sentry: SentryClient
): Promise<PerformanceAlertSummary> {
  const [p95, successRate, dlqDepth] = await Promise.all([
    checkP95Alert(env, sentry),
    checkSuccessRateAlert(env, sentry),
    checkDLQDepthAlert(env, sentry),
  ]);

  return {
    p95,
    successRate,
    dlqDepth,
    runAt: new Date().toISOString(),
  };
}
