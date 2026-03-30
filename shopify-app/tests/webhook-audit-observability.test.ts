/**
 * PR-038: Webhook audit Analytics Engine observability enhancement
 *
 * Tests:
 *  - emitWebhookAuditMetric emits correct AE data point
 *  - storeWebhookHealthSnapshot writes correct KV entry
 *  - runWebhookAuditCron emits AE data points per merchant
 *  - runWebhookAuditCron stores KV health snapshots
 *  - runWebhookAuditCron fires Sentry alert when >3 shops fail
 *  - runWebhookAuditCron does NOT fire Sentry alert when ≤3 shops fail
 *  - /internal/metrics surfaces webhookHealth from KV
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  emitWebhookAuditMetric,
  storeWebhookHealthSnapshot,
  runWebhookAuditCron,
  REQUIRED_WEBHOOK_TOPICS,
  type WebhookHealthSnapshot,
  type WebhookRegistrationEnv,
} from "../src/webhook-registration.server.js";
import { handleInternalMetrics } from "../src/analytics.server.js";
import type { AnalyticsEngineDataset } from "../src/analytics.server.js";
import type { SentryClient } from "../src/sentry.server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockAE(): { ae: AnalyticsEngineDataset; calls: unknown[] } {
  const calls: unknown[] = [];
  const ae: AnalyticsEngineDataset = {
    writeDataPoint: vi.fn((evt) => {
      calls.push(evt);
    }),
  };
  return { ae, calls };
}

function makeMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    list: vi.fn(async (opts?: { prefix?: string }) => {
      const prefix = opts?.prefix ?? "";
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name, expiration: undefined, metadata: null }));
      return { keys, list_complete: true, cursor: "" };
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  } as unknown as KVNamespace;
}

function makeMockSentry(): { sentry: SentryClient; messages: string[] } {
  const messages: string[] = [];
  const sentry: SentryClient = {
    captureException: vi.fn(() => "evt-id"),
    captureMessage: vi.fn((msg: string) => {
      messages.push(msg);
      return "msg-id";
    }),
    addBreadcrumb: vi.fn(),
    withScope: vi.fn((cb) =>
      cb({
        setTag: vi.fn(),
        setExtra: vi.fn(),
        setUser: vi.fn(),
      })
    ),
    flush: vi.fn(async () => true),
  };
  return { sentry, messages };
}

function makeMockD1(rows: unknown[] = []): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: rows }),
      first: vi.fn().mockResolvedValue(null),
    }),
    batch: vi.fn().mockResolvedValue([]),
    exec: vi.fn().mockResolvedValue({ count: 0 }),
    dump: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as D1Database;
}

/** Builds a successful Shopify webhook list response (all topics registered) */
function gqlAllRegistered() {
  return {
    ok: true,
    json: async () => ({
      data: {
        webhookSubscriptions: {
          edges: REQUIRED_WEBHOOK_TOPICS.map((topic, i) => ({
            node: {
              id: `gid://shopify/WebhookSubscription/${i}`,
              topic,
              endpoint: {
                __typename: "WebhookHttpEndpoint",
                callbackUrl: `https://myapp.example.com/webhooks/${i}`,
              },
              format: "JSON",
            },
          })),
        },
      },
    }),
  } as unknown as Response;
}

/** Builds a Shopify response with NO webhooks registered */
function gqlNoneRegistered() {
  return {
    ok: true,
    json: async () => ({
      data: {
        webhookSubscriptions: { edges: [] },
      },
    }),
  } as unknown as Response;
}

/** Builds a successful re-registration response */
function gqlReregisterSuccess(callCount: number) {
  return {
    ok: true,
    json: async () => ({
      data: {
        webhookSubscriptionCreate: {
          webhookSubscription: {
            id: `gid://shopify/WebhookSubscription/${callCount}`,
            topic: "PRODUCTS_CREATE",
          },
          userErrors: [],
        },
      },
    }),
  } as unknown as Response;
}

