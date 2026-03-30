/**
 * PR-027: Public /status page — unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchQueueDepth,
  fetchUptimePct,
  fetchLastIncident,
  readTimingCache,
  updateGenerationStats,
  buildStatusData,
  renderStatusHtml,
  handleStatusPage,
  type StatusEnv,
  type StatusData,
  type TimingCache,
} from "../src/status.server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(firstResult: Record<string, unknown> | null = null, allResults: Record<string, unknown>[] = []) {
  const stmt = {
    first: vi.fn(async () => firstResult),
    all: vi.fn(async () => ({ results: allResults })),
    run: vi.fn(async () => ({ success: true })),
    bind: vi.fn(function (this: typeof stmt) { return this; }),
  };
  return { prepare: vi.fn(() => stmt), _stmt: stmt };
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

// ---------------------------------------------------------------------------
// fetchQueueDepth
// ---------------------------------------------------------------------------

describe("fetchQueueDepth", () => {
  it("returns the pending job count from D1", async () => {
    const db = makeDb({ cnt: 7 });
    const depth = await fetchQueueDepth(db as unknown as D1Database);
    expect(depth).toBe(7);
  });

  it("returns 0 when D1 row is null", async () => {
    const db = makeDb(null);
    const depth = await fetchQueueDepth(db as unknown as D1Database);
    expect(depth).toBe(0);
  });

  it("returns 0 when D1 throws", async () => {
    const stmt = {
      first: vi.fn(async () => { throw new Error("D1 error"); }),
      bind: vi.fn(function (this: typeof stmt) { return this; }),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const depth = await fetchQueueDepth(db as unknown as D1Database);
    expect(depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchUptimePct
// ---------------------------------------------------------------------------

describe("fetchUptimePct", () => {
  it("returns 100% when all jobs succeeded", async () => {
    const db = makeDb({ total: 10, success_count: 10 });
    const pct = await fetchUptimePct(db as unknown as D1Database);
    expect(pct).toBe(100);
  });

  it("returns correct percentage for partial failures", async () => {
    const db = makeDb({ total: 1000, success_count: 987 });
    const pct = await fetchUptimePct(db as unknown as D1Database);
    expect(pct).toBe(98.7);
  });

  it("returns null when there are no jobs in the window", async () => {
    const db = makeDb({ total: 0, success_count: 0 });
    const pct = await fetchUptimePct(db as unknown as D1Database);
    expect(pct).toBeNull();
  });

  it("returns null when D1 row is null", async () => {
    const db = makeDb(null);
    const pct = await fetchUptimePct(db as unknown as D1Database);
    expect(pct).toBeNull();
  });

  it("returns null when D1 throws", async () => {
    const stmt = {
      first: vi.fn(async () => { throw new Error("D1 error"); }),
      bind: vi.fn(function (this: typeof stmt) { return this; }),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const pct = await fetchUptimePct(db as unknown as D1Database);
    expect(pct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchLastIncident
// ---------------------------------------------------------------------------

describe("fetchLastIncident", () => {
  it("returns the most recent non-success row", async () => {
    const db = makeDb({
      shop: "acme.myshopify.com",
      product_id: "prod_123",
      status: "timed_out",
      generated_at: "2026-03-01T12:00:00Z",
    });

    const incident = await fetchLastIncident(db as unknown as D1Database);
    expect(incident).toMatchObject({
      shop: "acme.myshopify.com",
      productId: "prod_123",
      status: "timed_out",
      occurredAt: "2026-03-01T12:00:00Z",
    });
  });

  it("returns null when no incidents", async () => {
    const db = makeDb(null);
    const incident = await fetchLastIncident(db as unknown as D1Database);
    expect(incident).toBeNull();
  });

  it("returns null when D1 throws", async () => {
    const stmt = {
      first: vi.fn(async () => { throw new Error("D1 error"); }),
      bind: vi.fn(function (this: typeof stmt) { return this; }),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const incident = await fetchLastIncident(db as unknown as D1Database);
    expect(incident).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readTimingCache
// ---------------------------------------------------------------------------

describe("readTimingCache", () => {
  it("parses a valid cached timing object", async () => {
    const cache: TimingCache = { p50Ms: 4200, p95Ms: 11000, sampleCount: 150, updatedAt: "2026-03-12T00:00:00Z" };
    const kv = makeKv({ "status:timing-cache": JSON.stringify(cache) });

    const result = await readTimingCache(kv as unknown as KVNamespace);
    expect(result).toMatchObject({ p50Ms: 4200, p95Ms: 11000, sampleCount: 150 });
  });

  it("returns null when key is absent", async () => {
    const kv = makeKv({});
    const result = await readTimingCache(kv as unknown as KVNamespace);
    expect(result).toBeNull();
  });

  it("returns null on parse error", async () => {
    const kv = makeKv({ "status:timing-cache": "not-json" });
    const result = await readTimingCache(kv as unknown as KVNamespace);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateGenerationStats
// ---------------------------------------------------------------------------

describe("updateGenerationStats", () => {
  it("stores correct p50 and p95 after one sample", async () => {
    const kv = makeKv({});
    await updateGenerationStats(kv as unknown as KVNamespace, 5000);

    const cached = JSON.parse(kv._store.get("status:timing-cache") ?? "null") as TimingCache;
    expect(cached).not.toBeNull();
    expect(cached.p50Ms).toBe(5000);
    expect(cached.p95Ms).toBe(5000);
    expect(cached.sampleCount).toBe(1);
  });

  it("computes p50/p95 over multiple samples", async () => {
    const kv = makeKv({});
    // Add 10 samples: 1000..10000 step 1000
    for (let i = 1; i <= 10; i++) {
      await updateGenerationStats(kv as unknown as KVNamespace, i * 1000);
    }

    const cached = JSON.parse(kv._store.get("status:timing-cache") ?? "null") as TimingCache;
    // sorted: [1000,2000,3000,4000,5000,6000,7000,8000,9000,10000]
    // p50 index = floor(10 * 0.5) = 5 → 6000
    expect(cached.p50Ms).toBe(6000);
    // p95 index = floor(10 * 0.95) = 9 → 10000
    expect(cached.p95Ms).toBe(10000);
  });

  it("trims samples to WINDOW size (500)", async () => {
    // Pre-load 500 existing samples (all 1ms)
    const samples = new Array(500).fill(1);
    const kv = makeKv({ "status:timing-cache:samples": JSON.stringify(samples) });

    // Add one more (100000ms)
    await updateGenerationStats(kv as unknown as KVNamespace, 100000);

    const stored = JSON.parse(kv._store.get("status:timing-cache:samples") ?? "[]") as number[];
    expect(stored).toHaveLength(500);
    // The oldest entry (1ms) should have been trimmed; the new one (100000) should be last
    expect(stored.at(-1)).toBe(100000);
  });

  it("does not throw when KV fails", async () => {
    const kv = {
      get: vi.fn(async () => { throw new Error("KV error"); }),
      put: vi.fn(async () => undefined),
    };
    await expect(
      updateGenerationStats(kv as unknown as KVNamespace, 1000)
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildStatusData
// ---------------------------------------------------------------------------

describe("buildStatusData", () => {
  it("assembles status from DB and KV in parallel", async () => {
    const db = makeDb({ cnt: 3 });
    // Override the first() to return different results per call
    let callCount = 0;
    db._stmt.first.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { cnt: 3 }; // queueDepth
      if (callCount === 2) return { total: 200, success_count: 198 }; // uptimePct
      return null; // lastIncident
    });

    const timingCache: TimingCache = { p50Ms: 3000, p95Ms: 9000, sampleCount: 50, updatedAt: new Date().toISOString() };
    const kv = makeKv({ "status:timing-cache": JSON.stringify(timingCache) });

    const env: StatusEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
    };

    const data = await buildStatusData(env);
    expect(typeof data.generatedAt).toBe("string");
    expect(data.queueDepth).toBeGreaterThanOrEqual(0);
    expect(data.p50Ms).toBe(3000);
    expect(data.p95Ms).toBe(9000);
  });
});

// ---------------------------------------------------------------------------
// renderStatusHtml
// ---------------------------------------------------------------------------

describe("renderStatusHtml", () => {
  const baseData: StatusData = {
    queueDepth: 5,
    p50Ms: 4200,
    p95Ms: 12000,
    uptimePct: 99.87,
    lastIncident: null,
    generatedAt: "2026-03-12T00:00:00.000Z",
  };

  it("includes auto-refresh meta tag set to 30 seconds", () => {
    const html = renderStatusHtml(baseData);
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('content="30"');
  });

  it("renders queue depth", () => {
    const html = renderStatusHtml({ ...baseData, queueDepth: 42 });
    expect(html).toContain("42");
  });

  it("renders p50 and p95 timing", () => {
    const html = renderStatusHtml(baseData);
    expect(html).toContain("4,200ms");
    expect(html).toContain("12,000ms");
  });

  it("renders uptime percentage", () => {
    const html = renderStatusHtml(baseData);
    expect(html).toContain("99.87%");
  });

  it("renders N/A when p50/p95 are null", () => {
    const html = renderStatusHtml({ ...baseData, p50Ms: null, p95Ms: null });
    expect(html.match(/N\/A/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders N/A when uptimePct is null", () => {
    const html = renderStatusHtml({ ...baseData, uptimePct: null });
    expect(html).toContain("N/A");
  });

  it("shows 'All Systems Operational' when uptime ≥ 99%", () => {
    const html = renderStatusHtml({ ...baseData, uptimePct: 99.5 });
    expect(html).toContain("All Systems Operational");
  });

  it("shows 'Degraded Performance' when uptime is 95-99%", () => {
    const html = renderStatusHtml({ ...baseData, uptimePct: 97.5 });
    expect(html).toContain("Degraded Performance");
  });

  it("shows 'Partial Outage' when uptime < 95%", () => {
    const html = renderStatusHtml({ ...baseData, uptimePct: 90 });
    expect(html).toContain("Partial Outage");
  });

  it("renders last incident details when present", () => {
    const data: StatusData = {
      ...baseData,
      lastIncident: {
        shop: "acme.myshopify.com",
        status: "timed_out",
        occurredAt: "2026-03-01T10:00:00Z",
        productId: "prod_abc",
      },
    };
    const html = renderStatusHtml(data);
    expect(html).toContain("acme.myshopify.com");
    expect(html).toContain("timed out"); // underscores replaced with spaces
    expect(html).toContain("2026-03-01T10:00:00Z");
  });

  it("renders 'No incidents' when lastIncident is null", () => {
    const html = renderStatusHtml({ ...baseData, lastIncident: null });
    expect(html).toContain("No incidents");
  });

  it("escapes HTML in shop name to prevent XSS", () => {
    const data: StatusData = {
      ...baseData,
      lastIncident: {
        shop: "<script>alert('xss')</script>.myshopify.com",
        status: "failed",
        occurredAt: "2026-03-01T00:00:00Z",
        productId: "prod_1",
      },
    };
    const html = renderStatusHtml(data);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes the generatedAt timestamp", () => {
    const html = renderStatusHtml(baseData);
    expect(html).toContain("2026-03-12T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// handleStatusPage
// ---------------------------------------------------------------------------

describe("handleStatusPage", () => {
  it("returns 200 with text/html content type", async () => {
    const db = makeDb({ cnt: 0 });
    db._stmt.first.mockResolvedValue({ cnt: 0 });

    const kv = makeKv({});
    const env: StatusEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
    };

    const res = await handleStatusPage(env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("sets cache-control header for public caching", async () => {
    const db = makeDb(null);
    const kv = makeKv({});
    const env: StatusEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
    };

    const res = await handleStatusPage(env);
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("public");
    expect(cc).toContain("max-age");
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const db = makeDb(null);
    const kv = makeKv({});
    const env: StatusEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
    };

    const res = await handleStatusPage(env);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("requires no authentication — any caller gets 200", async () => {
    const db = makeDb(null);
    const kv = makeKv({});
    const env: StatusEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
    };

    // No auth headers passed — should still return 200
    const res = await handleStatusPage(env);
    expect(res.status).toBe(200);
  });

  it("HTML body contains auto-refresh meta tag", async () => {
    const db = makeDb(null);
    const kv = makeKv({});
    const env: StatusEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
    };

    const res = await handleStatusPage(env);
    const body = await res.text();
    expect(body).toContain('content="30"');
  });
});
