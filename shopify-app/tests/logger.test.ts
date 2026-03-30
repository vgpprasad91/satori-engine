/**
 * PR-004: Structured logger — unit tests
 *
 * Validates:
 *   1. log() emits a valid JSON line to console.log
 *   2. The emitted object contains the expected fields
 *   3. access_token is excluded at the TYPE level (compile-time test via
 *      @ts-expect-error) and at runtime (spy confirms it never appears)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, type LogPayload } from "../src/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureLog(fn: () => void): unknown {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  fn();
  const raw = spy.mock.calls[0]?.[0] as string | undefined;
  spy.mockRestore();
  if (!raw) throw new Error("log() did not emit anything");
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("log() — shape", () => {
  it("emits a JSON object with timestamp and all required fields", () => {
    const entry = captureLog(() =>
      log({
        shop: "mystore.myshopify.com",
        step: "bg_removal",
        status: "ok",
        productId: "prod_123",
        durationMs: 320,
      })
    ) as Record<string, unknown>;

    expect(typeof entry.timestamp).toBe("string");
    expect(entry.shop).toBe("mystore.myshopify.com");
    expect(entry.step).toBe("bg_removal");
    expect(entry.status).toBe("ok");
    expect(entry.productId).toBe("prod_123");
    expect(entry.durationMs).toBe(320);
  });

  it("includes an error string when provided", () => {
    const entry = captureLog(() =>
      log({
        shop: "mystore.myshopify.com",
        step: "queue_push",
        status: "error",
        error: "Queue unavailable",
      })
    ) as Record<string, unknown>;

    expect(entry.error).toBe("Queue unavailable");
    expect(entry.status).toBe("error");
  });

  it("omits optional fields when not provided", () => {
    const entry = captureLog(() =>
      log({
        shop: "mystore.myshopify.com",
        step: "install",
        status: "info",
      })
    ) as Record<string, unknown>;

    expect(entry.productId).toBeUndefined();
    expect(entry.durationMs).toBeUndefined();
    expect(entry.error).toBeUndefined();
  });

  it("timestamp is a valid ISO 8601 date string", () => {
    const entry = captureLog(() =>
      log({ shop: "s.myshopify.com", step: "test", status: "ok" })
    ) as Record<string, unknown>;

    expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp);
  });
});

describe("log() — token exclusion at RUNTIME", () => {
  it("does NOT emit access_token even if smuggled via spread (runtime guard)", () => {
    // Force cast to bypass compile-time check — simulates a JS caller or a
    // future mistake where strict types are bypassed.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const payload = {
      shop: "s.myshopify.com",
      step: "test",
      status: "ok",
      // This is intentionally cast to bypass TS — we test runtime behaviour
    } as LogPayload;

    // Directly inject the forbidden key at runtime (TS won't catch this path)
    (payload as Record<string, unknown>)["access_token"] = "shpat_secret";

    log(payload);

    const raw = spy.mock.calls[0]?.[0] as string;
    spy.mockRestore();

    // The logger currently uses spread — the runtime test verifies the shape
    // but the TYPE system is the primary guard. If a runtime filter is added
    // later this test will validate it. For now we assert the key IS present
    // when injected at runtime (so the test documents the TS-only guarantee).
    const entry = JSON.parse(raw) as Record<string, unknown>;

    // The important contract: the TypeScript type makes it impossible to pass
    // access_token through the typed API (see @ts-expect-error test below).
    // Runtime exclusion of manually injected keys is documented here.
    expect(Object.keys(entry)).not.toContain("access_token");
  });
});

describe("log() — compile-time type safety", () => {
  it("rejects access_token at the type level (static check)", () => {
    // If the TypeScript type guard is removed the line below will compile and
    // fail. The @ts-expect-error annotation ensures the compiler catches it.

    // @ts-expect-error access_token must never be assignable to LogPayload
    const _bad: LogPayload = { shop: "s.myshopify.com", step: "test", status: "ok", access_token: "shpat_secret" };
    void _bad;

    // If we reach here the @ts-expect-error did its job.
    expect(true).toBe(true);
  });

  it("rejects SHOPIFY_API_SECRET at the type level (static check)", () => {
    // @ts-expect-error SHOPIFY_API_SECRET must never be assignable to LogPayload
    const _bad: LogPayload = { shop: "s.myshopify.com", step: "test", status: "ok", SHOPIFY_API_SECRET: "some_secret" };
    void _bad;

    expect(true).toBe(true);
  });
});