/** Builds a re-registration failure response */
function gqlReregisterFail() {
  return {
    ok: false,
    status: 503,
    text: async () => "Service Unavailable",
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// emitWebhookAuditMetric
// ---------------------------------------------------------------------------

describe("emitWebhookAuditMetric", () => {
  it("writes the correct data point shape for a successful audit", () => {
    const { ae, calls } = makeMockAE();

    emitWebhookAuditMetric(ae, "shop.myshopify.com", 2, 2, true);

    expect(calls).toHaveLength(1);
    const dp = calls[0] as {
      indexes: string[];
      blobs: string[];
      doubles: number[];
    };
    expect(dp.indexes).toEqual(["shop.myshopify.com"]);
    expect(dp.blobs).toEqual(["shop.myshopify.com", "true"]);
    expect(dp.doubles).toEqual([2, 2, 1]);
  });

  it("writes audit_success=false when audit failed", () => {
    const { ae, calls } = makeMockAE();

    emitWebhookAuditMetric(ae, "shop.myshopify.com", 3, 0, false);

    const dp = calls[0] as { blobs: string[]; doubles: number[] };
    expect(dp.blobs[1]).toBe("false");
    expect(dp.doubles[2]).toBe(0);
  });

  it("does not throw when writeDataPoint throws", () => {
    const ae: AnalyticsEngineDataset = {
      writeDataPoint: vi.fn(() => {
        throw new Error("AE error");
      }),
    };
    expect(() =>
      emitWebhookAuditMetric(ae, "shop.myshopify.com", 0, 0, true)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// storeWebhookHealthSnapshot
// ---------------------------------------------------------------------------

describe("storeWebhookHealthSnapshot", () => {
  it("stores the snapshot as JSON with 48h TTL", async () => {
    const kv = makeMockKV();
    const snapshot: WebhookHealthSnapshot = {
      shop: "shop.myshopify.com",
      missingCount: 1,
      reregisteredCount: 1,
      auditSuccess: true,
      lastAuditAt: "2026-03-12T09:00:00.000Z",
    };

    await storeWebhookHealthSnapshot(kv, snapshot);

    expect(kv.put).toHaveBeenCalledWith(
      "webhook-health:shop.myshopify.com",
      JSON.stringify(snapshot),
      { expirationTtl: 60 * 60 * 48 }
    );
  });

  it("does not throw when KV put fails", async () => {
    const kv = makeMockKV();
    (kv.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("KV error")
    );

    await expect(
      storeWebhookHealthSnapshot(kv, {
        shop: "shop.myshopify.com",
        missingCount: 0,
        reregisteredCount: 0,
        auditSuccess: true,
        lastAuditAt: "2026-03-12T09:00:00.000Z",
      })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runWebhookAuditCron — Analytics Engine integration
// ---------------------------------------------------------------------------

describe("runWebhookAuditCron — Analytics Engine emission", () => {
  it("emits one AE data point per merchant when AE_METRICS provided", async () => {
    const merchants = [
      { shop: "shop1.myshopify.com", access_token: "tok1" },
      { shop: "shop2.myshopify.com", access_token: "tok2" },
    ];
    const { ae, calls } = makeMockAE();

    global.fetch = vi.fn().mockResolvedValue(gqlAllRegistered());

    await runWebhookAuditCron({
      DB: makeMockD1(merchants),
      APP_URL: "https://myapp.example.com",
      AE_METRICS: ae,
    });

    expect(calls).toHaveLength(merchants.length);
  });

  it("emits auditSuccess=true when all webhooks already registered", async () => {
    const { ae, calls } = makeMockAE();
    global.fetch = vi.fn().mockResolvedValue(gqlAllRegistered());

    await runWebhookAuditCron({
      DB: makeMockD1([{ shop: "s.myshopify.com", access_token: "t" }]),
      APP_URL: "https://app.example.com",
      AE_METRICS: ae,
    });

    const dp = calls[0] as { blobs: string[]; doubles: number[] };
    expect(dp.blobs[1]).toBe("true");
    expect(dp.doubles[2]).toBe(1);
    expect(dp.doubles[0]).toBe(0); // missingCount
    expect(dp.doubles[1]).toBe(0); // reregisteredCount
  });

  it("does not throw when AE_METRICS is absent", async () => {
    global.fetch = vi.fn().mockResolvedValue(gqlAllRegistered());

    await expect(
      runWebhookAuditCron({
        DB: makeMockD1([{ shop: "s.myshopify.com", access_token: "t" }]),
        APP_URL: "https://app.example.com",
      })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runWebhookAuditCron — KV health snapshot storage
// ---------------------------------------------------------------------------

describe("runWebhookAuditCron — KV health snapshots", () => {
  it("stores a health snapshot for each merchant", async () => {
    const merchants = [
      { shop: "s1.myshopify.com", access_token: "t1" },
      { shop: "s2.myshopify.com", access_token: "t2" },
    ];
    const kv = makeMockKV();
    global.fetch = vi.fn().mockResolvedValue(gqlAllRegistered());

    await runWebhookAuditCron({
      DB: makeMockD1(merchants),
      APP_URL: "https://app.example.com",
      KV_STORE: kv,
    });

    expect(kv.put).toHaveBeenCalledTimes(merchants.length);
    expect(kv.put).toHaveBeenCalledWith(
      "webhook-health:s1.myshopify.com",
      expect.any(String),
      { expirationTtl: 60 * 60 * 48 }
    );
    expect(kv.put).toHaveBeenCalledWith(
      "webhook-health:s2.myshopify.com",
      expect.any(String),
      { expirationTtl: 60 * 60 * 48 }
    );
  });

  it("stores auditSuccess=false when re-registration fails", async () => {
    const kv = makeMockKV();
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(gqlNoneRegistered());
      return Promise.resolve(gqlReregisterFail());
    });

    await runWebhookAuditCron({
      DB: makeMockD1([{ shop: "shop.myshopify.com", access_token: "tok" }]),
      APP_URL: "https://app.example.com",
      KV_STORE: kv,
    });

    expect(kv.put).toHaveBeenCalledTimes(1);
    const storedArg = ((kv.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "{}") as string;
    const parsed = JSON.parse(storedArg) as WebhookHealthSnapshot;
    expect(parsed.auditSuccess).toBe(false);
    expect(parsed.missingCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// runWebhookAuditCron — Sentry alerts
// ---------------------------------------------------------------------------

describe("runWebhookAuditCron — Sentry alerts", () => {
  function makeMerchantsWithFailures(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      shop: `shop${i}.myshopify.com`,
      access_token: `tok${i}`,
    }));
  }

  it("fires Sentry captureMessage when >3 shops have re-registration failures", async () => {
    const { sentry, messages } = makeMockSentry();
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      // Every list call returns no webhooks; every register call fails
      if (callCount % 2 === 1) return Promise.resolve(gqlNoneRegistered());
      return Promise.resolve(gqlReregisterFail());
    });

    await runWebhookAuditCron({
      DB: makeMockD1(makeMerchantsWithFailures(4)),
      APP_URL: "https://app.example.com",
      SENTRY: sentry,
    });

    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(messages[0]).toContain("4 shops");
  });

  it("does NOT fire Sentry when exactly 3 shops fail (threshold is >3)", async () => {
    const { sentry } = makeMockSentry();
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 1) return Promise.resolve(gqlNoneRegistered());
      return Promise.resolve(gqlReregisterFail());
    });

    await runWebhookAuditCron({
      DB: makeMockD1(makeMerchantsWithFailures(3)),
      APP_URL: "https://app.example.com",
      SENTRY: sentry,
    });

    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("does NOT fire Sentry when all shops succeed", async () => {
    const { sentry } = makeMockSentry();
    global.fetch = vi.fn().mockResolvedValue(gqlAllRegistered());

    await runWebhookAuditCron({
      DB: makeMockD1(makeMerchantsWithFailures(5)),
      APP_URL: "https://app.example.com",
      SENTRY: sentry,
    });

    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("does not throw when SENTRY is absent", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 1) return Promise.resolve(gqlNoneRegistered());
      return Promise.resolve(gqlReregisterFail());
    });

    await expect(
      runWebhookAuditCron({
        DB: makeMockD1(makeMerchantsWithFailures(5)),
        APP_URL: "https://app.example.com",
      })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// /internal/metrics — webhookHealth surfacing
// ---------------------------------------------------------------------------

describe("handleInternalMetrics — webhookHealth", () => {
  function makeMetricsEnv(
    kv: KVNamespace,
    db?: D1Database
  ): { DB: D1Database; KV_STORE: KVNamespace; INTERNAL_API_KEY: string } {
    return {
      DB: db ?? makeMockD1([]),
      KV_STORE: kv,
      INTERNAL_API_KEY: "test-key",
    };
  }

  it("returns webhookHealth entries from KV", async () => {
    const kv = makeMockKV();
    const snapshot: WebhookHealthSnapshot = {
      shop: "shop.myshopify.com",
      missingCount: 0,
      reregisteredCount: 0,
      auditSuccess: true,
      lastAuditAt: "2026-03-12T09:00:00.000Z",
    };
    await storeWebhookHealthSnapshot(kv, snapshot);

    const req = new Request("https://example.com/internal/metrics", {
      headers: { "X-Internal-Api-Key": "test-key" },
    });

    const res = await handleInternalMetrics(req, makeMetricsEnv(kv));
    const body = (await res.json()) as {
      webhookHealth: WebhookHealthSnapshot[];
    };

    expect(res.status).toBe(200);
    expect(body.webhookHealth).toHaveLength(1);
    expect(body.webhookHealth[0]!.shop).toBe("shop.myshopify.com");
    expect(body.webhookHealth[0]!.auditSuccess).toBe(true);
  });

  it("returns empty webhookHealth when no KV entries exist", async () => {
    const kv = makeMockKV();

    const req = new Request("https://example.com/internal/metrics", {
      headers: { "X-Internal-Api-Key": "test-key" },
    });

    const res = await handleInternalMetrics(req, makeMetricsEnv(kv));
    const body = (await res.json()) as { webhookHealth: unknown[] };

    expect(body.webhookHealth).toEqual([]);
  });

  it("includes unhealthy shops in webhookHealth", async () => {
    const kv = makeMockKV();
    await storeWebhookHealthSnapshot(kv, {
      shop: "bad.myshopify.com",
      missingCount: 3,
      reregisteredCount: 0,
      auditSuccess: false,
      lastAuditAt: "2026-03-12T09:00:00.000Z",
    });

    const req = new Request("https://example.com/internal/metrics", {
      headers: { "X-Internal-Api-Key": "test-key" },
    });

    const res = await handleInternalMetrics(req, makeMetricsEnv(kv));
    const body = (await res.json()) as {
      webhookHealth: WebhookHealthSnapshot[];
    };

    expect(body.webhookHealth[0]!.auditSuccess).toBe(false);
    expect(body.webhookHealth[0]!.missingCount).toBe(3);
  });

  it("returns 403 for missing API key", async () => {
    const kv = makeMockKV();
    const req = new Request("https://example.com/internal/metrics");
    const res = await handleInternalMetrics(req, makeMetricsEnv(kv));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// AE data point doubles ordering
// ---------------------------------------------------------------------------

describe("emitWebhookAuditMetric — doubles ordering", () => {
  it("doubles are [missingCount, reregisteredCount, auditSuccessNumeric]", () => {
    const { ae, calls } = makeMockAE();

    emitWebhookAuditMetric(ae, "shop.myshopify.com", 5, 3, false);

    const dp = calls[0] as { doubles: number[] };
    expect(dp.doubles[0]).toBe(5); // missingCount
    expect(dp.doubles[1]).toBe(3); // reregisteredCount
    expect(dp.doubles[2]).toBe(0); // auditSuccessNumeric (false → 0)
  });
});
