/**
 * PR-008: Locale and currency extraction on install — unit tests
 *
 * Covers:
 *  1. RTL detection: ar, he, fa → true
 *  2. LTR detection: en, fr, de, zh, ja, es → false
 *  3. BCP 47 subtags handled correctly (ar-SA, he-IL, fa-IR)
 *  4. fetchShopLocale parses Shopify GraphQL response correctly
 *  5. fetchShopLocale throws on HTTP error
 *  6. fetchShopLocale throws on GraphQL errors
 *  7. saveLocaleToD1 calls UPDATE with correct params
 *  8. handleInstallLocale orchestrates fetch + save + log
 *  9. Currency format stored correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isRTL,
  fetchShopLocale,
  saveLocaleToD1,
  handleInstallLocale,
  type ShopLocaleData,
} from "../src/locale.server.js";
import { createMockD1 } from "./setup.js";

// ---------------------------------------------------------------------------
// isRTL — pure function tests
// ---------------------------------------------------------------------------

describe("isRTL()", () => {
  it("returns true for Arabic (ar)", () => {
    expect(isRTL("ar")).toBe(true);
  });

  it("returns true for Hebrew (he)", () => {
    expect(isRTL("he")).toBe(true);
  });

  it("returns true for Persian (fa)", () => {
    expect(isRTL("fa")).toBe(true);
  });

  it("returns true for Arabic BCP 47 subtag (ar-SA)", () => {
    expect(isRTL("ar-SA")).toBe(true);
  });

  it("returns true for Hebrew BCP 47 subtag (he-IL)", () => {
    expect(isRTL("he-IL")).toBe(true);
  });

  it("returns true for Persian BCP 47 subtag (fa-IR)", () => {
    expect(isRTL("fa-IR")).toBe(true);
  });

  it("returns false for English (en)", () => {
    expect(isRTL("en")).toBe(false);
  });

  it("returns false for French (fr)", () => {
    expect(isRTL("fr")).toBe(false);
  });

  it("returns false for German (de)", () => {
    expect(isRTL("de")).toBe(false);
  });

  it("returns false for Chinese (zh)", () => {
    expect(isRTL("zh")).toBe(false);
  });

  it("returns false for Japanese (ja)", () => {
    expect(isRTL("ja")).toBe(false);
  });

  it("returns false for Spanish (es)", () => {
    expect(isRTL("es")).toBe(false);
  });

  it("returns false for English BCP 47 subtag (en-US)", () => {
    expect(isRTL("en-US")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isRTL("")).toBe(false);
  });

  it("handles uppercase locale codes", () => {
    expect(isRTL("AR")).toBe(true);
    expect(isRTL("HE")).toBe(true);
    expect(isRTL("FA")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchShopLocale — mocked fetch
// ---------------------------------------------------------------------------

describe("fetchShopLocale()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and parses locale + currency correctly for LTR shop", async () => {
    const mockResponse = {
      data: {
        shop: {
          primaryLocale: "en",
          currencyFormats: {
            moneyFormat: "${{amount}}",
            moneyWithCurrencyFormat: "${{amount}} USD",
          },
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await fetchShopLocale("test.myshopify.com", "tok_abc");

    expect(result.primaryLocale).toBe("en");
    expect(result.currencyFormat).toBe("${{amount}}");
    expect(result.moneyWithCurrencyFormat).toBe("${{amount}} USD");
    expect(result.isRTL).toBe(false);
  });

  it("returns isRTL=true for Arabic shop", async () => {
    const mockResponse = {
      data: {
        shop: {
          primaryLocale: "ar",
          currencyFormats: {
            moneyFormat: "{{amount}} ر.س.",
            moneyWithCurrencyFormat: "{{amount}} SAR",
          },
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await fetchShopLocale("arabic.myshopify.com", "tok_xyz");

    expect(result.primaryLocale).toBe("ar");
    expect(result.isRTL).toBe(true);
  });

  it("uses 2025-01 API version in request headers", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            shop: {
              primaryLocale: "en",
              currencyFormats: {
                moneyFormat: "${{amount}}",
                moneyWithCurrencyFormat: "${{amount}} USD",
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    await fetchShopLocale("test.myshopify.com", "tok_abc");

    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Shopify-API-Version"]).toBe("2025-01");
  });

  it("throws on HTTP error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401 })
      )
    );

    await expect(
      fetchShopLocale("test.myshopify.com", "bad_token")
    ).rejects.toThrow("Shopify locale fetch failed (401)");
  });

  it("throws on GraphQL errors", async () => {
    const mockResponse = {
      errors: [{ message: "Access denied" }],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(
      fetchShopLocale("test.myshopify.com", "tok_abc")
    ).rejects.toThrow("Shopify GraphQL error: Access denied");
  });

  it("falls back to defaults when fields are missing", async () => {
    const mockResponse = {
      data: {
        shop: {},
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await fetchShopLocale("test.myshopify.com", "tok_abc");

    expect(result.primaryLocale).toBe("en");
    expect(result.currencyFormat).toBe("{{amount}}");
    expect(result.isRTL).toBe(false);
  });

  it("stores currency format string correctly", async () => {
    const mockResponse = {
      data: {
        shop: {
          primaryLocale: "de",
          currencyFormats: {
            moneyFormat: "{{amount}} €",
            moneyWithCurrencyFormat: "{{amount}} EUR",
          },
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await fetchShopLocale("german.myshopify.com", "tok_de");

    expect(result.currencyFormat).toBe("{{amount}} €");
    expect(result.moneyWithCurrencyFormat).toBe("{{amount}} EUR");
  });
});

// ---------------------------------------------------------------------------
// saveLocaleToD1
// ---------------------------------------------------------------------------

describe("saveLocaleToD1()", () => {
  it("calls UPDATE merchants with locale and currency_format", async () => {
    const db = createMockD1();

    const localeData: ShopLocaleData = {
      primaryLocale: "ar",
      currencyFormat: "{{amount}} ر.س.",
      moneyWithCurrencyFormat: "{{amount}} SAR",
      isRTL: true,
    };

    await saveLocaleToD1(db, "arabic.myshopify.com", localeData);

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE merchants"));
    // Verify bind was called with correct params
    const prepareResult = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(prepareResult.bind).toHaveBeenCalledWith(
      "ar",
      "{{amount}} ر.س.",
      "arabic.myshopify.com"
    );
    expect(prepareResult.run).toHaveBeenCalled();
  });

  it("stores LTR locale correctly", async () => {
    const db = createMockD1();

    const localeData: ShopLocaleData = {
      primaryLocale: "en",
      currencyFormat: "${{amount}}",
      moneyWithCurrencyFormat: "${{amount}} USD",
      isRTL: false,
    };

    await saveLocaleToD1(db, "english.myshopify.com", localeData);

    const prepareResult = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(prepareResult.bind).toHaveBeenCalledWith(
      "en",
      "${{amount}}",
      "english.myshopify.com"
    );
  });
});

// ---------------------------------------------------------------------------
// handleInstallLocale — orchestrator
// ---------------------------------------------------------------------------

describe("handleInstallLocale()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches, saves, and returns locale data on success", async () => {
    const mockResponse = {
      data: {
        shop: {
          primaryLocale: "he",
          currencyFormats: {
            moneyFormat: "{{amount}} ₪",
            moneyWithCurrencyFormat: "{{amount}} ILS",
          },
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const db = createMockD1();
    const env = { DB: db };

    const result = await handleInstallLocale("hebrew.myshopify.com", "tok_he", env);

    expect(result.primaryLocale).toBe("he");
    expect(result.isRTL).toBe(true);
    expect(result.currencyFormat).toBe("{{amount}} ₪");

    // Verify D1 was updated
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE merchants"));
  });

  it("propagates fetch errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
    );

    const db = createMockD1();
    const env = { DB: db };

    await expect(
      handleInstallLocale("failing.myshopify.com", "tok_fail", env)
    ).rejects.toThrow("Shopify locale fetch failed (500)");

    // D1 should NOT have been called on failure
    expect(db.prepare).not.toHaveBeenCalled();
  });
});
