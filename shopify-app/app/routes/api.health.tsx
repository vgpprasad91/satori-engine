/**
 * GET /api/health — application health check (Blocker 3).
 *
 * Verifies that core bindings (D1, KV, R2) are reachable and warns if
 * R2 lifecycle rules are not configured for the LOGS_BUCKET.
 *
 * R2 lifecycle rules must be set via:
 *   wrangler r2 bucket lifecycle set shopify-app-production-logs --expire-days 90
 *   wrangler r2 bucket lifecycle set shopify-app-production-assets --expire-days 90
 *
 * This endpoint is safe to hit publicly (no sensitive data returned).
 * Recommended: add this URL to your uptime monitoring.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";

interface HealthStatus {
  status: "ok" | "degraded";
  timestamp: string;
  checks: {
    d1: CheckResult;
    kv: CheckResult;
    r2_assets: CheckResult;
    r2_logs: CheckResult;
    r2_lifecycle: CheckResult;
  };
  warnings: string[];
}

interface CheckResult {
  status: "ok" | "warn" | "error";
  message: string;
}

interface HealthEnv {
  DB?: D1Database;
  KV_STORE?: KVNamespace;
  ASSETS_BUCKET?: R2Bucket;
  LOGS_BUCKET?: R2Bucket;
}

export async function loader({ context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: HealthEnv } }).cloudflare.env;

  const warnings: string[] = [];
  const checks: HealthStatus["checks"] = {
    d1: { status: "ok", message: "D1 reachable" },
    kv: { status: "ok", message: "KV reachable" },
    r2_assets: { status: "ok", message: "ASSETS_BUCKET reachable" },
    r2_logs: { status: "ok", message: "LOGS_BUCKET reachable" },
    r2_lifecycle: {
      status: "warn",
      message:
        "R2 lifecycle rules cannot be verified at runtime. Ensure 90-day expiry is set: " +
        "wrangler r2 bucket lifecycle set <bucket-name> --expire-days 90",
    },
  };

  // D1 check
  if (!env.DB) {
    checks.d1 = { status: "error", message: "DB binding not configured" };
  } else {
    try {
      await env.DB.prepare("SELECT 1").first();
    } catch (err) {
      checks.d1 = {
        status: "error",
        message: `D1 query failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // KV check
  if (!env.KV_STORE) {
    checks.kv = { status: "error", message: "KV_STORE binding not configured" };
  } else {
    try {
      const probe = await env.KV_STORE.get("__health_probe__");
      void probe; // value may be null — that's fine
    } catch (err) {
      checks.kv = {
        status: "error",
        message: `KV read failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // R2 ASSETS_BUCKET check
  if (!env.ASSETS_BUCKET) {
    checks.r2_assets = {
      status: "warn",
      message: "ASSETS_BUCKET binding not configured",
    };
  } else {
    try {
      await env.ASSETS_BUCKET.head("__health_probe__");
    } catch (err) {
      // head() on a missing key throws — that's expected and means the bucket is reachable
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("404") && !msg.includes("NoSuchKey") && !msg.includes("not found")) {
        checks.r2_assets = { status: "error", message: `R2 head failed: ${msg}` };
      }
    }
  }

  // R2 LOGS_BUCKET check
  if (!env.LOGS_BUCKET) {
    checks.r2_logs = {
      status: "warn",
      message: "LOGS_BUCKET binding not configured",
    };
  } else {
    try {
      await env.LOGS_BUCKET.head("__health_probe__");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("404") && !msg.includes("NoSuchKey") && !msg.includes("not found")) {
        checks.r2_logs = { status: "error", message: `R2 logs head failed: ${msg}` };
      }
    }
  }

  // R2 lifecycle — always warn (cannot be verified at runtime via Workers API)
  warnings.push(
    "R2 lifecycle rules must be configured manually. " +
      "Run: wrangler r2 bucket lifecycle set shopify-app-production-logs --expire-days 90 " +
      "and wrangler r2 bucket lifecycle set shopify-app-production-assets --expire-days 90"
  );

  const hasError = Object.values(checks).some((c) => c.status === "error");
  const overallStatus: HealthStatus["status"] = hasError ? "degraded" : "ok";

  const body: HealthStatus = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
    warnings,
  };

  return json(body, {
    status: hasError ? 503 : 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
