/**
 * PR-030: Monthly usage counter reset cron — unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  scanUsageKeys,
  deleteUsageKeys,
  buildReportEmailHtml,
  sendMonthlyReportEmail,
  writeResetLog,
  previousYearMonth,
  runMonthlyUsageReset,
  type MonthlyResetEnv,
  type ShopUsageTotals,
} from "../src/monthly-reset.server.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeKv(data: Record<string, string> = {}): KVNamespace {
  const store = new Map(Object.entries(data));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async ({ prefix, cursor }: { prefix?: string; cursor?: string }) => {
      const keys = [...store.keys()]
        .filter((k) => (prefix ? k.startsWith(prefix) : true))
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    }),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function makeDb(): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({ success: true })),
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [] })),
      })),
      run: vi.fn(async () => ({ success: true })),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
    })),
    batch: vi.fn(async () => [{ results: [] }]),
    exec: vi.fn(async () => ({ results: [], count: 0 })),
    dump: vi.fn(async () => new ArrayBuffer(0)),
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// previousYearMonth
// ---------------------------------------------------------------------------

describe("previousYearMonth", () => {
  it("returns the prior month for a normal date", () => {
    const result = previousYearMonth(new Date("2026-03-01T00:00:00Z"));
    expect(result).toBe("2026-02");
  });

  it("wraps from January back to previous year December", () => {
    const result = previousYearMonth(new Date("2026-01-01T00:00:00Z"));
    expect(result).toBe("2025-12");
  });

  it("pads single-digit months", () => {
    const result = previousYearMonth(new Date("2026-02-01T00:00:00Z"));
    expect(result).toBe("2026-01");
  });

  it("defaults to current date when no argument given", () => {
    const result = previousYearMonth();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// scanUsageKeys
// ---------------------------------------------------------------------------

describe("scanUsageKeys", () => {
  it("aggregates totals per shop across multiple months", async () => {
    const kv = makeKv({
      "usage:shop-a.myshopify.com:2026-01": "150",
      "usage:shop-a.myshopify.com:2026-02": "200",
      "usage:shop-b.myshopify.com:2026-02": "75",
      "brand:shop-a:color": "#ff0000", // non-usage key — should be ignored
    });

    const { shopTotals, allKeys } = await scanUsageKeys(kv);

    expect(allKeys).toHaveLength(3);
    expect(shopTotals.size).toBe(2);

    const shopA = shopTotals.get("shop-a.myshopify.com");
    expect(shopA?.total).toBe(350);
    expect(shopA?.keys).toHaveLength(2);

    const shopB = shopTotals.get("shop-b.myshopify.com");
    expect(shopB?.total).toBe(75);
  });

  it("returns empty map when no usage keys exist", async () => {
    const kv = makeKv({ "brand:shop:color": "#fff" });
    const { shopTotals, allKeys } = await scanUsageKeys(kv);
    expect(allKeys).toHaveLength(0);
    expect(shopTotals.size).toBe(0);
  });

  it("treats missing or non-numeric values as 0", async () => {
    const kv = makeKv({
      "usage:shop-x.myshopify.com:2026-02": "invalid",
      "usage:shop-y.myshopify.com:2026-02": "",
    });
    const { shopTotals } = await scanUsageKeys(kv);
    expect(shopTotals.get("shop-x.myshopify.com")?.total).toBe(0);
    expect(shopTotals.get("shop-y.myshopify.com")?.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteUsageKeys
// ---------------------------------------------------------------------------

describe("deleteUsageKeys", () => {
  it("deletes all provided keys and returns count", async () => {
    const kv = makeKv({
      "usage:shop-a.myshopify.com:2026-02": "100",
      "usage:shop-b.myshopify.com:2026-02": "50",
    });

    const deleted = await deleteUsageKeys(kv, [
      "usage:shop-a.myshopify.com:2026-02",
      "usage:shop-b.myshopify.com:2026-02",
    ]);

    expect(deleted).toBe(2);
    expect((kv.delete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("returns 0 for empty key list", async () => {
    const kv = makeKv({});
    const deleted = await deleteUsageKeys(kv, []);
    expect(deleted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildReportEmailHtml
// ---------------------------------------------------------------------------

describe("buildReportEmailHtml", () => {
  it("includes yearMonth and shop names in output", () => {
    const totals: ShopUsageTotals[] = [
      { shop: "alpha.myshopify.com", total: 300, keys: [] },
      { shop: "beta.myshopify.com", total: 100, keys: [] },
    ];
    const html = buildReportEmailHtml("2026-02", totals);
    expect(html).toContain("2026-02");
    expect(html).toContain("alpha.myshopify.com");
    expect(html).toContain("beta.myshopify.com");
    expect(html).toContain("400"); // grand total
  });

  it("renders empty state when no shops", () => {
    const html = buildReportEmailHtml("2026-02", []);
    expect(html).toContain("No usage recorded");
  });

  it("sorts shops by total descending", () => {
    const totals: ShopUsageTotals[] = [
      { shop: "low.myshopify.com", total: 10, keys: [] },
      { shop: "high.myshopify.com", total: 9000, keys: [] },
    ];
    const html = buildReportEmailHtml("2026-02", totals);
    const highIdx = html.indexOf("high.myshopify.com");
    const lowIdx = html.indexOf("low.myshopify.com");
    expect(highIdx).toBeLessThan(lowIdx);
  });
});

// ---------------------------------------------------------------------------
// sendMonthlyReportEmail
// ---------------------------------------------------------------------------

describe("sendMonthlyReportEmail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true on successful Resend call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "email-id" }), { status: 200 }))
    );

    const result = await sendMonthlyReportEmail({
      resendApiKey: "re_test_key",
      to: "admin@example.com",
      yearMonth: "2026-02",
      shopTotals: [{ shop: "shop-a.myshopify.com", total: 100, keys: [] }],
    });

    expect(result).toBe(true);
  });

  it("returns false when Resend returns an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 }))
    );

    const result = await sendMonthlyReportEmail({
      resendApiKey: "bad_key",
      to: "admin@example.com",
      yearMonth: "2026-02",
      shopTotals: [],
    });

    expect(result).toBe(false);
  });

  it("returns false and does not throw on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network failure");
      })
    );

    const result = await sendMonthlyReportEmail({
      resendApiKey: "key",
      to: "admin@example.com",
      yearMonth: "2026-02",
      shopTotals: [],
    });

    expect(result).toBe(false);
  });

  it("sends Authorization header with Bearer token", async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response("{}", { status: 200 });
      })
    );

    await sendMonthlyReportEmail({
      resendApiKey: "re_secret_key",
      to: "admin@example.com",
      yearMonth: "2026-02",
      shopTotals: [],
    });

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer re_secret_key");
  });
});

// ---------------------------------------------------------------------------
// writeResetLog
// ---------------------------------------------------------------------------

describe("writeResetLog", () => {
  it("calls D1 prepare with INSERT into webhook_log", async () => {
    const db = makeDb();
    await writeResetLog(db, "2026-02", 5, 10, 1500);
    const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sql).toContain("webhook_log");
    expect(sql).toContain("monthly_usage_reset");
  });

  it("binds the JSON metadata as the shop parameter", async () => {
    let capturedBindArg: string | undefined;
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn((arg: string) => {
          capturedBindArg = arg;
          return { run: vi.fn(async () => ({ success: true })) };
        }),
      })),
    } as unknown as D1Database;

    await writeResetLog(db, "2026-02", 3, 6, 900);

    expect(capturedBindArg).toBeDefined();
    const parsed = JSON.parse(capturedBindArg!);
    expect(parsed.yearMonth).toBe("2026-02");
    expect(parsed.shopsCount).toBe(3);
    expect(parsed.keysDeleted).toBe(6);
    expect(parsed.grandTotal).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// runMonthlyUsageReset (integration)
// ---------------------------------------------------------------------------

describe("runMonthlyUsageReset", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeEnv(kvData: Record<string, string> = {}): MonthlyResetEnv {
    return {
      KV_STORE: makeKv(kvData),
      DB: makeDb(),
      RESEND_API_KEY: "re_test",
      INTERNAL_REPORT_EMAIL: "admin@mailcraft.io",
    };
  }

  it("returns correct shopsProcessed and keysDeleted counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );

    const env = makeEnv({
      "usage:shop-a.myshopify.com:2026-02": "100",
      "usage:shop-b.myshopify.com:2026-02": "50",
    });

    const result = await runMonthlyUsageReset(env, new Date("2026-03-01T00:00:00Z"));

    expect(result.shopsProcessed).toBe(2);
    expect(result.keysDeleted).toBe(2);
    expect(result.emailSent).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("deletes all usage keys after processing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );

    const kv = makeKv({
      "usage:shop-a.myshopify.com:2026-02": "10",
    });
    const env: MonthlyResetEnv = {
      KV_STORE: kv,
      DB: makeDb(),
      RESEND_API_KEY: "re_test",
      INTERNAL_REPORT_EMAIL: "admin@mailcraft.io",
    };

    await runMonthlyUsageReset(env, new Date("2026-03-01T00:00:00Z"));

    const deleteCalls = (kv.delete as ReturnType<typeof vi.fn>).mock.calls;
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.[0]).toBe("usage:shop-a.myshopify.com:2026-02");
  });

  it("email sent before keys are deleted (send precedes delete)", async () => {
    const callOrder: string[] = [];

    const kv = makeKv({ "usage:shop-a.myshopify.com:2026-02": "50" });
    vi.spyOn(kv, "delete").mockImplementation(async (key) => {
      callOrder.push(`delete:${key}`);
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callOrder.push("email");
        return new Response("{}", { status: 200 });
      })
    );

    const env: MonthlyResetEnv = {
      KV_STORE: kv,
      DB: makeDb(),
      RESEND_API_KEY: "re_test",
      INTERNAL_REPORT_EMAIL: "admin@mailcraft.io",
    };

    await runMonthlyUsageReset(env, new Date("2026-03-01T00:00:00Z"));

    const emailPos = callOrder.indexOf("email");
    const deletePos = callOrder.findIndex((e) => e.startsWith("delete:"));
    expect(emailPos).toBeLessThan(deletePos);
  });

  it("proceeds with reset even when email fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("error", { status: 500 }))
    );

    const env = makeEnv({ "usage:shop-a.myshopify.com:2026-02": "10" });
    const result = await runMonthlyUsageReset(env, new Date("2026-03-01T00:00:00Z"));

    expect(result.emailSent).toBe(false);
    expect(result.keysDeleted).toBe(1);
    expect(result.shopsProcessed).toBe(1);
  });

  it("returns shopsProcessed=0 and keysDeleted=0 on empty KV", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );

    const env = makeEnv({});
    const result = await runMonthlyUsageReset(env, new Date("2026-03-01T00:00:00Z"));

    expect(result.shopsProcessed).toBe(0);
    expect(result.keysDeleted).toBe(0);
  });

  it("returns error field when pipeline throws", async () => {
    const kv = makeKv({});
    vi.spyOn(kv, "list").mockRejectedValue(new Error("KV unavailable"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );

    const env: MonthlyResetEnv = {
      KV_STORE: kv,
      DB: makeDb(),
      RESEND_API_KEY: "re_test",
      INTERNAL_REPORT_EMAIL: "admin@mailcraft.io",
    };

    const result = await runMonthlyUsageReset(env, new Date("2026-03-01T00:00:00Z"));

    expect(result.error).toContain("KV unavailable");
    expect(result.emailSent).toBe(false);
  });
});
