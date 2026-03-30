/**
 * PR-028: App performance monitoring and SLA alerts — unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkP95Alert,
  checkSuccessRateAlert,
  checkDLQDepthAlert,
  runPerformanceAlerts,
  P95_THRESHOLD_MS,
  SUCCESS_RATE_THRESHOLD_PCT,
  DLQ_DEPTH_THRESHOLD,
  type PerformanceMonitorEnv,
} from "../src/performance-monitor.server.js";
import type { SentryClient } from "../src/sentry.server.js";
import type { TimingCache } from "../src/status.server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKv(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    list: vi.fn(async () => ({ keys: [] })),
    delete: vi.fn(async () => undefined),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
    _store: store,
  };
}

function makeDb(firstResult: Record<string, unknown> | null = null) {
  const stmt = {
    first: vi.fn(async () => firstResult),
    all: vi.fn(async () => ({ results: [] })),
    run: vi.fn(async () => ({ success: true })),
    bind: vi.fn(function (this: typeof stmt) {
      return this;
    }),
  };
  return { prepare: vi.fn(() => stmt), _stmt: stmt };
}

function makeSentry() {
  return {
    captureException: vi.fn(() => "event-id"),
    captureMessage: vi.fn(() => "msg-id"),
    addBreadcrumb: vi.fn(),
    withScope: vi.fn((cb: (scope: unknown) => void) =>
      cb({
        setTag: vi.fn(),
        setExtra: vi.fn(),
        setUser: vi.fn(),
      })
    ),
    flush: vi.fn(async () => true),
  } satisfies SentryClient;
}

function makeEnv(
  dbFirstResult: Record<string, unknown> | null = null,
  kvData: Record<string, string> = {}
): {
  env: PerformanceMonitorEnv;
  db: ReturnType<typeof makeDb>;
  kv: ReturnType<typeof makeKv>;
} {
  const db = makeDb(dbFirstResult);
  const kv = makeKv(kvData);
  const env: PerformanceMonitorEnv = {
    DB: db as unknown as D1Database,
    KV_STORE: kv as unknown as KVNamespace,
    SENTRY_DSN: "https://test@sentry.io/0",
    ENVIRONMENT: "test",
  };
  return { env, db, kv };
}

function makeTimingCache(p95Ms: number, sampleCount = 100): TimingCache {
  return {
    p50Ms: Math.round(p95Ms * 0.5),
    p95Ms,
    sampleCount,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// checkP95Alert
// ---------------------------------------------------------------------------

describe("checkP95Alert — no KV cache", () => {
  it("returns ok with null p95 when cache key is absent", async () => {
    const { env } = makeEnv(null, {});
    const sentry = makeSentry();

    const result = await checkP95Alert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.p95Ms).toBeNull();
    expect(result.alertFired).toBe(false);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});

describe("checkP95Alert — p95 below threshold", () => {
  it("returns ok and does not fire alert when p95 <= 25s", async () => {
    const cache = makeTimingCache(P95_THRESHOLD_MS - 1); // 24999ms
    const { env } = makeEnv(null, {
      "status:timing-cache": JSON.stringify(cache),
    });
    const sentry = makeSentry();

    const result = await checkP95Alert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.p95Ms).toBe(P95_THRESHOLD_MS - 1);
    expect(result.alertFired).toBe(false);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("returns ok when p95 is exactly the threshold", async () => {
    const cache = makeTimingCache(P95_THRESHOLD_MS); // exactly 25000ms
    const { env } = makeEnv(null, {
      "status:timing-cache": JSON.stringify(cache),
    });
    const sentry = makeSentry();

    const result = await checkP95Alert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.alertFired).toBe(false);
  });
});

describe("checkP95Alert — p95 above threshold", () => {
  it("fires Sentry alert and returns alert status when p95 > 25s", async () => {
    const cache = makeTimingCache(30_000); // 30s — over threshold
    const { env } = makeEnv(null, {
      "status:timing-cache": JSON.stringify(cache),
    });
    const sentry = makeSentry();

    const result = await checkP95Alert(env, sentry);

    expect(result.status).toBe("alert");
    expect(result.p95Ms).toBe(30_000);
    expect(result.alertFired).toBe(true);
    expect(sentry.captureMessage).toHaveBeenCalledOnce();

    const [msg, level, ctx] = sentry.captureMessage.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(msg).toContain("p95 generation time");
    expect(msg).toContain("30000ms");
    expect(level).toBe("error");
    expect(ctx.p95Ms).toBe(30_000);
    expect(ctx.thresholdMs).toBe(P95_THRESHOLD_MS);
  });

  it("alert message does not contain access_token", async () => {
    const cache = makeTimingCache(40_000);
    const { env } = makeEnv(null, {
      "status:timing-cache": JSON.stringify(cache),
    });
    const sentry = makeSentry();

    await checkP95Alert(env, sentry);

    const [msg, , ctx] = sentry.captureMessage.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(msg).not.toContain("access_token");
    expect(JSON.stringify(ctx)).not.toContain("access_token");
  });
});

describe("checkP95Alert — invalid KV cache", () => {
  it("returns error status when KV value is not valid JSON", async () => {
    const { env } = makeEnv(null, {
      "status:timing-cache": "not-valid-json",
    });
    const sentry = makeSentry();

    const result = await checkP95Alert(env, sentry);

    expect(result.status).toBe("error");
    expect(result.alertFired).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  });

  it("returns error status when KV.get throws", async () => {
    const kv = {
      get: vi.fn(async () => {
        throw new Error("KV unavailable");
      }),
      put: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
      getWithMetadata: vi.fn(),
    };
    const env: PerformanceMonitorEnv = {
      DB: makeDb() as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
      SENTRY_DSN: "https://test@sentry.io/0",
    };
    const sentry = makeSentry();

    const result = await checkP95Alert(env, sentry);

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("KV unavailable");
  });
});

// ---------------------------------------------------------------------------
// checkSuccessRateAlert
// ---------------------------------------------------------------------------

describe("checkSuccessRateAlert — no jobs in window", () => {
  it("returns ok with null successRatePct when no jobs exist", async () => {
    const { env } = makeEnv({ total: 0, success_count: 0 });
    const sentry = makeSentry();

    const result = await checkSuccessRateAlert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.successRatePct).toBeNull();
    expect(result.jobCount).toBe(0);
    expect(result.alertFired).toBe(false);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("returns ok when D1 row is null", async () => {
    const { env } = makeEnv(null);
    const sentry = makeSentry();

    const result = await checkSuccessRateAlert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.successRatePct).toBeNull();
  });
});

describe("checkSuccessRateAlert — success rate above threshold", () => {
  it("returns ok and does not fire alert when success rate >= 95%", async () => {
    const { env } = makeEnv({ total: 100, success_count: 97 });
    const sentry = makeSentry();

    const result = await checkSuccessRateAlert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.successRatePct).toBe(97);
    expect(result.jobCount).toBe(100);
    expect(result.alertFired).toBe(false);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("does not fire alert when success rate is exactly 95%", async () => {
    const { env } = makeEnv({ total: 100, success_count: 95 });
    const sentry = makeSentry();

    const result = await checkSuccessRateAlert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.successRatePct).toBe(SUCCESS_RATE_THRESHOLD_PCT);
    expect(result.alertFired).toBe(false);
  });
});

describe("checkSuccessRateAlert — success rate below threshold", () => {
  it("fires Sentry alert when success rate < 95%", async () => {
    const { env } = makeEnv({ total: 200, success_count: 180 }); // 90%
    const sentry = makeSentry();

    const result = await checkSuccessRateAlert(env, sentry);

    expect(result.status).toBe("alert");
    expect(result.successRatePct).toBe(90);
    expect(result.jobCount).toBe(200);
    expect(result.alertFired).toBe(true);
    expect(sentry.captureMessage).toHaveBeenCalledOnce();

    const [msg, level, ctx] = sentry.captureMessage.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(msg).toContain("success rate");
    expect(msg).toContain("90.00%");
    expect(level).toBe("error");
    expect(ctx.successRatePct).toBe(90);
    expect(ctx.thresholdPct).toBe(SUCCESS_RATE_THRESHOLD_PCT);
    expect(ctx.totalCount).toBe(200);
  });

  it("alert payload does not contain access_token", async () => {
    const { env } = makeEnv({ total: 100, success_count: 50 });
    const sentry = makeSentry();

    await checkSuccessRateAlert(env, sentry);

    const [msg, , ctx] = sentry.captureMessage.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(msg).not.toContain("access_token");
    expect(JSON.stringify(ctx)).not.toContain("access_token");
  });
});

describe("checkSuccessRateAlert — D1 error", () => {
  it("returns error status when D1 query throws", async () => {
    const failStmt = {
      first: vi.fn(async () => {
        throw new Error("D1 error");
      }),
      bind: vi.fn(function (this: typeof failStmt) {
        return this;
      }),
    };
    const db = { prepare: vi.fn(() => failStmt) };
    const kv = makeKv();
    const env: PerformanceMonitorEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
      SENTRY_DSN: "https://test@sentry.io/0",
    };
    const sentry = makeSentry();

    const result = await checkSuccessRateAlert(env, sentry);

    expect(result.status).toBe("error");
    expect(result.alertFired).toBe(false);
    expect(result.errorMessage).toContain("D1 error");
  });
});

// ---------------------------------------------------------------------------
// checkDLQDepthAlert
// ---------------------------------------------------------------------------

describe("checkDLQDepthAlert — depth below threshold", () => {
  it("returns ok when DLQ depth is 0", async () => {
    const { env } = makeEnv({ dlq_depth: 0 });
    const sentry = makeSentry();

    const result = await checkDLQDepthAlert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.dlqDepth).toBe(0);
    expect(result.alertFired).toBe(false);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("returns ok when DLQ depth is exactly the threshold", async () => {
    const { env } = makeEnv({ dlq_depth: DLQ_DEPTH_THRESHOLD }); // exactly 50
    const sentry = makeSentry();

    const result = await checkDLQDepthAlert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.alertFired).toBe(false);
  });

  it("returns ok when D1 row is null", async () => {
    const { env } = makeEnv(null);
    const sentry = makeSentry();

    const result = await checkDLQDepthAlert(env, sentry);

    expect(result.status).toBe("ok");
    expect(result.dlqDepth).toBe(0);
  });
});

describe("checkDLQDepthAlert — depth above threshold", () => {
  it("fires Sentry alert when DLQ depth > 50", async () => {
    const { env } = makeEnv({ dlq_depth: 75 });
    const sentry = makeSentry();

    const result = await checkDLQDepthAlert(env, sentry);

    expect(result.status).toBe("alert");
    expect(result.dlqDepth).toBe(75);
    expect(result.alertFired).toBe(true);
    expect(sentry.captureMessage).toHaveBeenCalledOnce();

    const [msg, level, ctx] = sentry.captureMessage.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(msg).toContain("DLQ depth");
    expect(msg).toContain("75");
    expect(level).toBe("error");
    expect(ctx.dlqDepth).toBe(75);
    expect(ctx.threshold).toBe(DLQ_DEPTH_THRESHOLD);
  });

  it("alert payload does not contain access_token", async () => {
    const { env } = makeEnv({ dlq_depth: 100 });
    const sentry = makeSentry();

    await checkDLQDepthAlert(env, sentry);

    const [msg, , ctx] = sentry.captureMessage.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(msg).not.toContain("access_token");
    expect(JSON.stringify(ctx)).not.toContain("access_token");
  });
});

describe("checkDLQDepthAlert — D1 error", () => {
  it("returns error status when D1 query throws", async () => {
    const failStmt = {
      first: vi.fn(async () => {
        throw new Error("D1 unavailable");
      }),
      bind: vi.fn(function (this: typeof failStmt) {
        return this;
      }),
    };
    const db = { prepare: vi.fn(() => failStmt) };
    const kv = makeKv();
    const env: PerformanceMonitorEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
      SENTRY_DSN: "https://test@sentry.io/0",
    };
    const sentry = makeSentry();

    const result = await checkDLQDepthAlert(env, sentry);

    expect(result.status).toBe("error");
    expect(result.alertFired).toBe(false);
    expect(result.errorMessage).toContain("D1 unavailable");
  });
});

// ---------------------------------------------------------------------------
// runPerformanceAlerts — orchestrator
// ---------------------------------------------------------------------------

describe("runPerformanceAlerts", () => {
  it("runs all three checks and returns a summary with runAt timestamp", async () => {
    const cache = makeTimingCache(5_000); // below p95 threshold

    // Two separate DB stmts for success-rate and DLQ checks
    let callCount = 0;
    const db = {
      prepare: vi.fn(() => {
        callCount++;
        const result: Record<string, unknown> = callCount === 1
          ? { total: 50, success_count: 49 }   // success-rate query
          : { dlq_depth: 5 };                   // DLQ depth query
        const stmt = {
          first: vi.fn(async () => result),
          all: vi.fn(async () => ({ results: [] })),
          run: vi.fn(async () => ({ success: true })),
          bind: vi.fn(function (this: typeof stmt) { return this; }),
        };
        return stmt;
      }),
    };

    const kv = makeKv({ "status:timing-cache": JSON.stringify(cache) });
    const env: PerformanceMonitorEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
      SENTRY_DSN: "https://test@sentry.io/0",
    };
    const sentry = makeSentry();

    const summary = await runPerformanceAlerts(env, sentry);

    expect(summary.p95).toBeDefined();
    expect(summary.successRate).toBeDefined();
    expect(summary.dlqDepth).toBeDefined();
    expect(typeof summary.runAt).toBe("string");
    expect(new Date(summary.runAt).getTime()).toBeGreaterThan(0);
  });

  it("a failure in one check does not prevent others from running", async () => {
    // KV will throw (p95 check will error), but DB is fine
    const kv = {
      get: vi.fn(async () => {
        throw new Error("KV error");
      }),
      put: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
      getWithMetadata: vi.fn(),
    };

    // Two separate DB stmts for success-rate and DLQ checks
    let dbCallCount = 0;
    const db = {
      prepare: vi.fn(() => {
        dbCallCount++;
        const result: Record<string, unknown> = dbCallCount === 1
          ? { total: 100, success_count: 98 }
          : { dlq_depth: 3 };
        const stmt = {
          first: vi.fn(async () => result),
          all: vi.fn(async () => ({ results: [] })),
          run: vi.fn(async () => ({ success: true })),
          bind: vi.fn(function (this: typeof stmt) { return this; }),
        };
        return stmt;
      }),
    };

    const env: PerformanceMonitorEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
      SENTRY_DSN: "https://test@sentry.io/0",
    };
    const sentry = makeSentry();

    const summary = await runPerformanceAlerts(env, sentry);

    // p95 check errored
    expect(summary.p95.status).toBe("error");
    // success-rate and DLQ checks still ran
    expect(summary.successRate.status).toBe("ok");
    expect(summary.dlqDepth.status).toBe("ok");
  });

  it("fires alert when all three thresholds are breached simultaneously", async () => {
    const cache = makeTimingCache(35_000); // p95 over 25s
    const kv = makeKv({ "status:timing-cache": JSON.stringify(cache) });

    let dbCallCount = 0;
    const db = {
      prepare: vi.fn(() => {
        dbCallCount++;
        const result: Record<string, unknown> = dbCallCount === 1
          ? { total: 100, success_count: 80 }  // 80% — below 95%
          : { dlq_depth: 99 };                  // over 50
        const stmt = {
          first: vi.fn(async () => result),
          all: vi.fn(async () => ({ results: [] })),
          run: vi.fn(async () => ({ success: true })),
          bind: vi.fn(function (this: typeof stmt) { return this; }),
        };
        return stmt;
      }),
    };

    const env: PerformanceMonitorEnv = {
      DB: db as unknown as D1Database,
      KV_STORE: kv as unknown as KVNamespace,
      SENTRY_DSN: "https://test@sentry.io/0",
    };
    const sentry = makeSentry();

    const summary = await runPerformanceAlerts(env, sentry);

    expect(summary.p95.alertFired).toBe(true);
    expect(summary.successRate.alertFired).toBe(true);
    expect(summary.dlqDepth.alertFired).toBe(true);
    // Sentry called once per alert
    expect(sentry.captureMessage).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// SLA threshold constants
// ---------------------------------------------------------------------------

describe("SLA threshold constants", () => {
  it("P95_THRESHOLD_MS is 25000", () => {
    expect(P95_THRESHOLD_MS).toBe(25_000);
  });

  it("SUCCESS_RATE_THRESHOLD_PCT is 95", () => {
    expect(SUCCESS_RATE_THRESHOLD_PCT).toBe(95);
  });

  it("DLQ_DEPTH_THRESHOLD is 50", () => {
    expect(DLQ_DEPTH_THRESHOLD).toBe(50);
  });
});
