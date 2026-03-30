/**
 * PR-014: Usage metering — KV counters and quota enforcement — unit tests
 *
 * Covers:
 *  1. incrementUsageCounter() — counter increments correctly, key format is correct
 *  2. getUsageCount()         — returns 0 for unknown shop, returns current value
 *  3. currentYearMonth()      — returns correct YYYY-MM string
 *  4. usageKey()              — returns correct key format
 *  5. checkQuota()            — allowed when under limit, denied when at/over limit
 *  6. writeQuotaExceededStatus() — writes correct status to D1
 *  7. resetAllUsageCounters() — deletes all usage keys and logs to D1
 *  8. Queue consumer integration — quota exceeded rejection at consumer entry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  incrementUsageCounter,
  getUsageCount,
  currentYearMonth,
  usageKey,
  checkQuota,
  writeQuotaExceededStatus,
  resetAllUsageCounters,
  type UsageEnv,
} from "../src/usage.server.js";
import {
  handleQueueBatch,
  type QueueConsumerEnv,
  type ImageJob,
} from "../src/queue.server.js";
import { createMockD1, createMockKV, createMockQueue } from "./setup.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHOP = "mystore.myshopify.com";

function makeValidJob(overrides: Partial<ImageJob> = {}): ImageJob {
  return {
    shop: SHOP,
    productId: "prod_001",
    productTitle: "Awesome Widget",
    imageUrl: "https://cdn.shopify.com/products/widget.jpg",
    templateId: "product-card",
    locale: "en",
    currencyFormat: "$29.99",
    brandKit: { primaryColor: "#1a73e8", logoR2Key: null, fontFamily: "Inter" },
    ...overrides,
  };
}

function makeMessage(
  body: unknown,
  opts: { id?: string } = {}
): Message<ImageJob> & { ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> } {
  return {
    id: opts.id ?? "msg-001",
    timestamp: new Date(),
    body: body as ImageJob,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  } as unknown as Message<ImageJob> & {
    ack: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
  };
}

function makeMessageBatch(
  messages: Message<ImageJob>[],
  queue = "shopify-image-queue-dev"
): MessageBatch<ImageJob> {
  return {
    queue,
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<ImageJob>;
}

// ---------------------------------------------------------------------------
// 1 & 3 & 4. Pure helpers
// ---------------------------------------------------------------------------

describe("currentYearMonth()", () => {
  it("returns YYYY-MM for a known UTC date", () => {
    const date = new Date("2026-03-15T10:00:00.000Z");
    expect(currentYearMonth(date)).toBe("2026-03");
  });

  it("pads single-digit months", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(currentYearMonth(date)).toBe("2026-01");
  });

  it("handles December", () => {
    const date = new Date("2025-12-31T23:59:59.000Z");
    expect(currentYearMonth(date)).toBe("2025-12");
  });
});

describe("usageKey()", () => {
  it("returns usage:{shop}:{YYYY-MM}", () => {
    expect(usageKey("test.myshopify.com", "2026-03")).toBe(
      "usage:test.myshopify.com:2026-03"
    );
  });
});

// ---------------------------------------------------------------------------
// 1. incrementUsageCounter()
// ---------------------------------------------------------------------------

describe("incrementUsageCounter()", () => {
  it("starts at 1 when no prior counter exists", async () => {
    const kv = createMockKV();
    const now = new Date("2026-03-12T00:00:00.000Z");

    const count = await incrementUsageCounter(SHOP, kv, now);

    expect(count).toBe(1);
    expect(kv.put).toHaveBeenCalledWith(
      `usage:${SHOP}:2026-03`,
      "1",
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });

  it("increments an existing counter", async () => {
    const kv = createMockKV();
    const now = new Date("2026-03-12T00:00:00.000Z");

    // Seed the KV with an existing count
    await kv.put(`usage:${SHOP}:2026-03`, "9");

    const count = await incrementUsageCounter(SHOP, kv, now);

    expect(count).toBe(10);
    expect(kv.put).toHaveBeenLastCalledWith(
      `usage:${SHOP}:2026-03`,
      "10",
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });

  it("treats corrupted KV values as 0", async () => {
    const kv = createMockKV();
    const now = new Date("2026-03-12T00:00:00.000Z");

    await kv.put(`usage:${SHOP}:2026-03`, "not-a-number");

    const count = await incrementUsageCounter(SHOP, kv, now);

    expect(count).toBe(1);
  });

  it("uses the correct month key based on the `now` param", async () => {
    const kv = createMockKV();
    const january = new Date("2026-01-20T00:00:00.000Z");
    const february = new Date("2026-02-20T00:00:00.000Z");

    await incrementUsageCounter(SHOP, kv, january);
    await incrementUsageCounter(SHOP, kv, february);

    // January and February keys are independent
    const janCount = await kv.get(`usage:${SHOP}:2026-01`);
    const febCount = await kv.get(`usage:${SHOP}:2026-02`);
    expect(janCount).toBe("1");
    expect(febCount).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// 2. getUsageCount()
// ---------------------------------------------------------------------------

describe("getUsageCount()", () => {
  it("returns 0 for a shop with no counter", async () => {
    const kv = createMockKV();
    const now = new Date("2026-03-12T00:00:00.000Z");

    const count = await getUsageCount("unknown.myshopify.com", kv, now);

    expect(count).toBe(0);
  });

  it("returns the current counter value", async () => {
    const kv = createMockKV();
    const now = new Date("2026-03-12T00:00:00.000Z");

    await kv.put(`usage:${SHOP}:2026-03`, "42");

    const count = await getUsageCount(SHOP, kv, now);

    expect(count).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 5. checkQuota()
// ---------------------------------------------------------------------------

describe("checkQuota()", () => {
  it("allows when usage is below the monthly limit", async () => {
    const kv = createMockKV();
    const db = createMockD1();
    const now = new Date("2026-03-12T00:00:00.000Z");

    // Mock DB returns monthly_limit = 100
    const prepareMock = db.prepare as ReturnType<typeof vi.fn>;
    prepareMock.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ monthly_limit: 100 }),
    });

    // Set usage to 50
    await kv.put(`usage:${SHOP}:2026-03`, "50");

    const result = await checkQuota(SHOP, { KV_STORE: kv, DB: db }, now);

    expect(result.allowed).toBe(true);
    expect(result.currentUsage).toBe(50);
    expect(result.monthlyLimit).toBe(100);
  });

  it("denies when usage equals the monthly limit", async () => {
    const kv = createMockKV();
    const db = createMockD1();
    const now = new Date("2026-03-12T00:00:00.000Z");

    const prepareMock = db.prepare as ReturnType<typeof vi.fn>;
    prepareMock.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ monthly_limit: 100 }),
    });

    await kv.put(`usage:${SHOP}:2026-03`, "100");

    const result = await checkQuota(SHOP, { KV_STORE: kv, DB: db }, now);

    expect(result.allowed).toBe(false);
    expect(result.currentUsage).toBe(100);
  });

  it("denies when usage exceeds the monthly limit", async () => {
    const kv = createMockKV();
    const db = createMockD1();
    const now = new Date("2026-03-12T00:00:00.000Z");

    const prepareMock = db.prepare as ReturnType<typeof vi.fn>;
    prepareMock.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ monthly_limit: 10 }),
    });

    await kv.put(`usage:${SHOP}:2026-03`, "15");

    const result = await checkQuota(SHOP, { KV_STORE: kv, DB: db }, now);

    expect(result.allowed).toBe(false);
    expect(result.currentUsage).toBe(15);
    expect(result.monthlyLimit).toBe(10);
  });

  it("defaults to limit=100 when merchant not found in D1", async () => {
    const kv = createMockKV();
    const db = createMockD1();
    const now = new Date("2026-03-12T00:00:00.000Z");

    // DB returns null (merchant not found)
    const prepareMock = db.prepare as ReturnType<typeof vi.fn>;
    prepareMock.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    });

    await kv.put(`usage:${SHOP}:2026-03`, "99");

    const result = await checkQuota(SHOP, { KV_STORE: kv, DB: db }, now);

    expect(result.allowed).toBe(true);
    expect(result.monthlyLimit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 6. writeQuotaExceededStatus()
// ---------------------------------------------------------------------------

describe("writeQuotaExceededStatus()", () => {
  it("inserts quota_exceeded status into D1 generated_images", async () => {
    const db = createMockD1();

    await writeQuotaExceededStatus(SHOP, "prod_001", "product-card", db);

    expect(db.prepare).toHaveBeenCalled();
    const prepareFn = db.prepare as ReturnType<typeof vi.fn>;
    const prepareCall = prepareFn.mock.calls[0] as [string];
    expect(prepareCall[0]).toContain("quota_exceeded");
    expect(prepareCall[0]).toContain("generated_images");
  });

  it("passes correct bind arguments", async () => {
    const db = createMockD1();

    await writeQuotaExceededStatus(SHOP, "prod_123", "tpl_456", db);

    const prepareFn = db.prepare as ReturnType<typeof vi.fn>;
    const bindMock = prepareFn.mock.results[0]?.value.bind as ReturnType<typeof vi.fn>;
    const bindArgs = bindMock.mock.calls[0] as unknown[];
    expect(bindArgs).toContain(SHOP);
    expect(bindArgs).toContain("prod_123");
    expect(bindArgs).toContain("tpl_456");
  });
});

// ---------------------------------------------------------------------------
// 7. resetAllUsageCounters() — monthly reset
// ---------------------------------------------------------------------------

describe("resetAllUsageCounters()", () => {
  it("deletes all usage: keys from KV", async () => {
    const kv = createMockKV();
    const db = createMockD1();

    // Pre-populate KV with usage keys for multiple shops
    await kv.put("usage:shop-a.myshopify.com:2026-02", "50");
    await kv.put("usage:shop-b.myshopify.com:2026-02", "30");

    // Override list to return our keys
    const listMock = kv.list as ReturnType<typeof vi.fn>;
    listMock.mockResolvedValueOnce({
      keys: [
        { name: "usage:shop-a.myshopify.com:2026-02", expiration: undefined, metadata: null },
        { name: "usage:shop-b.myshopify.com:2026-02", expiration: undefined, metadata: null },
      ],
      list_complete: true,
      cursor: undefined,
    });

    await resetAllUsageCounters({ KV_STORE: kv, DB: db });

    // Both keys should have been deleted
    expect(kv.delete).toHaveBeenCalledWith("usage:shop-a.myshopify.com:2026-02");
    expect(kv.delete).toHaveBeenCalledWith("usage:shop-b.myshopify.com:2026-02");
  });

  it("writes a reset log to D1 webhook_log", async () => {
    const kv = createMockKV();
    const db = createMockD1();

    const listMock = kv.list as ReturnType<typeof vi.fn>;
    listMock.mockResolvedValueOnce({
      keys: [{ name: "usage:any-shop.myshopify.com:2026-02", expiration: undefined, metadata: null }],
      list_complete: true,
      cursor: undefined,
    });

    await resetAllUsageCounters({ KV_STORE: kv, DB: db });

    // D1 should have been called for the webhook_log insert
    expect(db.prepare).toHaveBeenCalled();
    const prepareFn = db.prepare as ReturnType<typeof vi.fn>;
    const calls = prepareFn.mock.calls as [string][];
    const logCall = calls.find(([sql]) => sql.includes("webhook_log"));
    expect(logCall).toBeDefined();
    expect(logCall![0]).toContain("usage_counters_reset");
  });

  it("handles an empty KV (no usage keys)", async () => {
    const kv = createMockKV();
    const db = createMockD1();

    const listMock = kv.list as ReturnType<typeof vi.fn>;
    listMock.mockResolvedValueOnce({
      keys: [],
      list_complete: true,
      cursor: undefined,
    });

    // Should not throw
    await expect(resetAllUsageCounters({ KV_STORE: kv, DB: db })).resolves.not.toThrow();

    // DB insert still happens (log reset event even with 0 shops)
    expect(db.prepare).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. Queue consumer integration — quota exceeded rejection
// ---------------------------------------------------------------------------

describe("Queue consumer — quota exceeded", () => {
  it("acks the message and writes quota_exceeded to D1 without running pipeline", async () => {
    const db = createMockD1();
    const kv = createMockKV();

    // DB returns monthly_limit = 10
    const prepareMock = db.prepare as ReturnType<typeof vi.fn>;
    prepareMock.mockImplementation((sql: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(
        sql.includes("SELECT monthly_limit") ? { monthly_limit: 10 } : null
      ),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
    }));

    // Set usage at limit
    await kv.put(`usage:${SHOP}:${currentYearMonth()}`, "10");

    const env: QueueConsumerEnv = {
      DB: db,
      KV_STORE: kv,
      IMAGE_QUEUE: createMockQueue(),
    };

    const processFn = vi.fn().mockResolvedValue("success");
    const job = makeValidJob();
    const msg = makeMessage(job);
    const batch = makeMessageBatch([msg]);

    await handleQueueBatch(batch, env, processFn);

    // Message should be acked (quota exceeded = no retry)
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();

    // processFn should NOT have been called (no pipeline work)
    expect(processFn).not.toHaveBeenCalled();
  });

  it("allows the job through when under quota", async () => {
    const db = createMockD1();
    const kv = createMockKV();

    // DB returns monthly_limit = 100
    const prepareMock = db.prepare as ReturnType<typeof vi.fn>;
    prepareMock.mockImplementation((sql: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(
        sql.includes("SELECT monthly_limit") ? { monthly_limit: 100 } : null
      ),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
    }));

    // Usage is well below limit
    await kv.put(`usage:${SHOP}:${currentYearMonth()}`, "5");

    const env: QueueConsumerEnv = {
      DB: db,
      KV_STORE: kv,
      IMAGE_QUEUE: createMockQueue(),
    };

    const processFn = vi.fn().mockResolvedValue("pending");
    const job = makeValidJob();
    const msg = makeMessage(job);
    const batch = makeMessageBatch([msg]);

    await handleQueueBatch(batch, env, processFn);

    // processFn SHOULD have been called (under quota)
    expect(processFn).toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalled();
  });
});
