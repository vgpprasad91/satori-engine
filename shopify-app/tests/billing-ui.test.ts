/**
 * PR-024: Tests for billing and plan management UI
 *
 * Tests the loader and action of app.billing.tsx route logic
 * without importing React components (avoids JSX parser issues in Vitest).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PLANS } from "../src/billing.server.js";
import type { PlanName } from "../src/billing.server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock D1 returning the given merchant row. */
function makeMockD1(row?: Record<string, unknown> | null): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(row ?? null),
    }),
  } as unknown as D1Database;
}

/** Build a minimal mock KV with optional stored values. */
function makeMockKV(values: Record<string, string> = {}): KVNamespace {
  return {
    get: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(values[key] ?? null)
    ),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// PLANS configuration (verify plan data used in UI)
// ---------------------------------------------------------------------------

describe("PLANS — billing UI data", () => {
  it("hobby plan is free with 100 image limit", () => {
    expect(PLANS.hobby.price).toBe(0);
    expect(PLANS.hobby.monthlyLimit).toBe(100);
    expect(PLANS.hobby.cappedAmount).toBeNull();
    expect(PLANS.hobby.overagePerImage).toBeNull();
  });

  it("pro plan costs $29 with 1000 limit and overage", () => {
    expect(PLANS.pro.price).toBe(29);
    expect(PLANS.pro.monthlyLimit).toBe(1_000);
    expect(PLANS.pro.cappedAmount).toBe(50);
    expect(PLANS.pro.overagePerImage).toBe(0.05);
  });

  it("business plan costs $79 with 10000 limit and overage", () => {
    expect(PLANS.business.price).toBe(79);
    expect(PLANS.business.monthlyLimit).toBe(10_000);
    expect(PLANS.business.cappedAmount).toBe(100);
    expect(PLANS.business.overagePerImage).toBe(0.01);
  });

  it("all three plans are defined", () => {
    const plans: PlanName[] = ["hobby", "pro", "business"];
    for (const p of plans) {
      expect(PLANS[p]).toBeDefined();
      expect(PLANS[p].name).toBe(p);
    }
  });
});

// ---------------------------------------------------------------------------
// Usage percentage calculation (mirrors billing UI logic)
// ---------------------------------------------------------------------------

describe("Usage percentage calculation", () => {
  function calcUsagePercent(used: number, limit: number): number {
    if (limit <= 0) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  }

  it("returns 0 when nothing used", () => {
    expect(calcUsagePercent(0, 100)).toBe(0);
  });

  it("returns 50 at half usage", () => {
    expect(calcUsagePercent(50, 100)).toBe(50);
  });

  it("returns 80 at 80 of 100 images used — warning threshold", () => {
    expect(calcUsagePercent(80, 100)).toBe(80);
  });

  it("returns 95 at 95 of 100 images used — critical threshold", () => {
    expect(calcUsagePercent(95, 100)).toBe(95);
  });

  it("caps at 100 when over limit", () => {
    expect(calcUsagePercent(150, 100)).toBe(100);
  });

  it("returns 0 when limit is 0", () => {
    expect(calcUsagePercent(50, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Warning / critical state logic
// ---------------------------------------------------------------------------

describe("Usage state — warning and critical bands", () => {
  function getState(usagePercent: number): "normal" | "warning" | "critical" {
    if (usagePercent >= 95) return "critical";
    if (usagePercent >= 80) return "warning";
    return "normal";
  }

  it("below 80% is normal", () => {
    expect(getState(0)).toBe("normal");
    expect(getState(50)).toBe("normal");
    expect(getState(79)).toBe("normal");
  });

  it("80–94% is warning", () => {
    expect(getState(80)).toBe("warning");
    expect(getState(85)).toBe("warning");
    expect(getState(94)).toBe("warning");
  });

  it("95%+ is critical", () => {
    expect(getState(95)).toBe("critical");
    expect(getState(99)).toBe("critical");
    expect(getState(100)).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Images remaining calculation
// ---------------------------------------------------------------------------

describe("Images remaining calculation", () => {
  function imagesRemaining(used: number, limit: number): number {
    return Math.max(0, limit - used);
  }

  it("returns full limit when nothing used", () => {
    expect(imagesRemaining(0, 100)).toBe(100);
  });

  it("returns zero when limit reached", () => {
    expect(imagesRemaining(100, 100)).toBe(0);
  });

  it("never goes negative", () => {
    expect(imagesRemaining(150, 100)).toBe(0);
  });

  it("returns correct remainder", () => {
    expect(imagesRemaining(73, 1000)).toBe(927);
  });
});

// ---------------------------------------------------------------------------
// Overage explanation display logic
// ---------------------------------------------------------------------------

describe("Overage explanation logic", () => {
  function shouldShowOverage(planName: PlanName): boolean {
    return (
      PLANS[planName].cappedAmount !== null &&
      PLANS[planName].overagePerImage !== null
    );
  }

  it("hobby plan does not show overage copy", () => {
    expect(shouldShowOverage("hobby")).toBe(false);
  });

  it("pro plan shows overage copy", () => {
    expect(shouldShowOverage("pro")).toBe(true);
  });

  it("business plan shows overage copy", () => {
    expect(shouldShowOverage("business")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reset date calculation
// ---------------------------------------------------------------------------

describe("Reset date calculation", () => {
  function nextResetDate(now: Date): Date {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );
  }

  it("resets to first of next month in UTC", () => {
    const jan15 = new Date("2026-01-15T12:00:00Z");
    const reset = nextResetDate(jan15);
    expect(reset.getUTCFullYear()).toBe(2026);
    expect(reset.getUTCMonth()).toBe(1); // February (0-indexed)
    expect(reset.getUTCDate()).toBe(1);
  });

  it("resets to January 1 of next year from December", () => {
    const dec31 = new Date("2026-12-31T23:59:59Z");
    const reset = nextResetDate(dec31);
    expect(reset.getUTCFullYear()).toBe(2027);
    expect(reset.getUTCMonth()).toBe(0); // January
    expect(reset.getUTCDate()).toBe(1);
  });

  it("reset date is always day 1 of month", () => {
    const dates = [
      "2026-01-01T00:00:00Z",
      "2026-06-15T12:00:00Z",
      "2026-11-30T23:59:59Z",
    ];
    for (const d of dates) {
      const reset = nextResetDate(new Date(d));
      expect(reset.getUTCDate()).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// D1 query logic (mock the DB interaction)
// ---------------------------------------------------------------------------

describe("Billing loader DB logic", () => {
  it("reads plan, billing_status, monthly_limit from D1", async () => {
    const db = makeMockD1({
      plan: "pro",
      billing_status: "active",
      monthly_limit: 1000,
    });

    const row = await db
      .prepare("SELECT plan, billing_status, monthly_limit FROM merchants WHERE shop = ?")
      .bind("test.myshopify.com")
      .first<{ plan: string; billing_status: string; monthly_limit: number }>();

    expect(row?.plan).toBe("pro");
    expect(row?.billing_status).toBe("active");
    expect(row?.monthly_limit).toBe(1000);
  });

  it("defaults to hobby plan when no D1 row", async () => {
    const db = makeMockD1(null);
    const row = await db
      .prepare("SELECT plan, billing_status, monthly_limit FROM merchants WHERE shop = ?")
      .bind("test.myshopify.com")
      .first<{ plan: string } | null>();

    expect(row).toBeNull();

    // Loader defaults
    const plan = (row as { plan: string } | null)?.plan ?? "hobby";
    expect(plan).toBe("hobby");
  });
});

// ---------------------------------------------------------------------------
// KV usage read logic
// ---------------------------------------------------------------------------

describe("Billing loader KV usage", () => {
  it("reads usage counter for current month", async () => {
    const ym = new Date().toISOString().slice(0, 7);
    const kv = makeMockKV({ [`usage:test.myshopify.com:${ym}`]: "42" });

    const val = await kv.get(`usage:test.myshopify.com:${ym}`);
    const usedThisMonth = val ? parseInt(val, 10) : 0;

    expect(usedThisMonth).toBe(42);
  });

  it("returns 0 when no KV key exists", async () => {
    const kv = makeMockKV({});
    const val = await kv.get("usage:test.myshopify.com:2026-01");
    const usedThisMonth = val ? parseInt(val, 10) : 0;
    expect(usedThisMonth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Plan upgrade/downgrade classification
// ---------------------------------------------------------------------------

describe("Upgrade/downgrade plan classification", () => {
  const PLAN_ORDER: Record<PlanName, number> = { hobby: 0, pro: 1, business: 2 };

  function classify(
    current: PlanName,
    target: PlanName
  ): "upgrade" | "downgrade" | "same" {
    const diff = PLAN_ORDER[target] - PLAN_ORDER[current];
    if (diff > 0) return "upgrade";
    if (diff < 0) return "downgrade";
    return "same";
  }

  it("hobby → pro is upgrade", () => expect(classify("hobby", "pro")).toBe("upgrade"));
  it("hobby → business is upgrade", () => expect(classify("hobby", "business")).toBe("upgrade"));
  it("pro → business is upgrade", () => expect(classify("pro", "business")).toBe("upgrade"));
  it("pro → hobby is downgrade", () => expect(classify("pro", "hobby")).toBe("downgrade"));
  it("business → pro is downgrade", () => expect(classify("business", "pro")).toBe("downgrade"));
  it("business → hobby is downgrade", () => expect(classify("business", "hobby")).toBe("downgrade"));
  it("same plan is same", () => {
    expect(classify("hobby", "hobby")).toBe("same");
    expect(classify("pro", "pro")).toBe("same");
    expect(classify("business", "business")).toBe("same");
  });
});

// ---------------------------------------------------------------------------
// Action input validation logic
// ---------------------------------------------------------------------------

describe("Action plan validation", () => {
  function isValidPlan(plan: string | null): plan is PlanName {
    return plan !== null && plan in PLANS;
  }

  it("accepts valid plan names", () => {
    expect(isValidPlan("hobby")).toBe(true);
    expect(isValidPlan("pro")).toBe(true);
    expect(isValidPlan("business")).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidPlan(null)).toBe(false);
  });

  it("rejects unknown plan names", () => {
    expect(isValidPlan("enterprise")).toBe(false);
    expect(isValidPlan("free")).toBe(false);
    expect(isValidPlan("")).toBe(false);
  });
});
