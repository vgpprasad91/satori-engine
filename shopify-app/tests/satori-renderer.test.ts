/**
 * Tests for PR-017: Satori renderer service binding integration
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatCurrencyString,
  localeToDirection,
  buildSatoriRequestBody,
  callSatoriRenderer,
  writeRendererTimeout,
  renderLayoutForJob,
  RENDERER_TIMEOUT_MS,
  type SatoriBinding,
  type SatoriRendererEnv,
  type SatoriRequestBody,
} from "../src/satori-renderer.server.js";
import type { ImageJob } from "../src/queue.server.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<ImageJob> = {}): ImageJob {
  return {
    shop: "test.myshopify.com",
    productId: "prod-001",
    productTitle: "Test Product",
    imageUrl: "https://cdn.shopify.com/test.jpg",
    templateId: "tmpl-abc",
    locale: "en",
    currencyFormat: "${{amount}}",
    brandKit: {
      primaryColor: "#1a73e8",
      logoR2Key: null,
      fontFamily: null,
    },
    ...overrides,
  };
}

function makePngResponse(bytes: number = 100): Response {
  const body = new Uint8Array(bytes).fill(137); // fake PNG bytes
  return new Response(body.buffer, {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}

function makeD1(): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ success: true }),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    }),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

function makeEnv(
  satoriFetch: (req: Request) => Promise<Response>,
  db?: D1Database
): SatoriRendererEnv {
  return {
    SATORI_RENDERER: { fetch: vi.fn(satoriFetch) } as SatoriBinding,
    DB: db ?? makeD1(),
  };
}

// ---------------------------------------------------------------------------
// formatCurrencyString
// ---------------------------------------------------------------------------

describe("formatCurrencyString", () => {
  it("replaces {{amount}} with formatted price", () => {
    expect(formatCurrencyString(29.99, "${{amount}}")).toBe("$29.99");
  });

  it("works with trailing currency symbol", () => {
    expect(formatCurrencyString(19.5, "{{amount}} €")).toBe("19.50 €");
  });

  it("always formats to 2 decimal places", () => {
    expect(formatCurrencyString(10, "£{{amount}}")).toBe("£10.00");
  });

  it("returns raw amount when template has no {{amount}}", () => {
    expect(formatCurrencyString(25, "USD")).toBe("25");
  });

  it("handles zero price", () => {
    expect(formatCurrencyString(0, "${{amount}}")).toBe("$0.00");
  });
});

// ---------------------------------------------------------------------------
// localeToDirection
// ---------------------------------------------------------------------------

describe("localeToDirection", () => {
  it("returns rtl for Arabic locale", () => {
    expect(localeToDirection("ar")).toBe("rtl");
  });

  it("returns rtl for Hebrew locale", () => {
    expect(localeToDirection("he")).toBe("rtl");
  });

  it("returns rtl for Persian locale", () => {
    expect(localeToDirection("fa")).toBe("rtl");
  });

  it("returns rtl for BCP-47 subtag ar-SA", () => {
    expect(localeToDirection("ar-SA")).toBe("rtl");
  });

  it("returns ltr for English locale", () => {
    expect(localeToDirection("en")).toBe("ltr");
  });

  it("returns ltr for French locale", () => {
    expect(localeToDirection("fr-FR")).toBe("ltr");
  });

  it("returns ltr for Japanese locale", () => {
    expect(localeToDirection("ja")).toBe("ltr");
  });

  it("returns ltr for empty string", () => {
    expect(localeToDirection("")).toBe("ltr");
  });
});

// ---------------------------------------------------------------------------
// buildSatoriRequestBody
// ---------------------------------------------------------------------------

describe("buildSatoriRequestBody", () => {
  it("maps job fields to request body correctly for LTR locale", () => {
    const job = makeJob({ locale: "en", currencyFormat: "${{amount}}" });
    const body = buildSatoriRequestBody(job, "$29.99");

    expect(body.templateId).toBe("tmpl-abc");
    expect(body.productTitle).toBe("Test Product");
    expect(body.price).toBe("$29.99");
    expect(body.locale).toBe("ltr");
    expect(body.primaryColor).toBe("#1a73e8");
    expect(body.logoR2Key).toBeNull();
    expect(body.fontFamily).toBeNull();
  });

  it("maps RTL locale correctly", () => {
    const job = makeJob({ locale: "ar" });
    const body = buildSatoriRequestBody(job, "٢٩.٩٩ ر.س.");
    expect(body.locale).toBe("rtl");
  });

  it("includes logoR2Key and fontFamily from brand kit", () => {
    const job = makeJob({
      brandKit: {
        primaryColor: "#ff5733",
        logoR2Key: "shops/test/logo.png",
        fontFamily: "Playfair Display",
      },
    });
    const body = buildSatoriRequestBody(job, "$49.00");
    expect(body.logoR2Key).toBe("shops/test/logo.png");
    expect(body.fontFamily).toBe("Playfair Display");
    expect(body.primaryColor).toBe("#ff5733");
  });
});

// ---------------------------------------------------------------------------
// callSatoriRenderer — success path
// ---------------------------------------------------------------------------

describe("callSatoriRenderer — success", () => {
  it("returns PNG ArrayBuffer on 200 response", async () => {
    const env = makeEnv(async () => makePngResponse(256));
    const body: SatoriRequestBody = {
      templateId: "tmpl-1",
      productTitle: "Widget",
      price: "$9.99",
      locale: "ltr",
      primaryColor: "#ff0000",
    };

    const result = await callSatoriRenderer(
      "shop.myshopify.com",
      "prod-1",
      body,
      env
    );

    expect(result.imageBuffer).toBeInstanceOf(ArrayBuffer);
    expect(result.imageBuffer.byteLength).toBe(256);
    expect(result.direction).toBe("ltr");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes all request body fields as JSON to the binding", async () => {
    let capturedRequest: Request | undefined;
    const env = makeEnv(async (req) => {
      capturedRequest = req;
      return makePngResponse();
    });

    const body: SatoriRequestBody = {
      templateId: "tmpl-rtl",
      productTitle: "منتج",
      price: "٢٩.٩٩ ر.س.",
      locale: "rtl",
      primaryColor: "#1a73e8",
      logoR2Key: "shops/ar/logo.png",
      fontFamily: "Noto Sans Arabic",
    };

    await callSatoriRenderer("ar-shop.myshopify.com", "prod-rtl", body, env);

    expect(capturedRequest).toBeDefined();
    const parsed = await capturedRequest!.json() as SatoriRequestBody;
    expect(parsed.locale).toBe("rtl");
    expect(parsed.productTitle).toBe("منتج");
    expect(parsed.logoR2Key).toBe("shops/ar/logo.png");
  });

  it("includes Accept: image/png header", async () => {
    let capturedRequest: Request | undefined;
    const env = makeEnv(async (req) => {
      capturedRequest = req;
      return makePngResponse();
    });

    await callSatoriRenderer(
      "shop.myshopify.com",
      "prod-1",
      { templateId: "t", productTitle: "P", price: "$1", locale: "ltr", primaryColor: "#000" },
      env
    );

    expect(capturedRequest?.headers.get("Accept")).toBe("image/png");
    expect(capturedRequest?.headers.get("Content-Type")).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// callSatoriRenderer — error paths
// ---------------------------------------------------------------------------

describe("callSatoriRenderer — HTTP errors", () => {
  it("throws on non-200 response", async () => {
    const env = makeEnv(async () =>
      new Response("Bad template", { status: 400 })
    );

    await expect(
      callSatoriRenderer(
        "shop.myshopify.com",
        "prod-1",
        { templateId: "bad", productTitle: "P", price: "$1", locale: "ltr", primaryColor: "#000" },
        env
      )
    ).rejects.toThrow("HTTP 400");
  });

  it("throws when response Content-Type is not image/png", async () => {
    const env = makeEnv(async () =>
      new Response(JSON.stringify({ error: "not png" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(
      callSatoriRenderer(
        "shop.myshopify.com",
        "prod-1",
        { templateId: "t", productTitle: "P", price: "$1", locale: "ltr", primaryColor: "#000" },
        env
      )
    ).rejects.toThrow("Content-Type");
  });
});

// ---------------------------------------------------------------------------
// callSatoriRenderer — timeout path
// ---------------------------------------------------------------------------

describe("callSatoriRenderer — timeout", () => {
  it("throws renderer_timeout and writes D1 status when binding rejects with AbortError", async () => {
    const db = makeD1();

    // Simulate a binding that respects the AbortSignal and rejects immediately with AbortError.
    // This mirrors what happens after RENDERER_TIMEOUT_MS elapses and the AbortController fires.
    const env = makeEnv(async (req: Request) => {
      // If signal is already aborted (fake timers advanced before fetch runs), throw immediately.
      // Otherwise, wait for the abort event.
      return new Promise<Response>((_, reject) => {
        function abort() {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        }
        if (req.signal?.aborted) {
          abort();
        } else {
          req.signal?.addEventListener("abort", abort);
        }
      });
    }, db);

    vi.useFakeTimers({ shouldAdvanceTime: false });

    const renderPromise = callSatoriRenderer(
      "slow.myshopify.com",
      "prod-slow",
      {
        templateId: "t-slow",
        productTitle: "Slow Product",
        price: "$1.00",
        locale: "ltr",
        primaryColor: "#000000",
      },
      env
    );

    // Set up rejection expectation BEFORE advancing time to avoid unhandled rejection warning
    const expectation = expect(renderPromise).rejects.toThrow("renderer_timeout");

    // Advance past RENDERER_TIMEOUT_MS to trigger the internal AbortController
    await vi.advanceTimersByTimeAsync(RENDERER_TIMEOUT_MS + 100);

    await expectation;

    // D1 should have been called to write renderer_timeout status
    expect(db.prepare).toHaveBeenCalled();

    vi.useRealTimers();
  }, 15_000);
});

// ---------------------------------------------------------------------------
// writeRendererTimeout
// ---------------------------------------------------------------------------

describe("writeRendererTimeout", () => {
  it("calls D1 prepare with renderer_timeout status", async () => {
    const db = makeD1();
    await writeRendererTimeout("s.myshopify.com", "prod-1", "tmpl-1", db);
    expect(db.prepare).toHaveBeenCalledOnce();
    const sql: string = ((db.prepare as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as string;
    expect(sql).toContain("renderer_timeout");
  });
});

// ---------------------------------------------------------------------------
// renderLayoutForJob — integration
// ---------------------------------------------------------------------------

describe("renderLayoutForJob", () => {
  it("formats currency and sends correct direction for LTR job", async () => {
    let captured: SatoriRequestBody | undefined;
    const env = makeEnv(async (req) => {
      captured = await req.json() as SatoriRequestBody;
      return makePngResponse();
    });

    const job = makeJob({ locale: "en", currencyFormat: "${{amount}}" });
    const result = await renderLayoutForJob(job, 29.99, env);

    expect(captured?.locale).toBe("ltr");
    expect(captured?.price).toBe("$29.99");
    expect(result.direction).toBe("ltr");
    expect(result.imageBuffer.byteLength).toBeGreaterThan(0);
  });

  it("formats currency and sends rtl direction for Arabic job", async () => {
    let captured: SatoriRequestBody | undefined;
    const env = makeEnv(async (req) => {
      captured = await req.json() as SatoriRequestBody;
      return makePngResponse();
    });

    const job = makeJob({
      locale: "ar",
      currencyFormat: "{{amount}} ر.س.",
    });

    await renderLayoutForJob(job, 49.5, env);

    expect(captured?.locale).toBe("rtl");
    expect(captured?.price).toBe("49.50 ر.س.");
  });

  it("formats currency and sends rtl for Hebrew job", async () => {
    let captured: SatoriRequestBody | undefined;
    const env = makeEnv(async (req) => {
      captured = await req.json() as SatoriRequestBody;
      return makePngResponse();
    });

    const job = makeJob({ locale: "he", currencyFormat: "₪{{amount}}" });
    await renderLayoutForJob(job, 99, env);

    expect(captured?.locale).toBe("rtl");
    expect(captured?.price).toBe("₪99.00");
  });
});
