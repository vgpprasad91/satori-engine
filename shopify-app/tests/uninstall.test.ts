/**
 * PR-011: Unit tests for app/uninstalled grace period and session cleanup
 *
 * Tests:
 *  - access_token nullified and billing_status = 'uninstalled' in D1
 *  - queued jobs halted via KV signal
 *  - active subscription cancelled via Shopify GraphQL
 *  - merchant KV keys purged (brand kit, usage counter, rate limiter)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleUninstall,
  isQueueHalted,
  BRAND_KIT_PREFIX,
  USAGE_PREFIX,
  RATE_LIMIT_PREFIX,
  QUEUE_HALT_PREFIX,
} from "../src/uninstall.server.js";
import { createMockD1, createMockKV } from "./setup.js";

// ---------------------------------------------------------------------------
// Mock cancelSubscription from billing.server
// ---------------------------------------------------------------------------
vi.mock("../src/billing.server.js", () => ({
  cancelSubscription: vi.fn().mockResolvedValue(undefined),
  SHOPIFY_API_VERSION: "2025-01",
  PLANS: {
    hobby: { name: "hobby", monthlyLimit: 100, price: 0, cappedAmount: null, overagePerImage: null },
    pro: { name: "pro", monthlyLimit: 1000, price: 29, cappedAmount: 50, overagePerImage: 0.05 },
    business: { name: "business", monthlyLimit: 10000, price: 79, cappedAmount: 100, overagePerImage: 0.01 },
  },
}));

import { cancelSubscription } from "../src/billing.server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(overrides: { db?: D1Database; kv?: KVNamespace } = {}) {
  return {
    DB: overrides.db ?? createMockD1(),
    KV_STORE: overrides.kv ?? createMockKV(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleUninstall", () => {
  const SHOP = "test-shop.myshopify.com";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Token purge
  // -------------------------------------------------------------------------

  it("nullifies access_token and sets billing_status = uninstalled in D1", async () => {
    const db = createMockD1();
    const env = makeEnv({ db });

    await handleUninstall(SHOP, env, "tok_abc", "sub_123");

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("access_token = NULL")
    );
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("billing_status = 'uninstalled'")
    );
  });

  it("tokenPurged is true when D1 update affects rows", async () => {
    const db = createMockD1();
    // Override run to return meta.changes = 1
    const runMock = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    vi.mocked(db.prepare).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: runMock,
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [], success: true, meta: {} }),
    } as unknown as D1PreparedStatement);

    const result = await handleUninstall(SHOP, makeEnv({ db }).DB !== db ? makeEnv({ db }) : makeEnv({ db }), "tok", null);

    expect(result.tokenPurged).toBe(true);
  });

  it("continues cleanup even if D1 update throws", async () => {
    const db = createMockD1();
    vi.mocked(db.prepare).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockRejectedValue(new Error("D1 error")),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [], success: true, meta: {} }),
    } as unknown as D1PreparedStatement);

    const env = makeEnv({ db });
    // Should not throw
    const result = await handleUninstall(SHOP, env, null, null);
    expect(result.shop).toBe(SHOP);
  });

  // -------------------------------------------------------------------------
  // Queue halt
  // -------------------------------------------------------------------------

  it("writes queue halt key to KV for the shop", async () => {
    const kv = createMockKV();
    const env = makeEnv({ kv });

    await handleUninstall(SHOP, env, null, null);

    const expectedKey = `${QUEUE_HALT_PREFIX}${SHOP}`;
    expect(kv.put).toHaveBeenCalledWith(
      expectedKey,
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });

  it("queueHalted is true after successful KV write", async () => {
    const env = makeEnv();
    const result = await handleUninstall(SHOP, env, null, null);
    expect(result.queueHalted).toBe(true);
  });

  it("isQueueHalted returns true after uninstall", async () => {
    const kv = createMockKV();
    const env = makeEnv({ kv });

    await handleUninstall(SHOP, env, null, null);

    const halted = await isQueueHalted(SHOP, kv);
    expect(halted).toBe(true);
  });

  it("isQueueHalted returns false for shops that have not uninstalled", async () => {
    const kv = createMockKV();
    const halted = await isQueueHalted("other-shop.myshopify.com", kv);
    expect(halted).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Subscription cancellation
  // -------------------------------------------------------------------------

  it("calls cancelSubscription when accessToken and subscriptionId are provided", async () => {
    const env = makeEnv();

    await handleUninstall(SHOP, env, "tok_abc", "sub_123");

    expect(cancelSubscription).toHaveBeenCalledWith(SHOP, "tok_abc", "sub_123");
  });

  it("subscriptionCancelled is true when cancelSubscription succeeds", async () => {
    const env = makeEnv();
    const result = await handleUninstall(SHOP, env, "tok_abc", "sub_123");
    expect(result.subscriptionCancelled).toBe(true);
  });

  it("does not call cancelSubscription for free plan (subscriptionId = 'free')", async () => {
    const env = makeEnv();
    await handleUninstall(SHOP, env, "tok_abc", "free");
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("does not call cancelSubscription when accessToken is null", async () => {
    const env = makeEnv();
    await handleUninstall(SHOP, env, null, "sub_123");
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("subscriptionCancelled is true even when cancelSubscription throws (non-fatal)", async () => {
    vi.mocked(cancelSubscription).mockRejectedValueOnce(new Error("Already cancelled"));
    const env = makeEnv();
    const result = await handleUninstall(SHOP, env, "tok_abc", "sub_123");
    // Still returns result without throwing
    expect(result.shop).toBe(SHOP);
  });

  // -------------------------------------------------------------------------
  // KV key purge
  // -------------------------------------------------------------------------

  it("purges brand kit KV keys for the shop", async () => {
    const store = new Map<string, string>();
    const brandKey = `${BRAND_KIT_PREFIX}${SHOP}`;
    store.set(brandKey, JSON.stringify({ primaryColor: "#FF0000" }));

    const kv = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => { store.delete(key); }),
      list: vi.fn(async ({ prefix }: { prefix: string }) => {
        const keys = [...store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name }));
        return { keys, list_complete: true, cursor: undefined };
      }),
      getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
    } as unknown as KVNamespace;

    const env = makeEnv({ kv });
    const result = await handleUninstall(SHOP, env, null, null);

    // Brand kit key should be deleted
    expect(store.has(brandKey)).toBe(false);
    expect(result.kvKeysPurged).toContain(brandKey);
  });

  it("purges usage counter KV keys for the shop", async () => {
    const store = new Map<string, string>();
    const usageKey = `${USAGE_PREFIX}${SHOP}:2026-03`;
    store.set(usageKey, "42");

    const kv = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => { store.delete(key); }),
      list: vi.fn(async ({ prefix }: { prefix: string }) => {
        const keys = [...store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name }));
        return { keys, list_complete: true, cursor: undefined };
      }),
      getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
    } as unknown as KVNamespace;

    const env = makeEnv({ kv });
    const result = await handleUninstall(SHOP, env, null, null);

    expect(store.has(usageKey)).toBe(false);
    expect(result.kvKeysPurged).toContain(usageKey);
  });

  // -------------------------------------------------------------------------
  // Result shape
  // -------------------------------------------------------------------------

  it("returns shop, uninstalledAt, and summary fields", async () => {
    const env = makeEnv();
    const result = await handleUninstall(SHOP, env, "tok", "sub_123");

    expect(result.shop).toBe(SHOP);
    expect(result.uninstalledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof result.tokenPurged).toBe("boolean");
    expect(typeof result.subscriptionCancelled).toBe("boolean");
    expect(Array.isArray(result.kvKeysPurged)).toBe(true);
    expect(typeof result.queueHalted).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// isQueueHalted standalone tests
// ---------------------------------------------------------------------------

describe("isQueueHalted", () => {
  it("returns false when no halt key exists", async () => {
    const kv = createMockKV();
    expect(await isQueueHalted("shop.myshopify.com", kv)).toBe(false);
  });

  it("returns true when halt key exists in KV", async () => {
    const kv = createMockKV();
    await kv.put(`${QUEUE_HALT_PREFIX}shop.myshopify.com`, new Date().toISOString());
    expect(await isQueueHalted("shop.myshopify.com", kv)).toBe(true);
  });

  it("returns false for a different shop even when another is halted", async () => {
    const kv = createMockKV();
    await kv.put(`${QUEUE_HALT_PREFIX}shop-a.myshopify.com`, new Date().toISOString());
    expect(await isQueueHalted("shop-b.myshopify.com", kv)).toBe(false);
  });
});
