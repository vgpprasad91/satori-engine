/**
 * PR-026: Analytics Engine metrics — unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  emitQueueMetric,
  emitWebhookMetric,
  handleInternalMetrics,
  trackRemoveBgCredit,
  type AnalyticsEnv,
  type MetricsEnv,
} from "../src/analytics.server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAeDataset() {
  return { writeDataPoint: vi.fn() };
}

function makeKv(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => ({
      keys: [...store.keys()]
        .filter((k) => (prefix ? k.startsWith(prefix) : true))
        .map((name) => ({ name })),
    })),
    _store: store,
  };
}

function makeDb(rows: Record<string, unknown>[] = []) {
  const stmt = {
    all: vi.fn(async () => ({ results: rows })),
    first: vi.fn(async () => null),
    run: vi.fn(async () => ({ success: true })),
    bind: vi.fn((): typeof stmt => stmt),
  };
  return { prepare: vi.fn(() => stmt) };
}

// ---------------------------------------------------------------------------
// emitQueueMetric
// ---------------------------------------------------------------------------

describe("emitQueueMetric", () => {
  it("calls writeDataPoint with correct blobs and doubles", () => {
    const ae = makeAeDataset();
    const env: AnalyticsEnv = { AE_METRICS: ae };

    emitQueueMetric(env, {
      shop: "shop.myshopify.com",
      templateId: "tmpl-001",
      durationMs: 1234,
      status: "success",
      bgRemovalCostCredits: 2,
    });

    expect(ae.writeDataPoint).toHaveBeenCalledOnce();
    const arg = ae.writeDataPoint.mock.calls[0]![0] as { indexes: string[]; blobs: string[]; doubles: number[] };
    expect(arg.indexes).toEqual(["shop.myshopify.com"]);
    expect(arg.blobs).toEqual(["shop.myshopify.com", "tmpl-001", "success"]);
    expect(arg.doubles).toEqual([1234, 2]);
  });

  it("does not throw if writeDataPoint throws", () => {
    const ae = { writeDataPoint: vi.fn(() => { throw new Error("AE unavailable"); }) };
    const env: AnalyticsEnv = { AE_METRICS: ae };

    expect(() =>
      emitQueueMetric(env, {
        shop: "shop.myshopify.com",
        templateId: "t",
        durationMs: 0,
        status: "failed",
        bgRemovalCostCredits: 0,
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// emitWebhookMetric
// ---------------------------------------------------------------------------

describe("emitWebhookMetric", () => {
  it("records deduplicated=true as double 1", () => {
    const ae = makeAeDataset();
    const env: AnalyticsEnv = { AE_METRICS: ae };

    emitWebhookMetric(env, {
      shop: "shop.myshopify.com",
      webhookType: "products/create",
      deduplicated: true,
    });

    const arg1 = ae.writeDataPoint.mock.calls[0]![0] as { blobs: string[]; doubles: number[] };
    expect(arg1.blobs).toContain("true");
    expect(arg1.doubles).toEqual([1]);
  });

  it("records deduplicated=false as double 0", () => {
    const ae = makeAeDataset();
    const env: AnalyticsEnv = { AE_METRICS: ae };

    emitWebhookMetric(env, {
      shop: "shop.myshopify.com",
      webhookType: "app/uninstalled",
      deduplicated: false,
    });

    const arg2 = ae.writeDataPoint.mock.calls[0]![0] as { blobs: string[]; doubles: number[] };
    expect(arg2.doubles).toEqual([0]);
    expect(arg2.blobs).toContain("false");
  });

  it("sets index to shop domain", () => {
    const ae = makeAeDataset();
    const env: AnalyticsEnv = { AE_METRICS: ae };

    emitWebhookMetric(env, {
      shop: "acme.myshopify.com",
      webhookType: "shop/redact",
      deduplicated: false,
    });

    const arg3 = ae.writeDataPoint.mock.calls[0]![0] as { indexes: string[] };
    expect(arg3.indexes).toEqual(["acme.myshopify.com"]);
  });

  it("does not throw if writeDataPoint throws", () => {
    const ae = { writeDataPoint: vi.fn(() => { throw new Error("AE unavailable"); }) };
    const env: AnalyticsEnv = { AE_METRICS: ae };

    expect(() =>
      emitWebhookMetric(env, { shop: "s", webhookType: "products/create", deduplicated: false })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleInternalMetrics — auth
// ---------------------------------------------------------------------------

describe("handleInternalMetrics — auth", () => {
  it("returns 403 when API key is missing", async () => {
    const env: MetricsEnv = {
      DB: makeDb() as unknown as D1Database,
      KV_STORE: makeKv() as unknown as KVNamespace,
      INTERNAL_API_KEY: "secret-key",
    };

    const req = new Request("https://example.com/internal/metrics");
    const res = await handleInternalMetrics(req, env);
    expect(res.status).toBe(403);
  });

  it("returns 403 when API key is wrong", async () => {
    const env: MetricsEnv = {
      DB: makeDb() as unknown as D1Database,
      KV_STORE: makeKv() as unknown as KVNamespace,
      INTERNAL_API_KEY: "secret-key",
    };

    const req = new Request("https://example.com/internal/metrics", {
      headers: { "X-Internal-Api-Key": "wrong-key" },
    });
    const res = await handleInternalMetrics(req, env);
    expect(res.status).toBe(403);
  });

  it("returns 200 with valid API key", async () => {
    const env: MetricsEnv = {
      DB: makeDb() as unknown as D1Database,
      KV_STORE: makeKv() as unknown as KVNamespace,
      INTERNAL_API_KEY: "secret-key",
    };

    const req = new Request("https://example.com/internal/metrics", {
      headers: { "X-Internal-Api-Key": "secret-key" },
    });
    const res = await handleInternalMetrics(req, env);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// handleInternalMetrics — per-shop generation counts
// ---------------------------------------------------------------------------

describe("handleInternalMetrics — per-shop generation counts", () => {
  it("returns per-shop stats from D1", async () => {
    const dbRows = [
      {
        shop: "acme.myshopify.com",
        total_generated: 10,
        success_count: 8,
        failed_count: 1,
        quota_exceeded_count: 1,
        timed_out_count: 0,
      },
    ];
    const env: MetricsEnv = {
      DB: makeDb(dbRows) as unknown as D1Database,
      KV_STORE: makeKv() as unknown as KVNamespace,
      INTERNAL_API_KEY: "key",
    };

    const req = new Request("https://example.com/internal/metrics", {
      headers: { "X-Internal-Api-Key": "key" },
    });
    const res = await handleInternalMetrics(req, env);
    const body = await res.json() as { perShopGenerations: unknown[] };

    expect(body.perShopGenerations).toHaveLength(1);
    const stat = body.perShopGenerations[0] as Record<string, unknown>;
    expect(stat.shop).toBe("acme.myshopify.com");
    expect(stat.totalGenerated).toBe(10);
    expect(stat.successCount).toBe(8);
    expect(stat.failedCount).toBe(1);
    expect(stat.quotaExceededCount).toBe(1);
    expect(stat.timedOutCount).toBe(0);
  });

  it("returns empty array if D1 query fails", async () => {
    const failStmt = {
      all: vi.fn(async () => { throw new Error("D1 error"); }),
      first: vi.fn(async () => null),
      run: vi.fn(async () => ({ success: true })),
      bind: vi.fn((): typeof failStmt => failStmt),
    };
    const db = { prepare: vi.fn(() => failStmt) };

    const env: MetricsEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: makeKv() as unknown as KVNamespace,
      INTERNAL_API_KEY: "key",
    };

    const req = new Request("https://example.com/internal/metrics", {
      headers: { "X-Internal-Api-Key": "key" },
    });
    const res = await handleInternalMetrics(req, env);
    const body = await res.json() as { perShopGenerations: unknown[] };
    expect(body.perShopGenerations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleInternalMetrics — Remove.bg credit burn rate
// ---------------------------------------------------------------------------

describe("handleInternalMetrics — removeBg credit burn rate", () => {
  it("reads rembg-credits KV keys and returns burn entries", async () => {
    const kv = makeKv({
      "rembg-credits:acme.myshopify.com:2026-03": "5",
      "rembg-credits:acme.myshopify.com:2026-02": "12",
    });

    const env: MetricsEnv = {
      DB: makeDb() as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
      INTERNAL_API_KEY: "key",
    };

    const req = new Request("https://example.com/internal/metrics", {
      headers: { "X-Internal-Api-Key": "key" },
    });
    const res = await handleInternalMetrics(req, env);
    const body = await res.json() as { removeBgCreditBurnRate: unknown[] };

    expect(body.removeBgCreditBurnRate).toHaveLength(2);
    const sorted = body.removeBgCreditBurnRate as Array<{ month: string; creditsUsed: number }>;
    // Sorted descending by month
    expect(sorted[0]!.month).toBe("2026-03");
    expect(sorted[0]!.creditsUsed).toBe(5);
    expect(sorted[1]!.month).toBe("2026-02");
    expect(sorted[1]!.creditsUsed).toBe(12);
  });

  it("returns empty array if KV list fails", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      list: vi.fn(async () => { throw new Error("KV error"); }),
    };

    const env: MetricsEnv = {
      DB: makeDb() as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
      INTERNAL_API_KEY: "key",
    };

    const req = new Request("https://example.com/internal/metrics", {
      headers: { "X-Internal-Api-Key": "key" },
    });
    const res = await handleInternalMetrics(req, env);
    const body = await res.json() as { removeBgCreditBurnRate: unknown[] };
    expect(body.removeBgCreditBurnRate).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// trackRemoveBgCredit
// ---------------------------------------------------------------------------

describe("trackRemoveBgCredit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T00:00:00Z"));
  });

  it("increments the counter for the current month", async () => {
    const kv = makeKv();
    await trackRemoveBgCredit("acme.myshopify.com", 3, kv as unknown as KVNamespace);

    expect(kv.put).toHaveBeenCalledWith(
      "rembg-credits:acme.myshopify.com:2026-03",
      "3",
      { expirationTtl: 60 * 60 * 24 * 90 }
    );
  });

  it("adds to existing counter", async () => {
    const kv = makeKv({ "rembg-credits:acme.myshopify.com:2026-03": "7" });
    await trackRemoveBgCredit("acme.myshopify.com", 2, kv as unknown as KVNamespace);

    const putArg = kv.put.mock.calls[0]!;
    expect(putArg[1]).toBe("9");
  });

  it("does nothing when credits is 0", async () => {
    const kv = makeKv();
    await trackRemoveBgCredit("acme.myshopify.com", 0, kv as unknown as KVNamespace);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("does not throw if KV.put fails", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => { throw new Error("KV write error"); }),
      list: vi.fn(async () => ({ keys: [] })),
    };

    await expect(
      trackRemoveBgCredit("shop.myshopify.com", 1, kv as unknown as KVNamespace)
    ).resolves.not.toThrow();
  });
});
