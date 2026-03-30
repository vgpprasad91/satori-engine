/**
 * PR-019: Dead letter queue handler and failure surfacing — unit tests
 *
 * Covers:
 *  1. categoriseError() — maps raw strings to typed ErrorCategory values
 *  2. writeDLQStatus()  — writes correct status+category to D1
 *  3. handleDLQBatch()  — writes correct status per error category, acks all messages
 *  4. handleDLQBatch()  — schema-invalid messages are acked without DB write
 *  5. reQueueJob()      — re-enqueues with a fresh idempotency key and returns 202-style result
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  categoriseError,
  writeDLQStatus,
  handleDLQBatch,
  reQueueJob,
  ERROR_CATEGORIES,
  type ErrorCategory,
  type DLQEnv,
} from "../src/dlq.server.js";
import type { ImageJob } from "../src/queue.server.js";
import { createMockD1, createMockKV, createMockQueue } from "./setup.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeValidJob(overrides: Partial<ImageJob> = {}): ImageJob {
  return {
    shop: "mystore.myshopify.com",
    productId: "prod_001",
    productTitle: "Test Widget",
    imageUrl: "https://cdn.shopify.com/products/widget.jpg",
    templateId: "product-card",
    locale: "en",
    currencyFormat: "$29.99",
    brandKit: {
      primaryColor: "#1a73e8",
      logoR2Key: null,
      fontFamily: "Inter",
    },
    ...overrides,
  };
}

function makeMessage(body: unknown, overrides: Partial<{ id: string; attempts: number }> = {}) {
  return {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date(),
    attempts: overrides.attempts ?? 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function makeBatch(messages: ReturnType<typeof makeMessage>[], queue = "shopify-image-queue-dlq") {
  return {
    queue,
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<ImageJob>;
}

function makeEnv(overrides: Partial<DLQEnv> = {}): DLQEnv {
  return {
    DB: createMockD1(),
    KV_STORE: createMockKV(),
    IMAGE_QUEUE: createMockQueue() as Queue<ImageJob>,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. categoriseError()
// ---------------------------------------------------------------------------

describe("categoriseError()", () => {
  const cases: [string | null | undefined, ErrorCategory][] = [
    ["quota_exceeded", "quota_exceeded"],
    ["quota exceeded on shop", "quota_exceeded"],
    ["timed_out", "timed_out"],
    ["Processing exceeded 30-second timeout", "timed_out"],
    ["timed out after 30s", "timed_out"],
    ["quality_gate failure", "quality_gate"],
    ["quality gate: face detected", "quality_gate"],
    ["bg_removal_failed", "bg_removal_failed"],
    ["background removal confidence below threshold", "bg_removal_failed"],
    ["bg removal error", "bg_removal_failed"],
    ["renderer_timeout", "renderer_timeout"],
    ["renderer timeout: satori took too long", "renderer_timeout"],
    ["satori service binding error", "renderer_timeout"],
    ["compositing_failed", "compositing_failed"],
    ["compositing failed: canvas error", "compositing_failed"],
    ["canvas API not available", "compositing_failed"],
    ["some unknown error message", "unknown_error"],
    [null, "unknown_error"],
    [undefined, "unknown_error"],
    ["", "unknown_error"],
  ];

  it.each(cases)("maps %j → %s", (input, expected) => {
    expect(categoriseError(input)).toBe(expected);
  });

  it("covers all ERROR_CATEGORIES via test table", () => {
    const coveredCategories = new Set(cases.map(([, cat]) => cat));
    for (const cat of ERROR_CATEGORIES) {
      expect(coveredCategories.has(cat)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. writeDLQStatus()
// ---------------------------------------------------------------------------

describe("writeDLQStatus()", () => {
  it("calls D1 prepare with failed status and error category", async () => {
    const db = createMockD1();
    const job = makeValidJob();

    await writeDLQStatus(job, "timed_out", "Processing exceeded 30s", db);

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT OR REPLACE"));
    // Verify bind was called with correct shop, productId, templateId and 'failed' status
    const prepareResult = ((db.prepare as ReturnType<typeof vi.fn>).mock.results[0] as { value: { bind: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } }).value;
    expect(prepareResult.bind).toHaveBeenCalledWith(
      job.shop,
      job.productId,
      job.templateId,
      expect.stringContaining("timed_out")
    );
    expect(prepareResult.run).toHaveBeenCalled();
  });

  it("includes rawError in the error_message when provided", async () => {
    const db = createMockD1();
    const job = makeValidJob();

    await writeDLQStatus(job, "bg_removal_failed", "confidence=0.3", db);

    const prepareResult = ((db.prepare as ReturnType<typeof vi.fn>).mock.results[0] as { value: { bind: ReturnType<typeof vi.fn> } }).value;
    expect(prepareResult.bind).toHaveBeenCalledWith(
      job.shop,
      job.productId,
      job.templateId,
      "bg_removal_failed: confidence=0.3"
    );
  });

  it("omits colon when rawError is null", async () => {
    const db = createMockD1();
    const job = makeValidJob();

    await writeDLQStatus(job, "quota_exceeded", null, db);

    const prepareResult = ((db.prepare as ReturnType<typeof vi.fn>).mock.results[0] as { value: { bind: ReturnType<typeof vi.fn> } }).value;
    const bindCalls = (prepareResult.bind as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const errorMsg = (bindCalls[0] ?? [])[3];
    expect(errorMsg).toBe("quota_exceeded");
  });
});

// ---------------------------------------------------------------------------
// 3. handleDLQBatch() — DLQ writes correct status per error category
// ---------------------------------------------------------------------------

describe("handleDLQBatch() — error category mapping", () => {
  const statusCases: [string | undefined, ErrorCategory][] = [
    ["quota_exceeded: limit reached", "quota_exceeded"],
    ["timed_out after 30s", "timed_out"],
    ["quality_gate: low resolution", "quality_gate"],
    ["bg_removal_failed: no confidence", "bg_removal_failed"],
    ["renderer_timeout: satori unreachable", "renderer_timeout"],
    ["compositing_failed: canvas error", "compositing_failed"],
  ];

  it.each(statusCases)(
    "writes failed status with category for error context %j",
    async (errorContext, expectedCategory) => {
      const env = makeEnv();
      const job = makeValidJob(
        errorContext
          ? ({ _errorContext: errorContext } as Partial<ImageJob>)
          : {}
      );
      const msg = makeMessage(job);
      const batch = makeBatch([msg]);

      await handleDLQBatch(batch, env);

      expect(msg.ack).toHaveBeenCalled();
      expect(msg.retry).not.toHaveBeenCalled();

      const prepareResult = ((env.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0] as { value: { bind: ReturnType<typeof vi.fn> } }).value;
      const bindCalls = (prepareResult.bind as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const bindArgs = bindCalls[0] ?? [];
      // status written must be 'failed'
      expect(bindArgs[3]).toContain(expectedCategory);
    }
  );

  it("acks every message — DLQ is terminal, no retry calls", async () => {
    const env = makeEnv();
    const messages = [
      makeMessage(makeValidJob()),
      makeMessage(makeValidJob({ productId: "prod_002" })),
    ];
    const batch = makeBatch(messages);

    await handleDLQBatch(batch, env);

    for (const msg of messages) {
      expect(msg.ack).toHaveBeenCalled();
      expect(msg.retry).not.toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. handleDLQBatch() — schema-invalid messages
// ---------------------------------------------------------------------------

describe("handleDLQBatch() — schema-invalid messages", () => {
  it("acks malformed messages without writing to D1", async () => {
    const env = makeEnv();
    const msg = makeMessage({ invalid: true });
    const batch = makeBatch([msg]);

    await handleDLQBatch(batch, env);

    expect(msg.ack).toHaveBeenCalled();
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  it("continues processing valid messages after a malformed one", async () => {
    const env = makeEnv();
    const badMsg = makeMessage("not-an-object");
    const goodMsg = makeMessage(makeValidJob());
    const batch = makeBatch([badMsg, goodMsg]);

    await handleDLQBatch(batch, env);

    expect(badMsg.ack).toHaveBeenCalled();
    expect(goodMsg.ack).toHaveBeenCalled();
    // DB should be called once for the good message
    expect(env.DB.prepare).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5. reQueueJob() — re-queues with fresh idempotency key
// ---------------------------------------------------------------------------

describe("reQueueJob()", () => {
  it("sends a job to the queue and returns requeued=true", async () => {
    const db = createMockD1();
    const kv = createMockKV();
    const queue = createMockQueue() as Queue<ImageJob>;

    // Stub DB to return a template_id row and merchant row
    let callCount = 0;
    (db.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { template_id: "product-card" };
        if (callCount === 2) return { locale: "en", currency_format: "${{amount}}" };
        return null;
      }),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    // Stub KV to return a brand kit
    (kv.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
      if (key === "brandkit:mystore.myshopify.com") {
        return JSON.stringify({ primaryColor: "#ff0000" });
      }
      return null;
    });

    const env: DLQEnv = { DB: db, KV_STORE: kv, IMAGE_QUEUE: queue };
    const result = await reQueueJob("prod_001", "mystore.myshopify.com", env);

    expect(result.requeued).toBe(true);
    expect(result.idempotencyKey).toMatch(/^regen:mystore\.myshopify\.com:prod_001:/);

    // Verify the job was sent to the queue
    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        shop: "mystore.myshopify.com",
        productId: "prod_001",
        templateId: "product-card",
        locale: "en",
        brandKit: expect.objectContaining({ primaryColor: "#ff0000" }),
      })
    );
  });

  it("writes a KV idempotency key with 24-hour TTL", async () => {
    const db = createMockD1();
    const kv = createMockKV();
    const queue = createMockQueue() as Queue<ImageJob>;

    let callCount = 0;
    (db.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { template_id: "product-card" };
        return { locale: "en", currency_format: "${{amount}}" };
      }),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env: DLQEnv = { DB: db, KV_STORE: kv, IMAGE_QUEUE: queue };
    const result = await reQueueJob("prod_002", "shop2.myshopify.com", env);

    expect(kv.put).toHaveBeenCalledWith(
      `webhook:${result.idempotencyKey}`,
      "1",
      { expirationTtl: 86_400 }
    );
  });

  it("throws when merchant is not found", async () => {
    const db = createMockD1();
    const kv = createMockKV();
    const queue = createMockQueue() as Queue<ImageJob>;

    let callCount = 0;
    (db.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { template_id: "product-card" };
        return null; // merchant not found
      }),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env: DLQEnv = { DB: db, KV_STORE: kv, IMAGE_QUEUE: queue };

    await expect(reQueueJob("prod_003", "gone.myshopify.com", env)).rejects.toThrow(
      "Merchant not found: gone.myshopify.com"
    );
  });

  it("uses default product-card template when no generated_images row exists", async () => {
    const db = createMockD1();
    const kv = createMockKV();
    const queue = createMockQueue() as Queue<ImageJob>;

    let callCount = 0;
    (db.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return null; // no generated_images row
        return { locale: "fr", currency_format: "{{amount}} €" };
      }),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env: DLQEnv = { DB: db, KV_STORE: kv, IMAGE_QUEUE: queue };
    await reQueueJob("prod_new", "frshop.myshopify.com", env);

    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "product-card",
        locale: "fr",
      })
    );
  });
});
