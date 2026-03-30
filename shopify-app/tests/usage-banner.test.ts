/**
 * PR-025: Tests for usage limit banner and upgrade prompt
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  bannerDismissKey,
  dismissBanner,
  isBannerDismissed,
  getUsageBannerData,
  type BannerEnv,
} from "../src/usage-banner.server.js";

// ---------------------------------------------------------------------------
// KV mock
// ---------------------------------------------------------------------------

function makeMockKV(initialData: Record<string, string> = {}): KVNamespace {
  const store = { ...initialData };
  return {
    get: vi.fn().mockImplementation(async (key: string) => store[key] ?? null),
    put: vi.fn().mockImplementation(async (key: string, value: string) => {
      store[key] = value;
    }),
    delete: vi.fn().mockImplementation(async (key: string) => {
      delete store[key];
    }),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// D1 mock
// ---------------------------------------------------------------------------

function makeMockD1(monthlyLimit = 100): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ monthly_limit: monthlyLimit }),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    }),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-03-12T10:00:00Z");
const YEAR_MONTH = "2026-03";

// ---------------------------------------------------------------------------
// bannerDismissKey
// ---------------------------------------------------------------------------

describe("bannerDismissKey", () => {
  it("formats key as banner:dismissed:{shop}:{YYYY-MM}", () => {
    expect(bannerDismissKey("myshop.myshopify.com", "2026-03")).toBe(
      "banner:dismissed:myshop.myshopify.com:2026-03"
    );
  });
});

// ---------------------------------------------------------------------------
// dismissBanner / isBannerDismissed
// ---------------------------------------------------------------------------

describe("dismissBanner", () => {
  it("writes '1' to the dismiss KV key", async () => {
    const kv = makeMockKV();
    await dismissBanner("shop.myshopify.com", kv, FIXED_NOW);

    expect(kv.put).toHaveBeenCalledWith(
      bannerDismissKey("shop.myshopify.com", YEAR_MONTH),
      "1",
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });
});

describe("isBannerDismissed", () => {
  it("returns true when KV key is '1'", async () => {
    const key = bannerDismissKey("shop.myshopify.com", YEAR_MONTH);
    const kv = makeMockKV({ [key]: "1" });
    const result = await isBannerDismissed("shop.myshopify.com", kv, FIXED_NOW);
    expect(result).toBe(true);
  });

  it("returns false when KV key is absent", async () => {
    const kv = makeMockKV();
    const result = await isBannerDismissed("shop.myshopify.com", kv, FIXED_NOW);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getUsageBannerData
// ---------------------------------------------------------------------------

describe("getUsageBannerData", () => {
  it("returns state=null when usage < 80%", async () => {
    // 79 / 100 = 79%
    const usageKey = `usage:shop.myshopify.com:${YEAR_MONTH}`;
    const kv = makeMockKV({ [usageKey]: "79" });
    const env: BannerEnv = { KV_STORE: kv, DB: makeMockD1(100) };

    const result = await getUsageBannerData("shop.myshopify.com", env, FIXED_NOW);

    expect(result.state).toBeNull();
    expect(result.currentUsage).toBe(79);
    expect(result.monthlyLimit).toBe(100);
  });

  it("returns state='warning' when usage is exactly 80%", async () => {
    const usageKey = `usage:shop.myshopify.com:${YEAR_MONTH}`;
    const kv = makeMockKV({ [usageKey]: "80" });
    const env: BannerEnv = { KV_STORE: kv, DB: makeMockD1(100) };

    const result = await getUsageBannerData("shop.myshopify.com", env, FIXED_NOW);

    expect(result.state).toBe("warning");
    expect(result.usagePercent).toBe(80);
  });

  it("returns state='warning' when usage is between 80% and 99%", async () => {
    const usageKey = `usage:shop.myshopify.com:${YEAR_MONTH}`;
    const kv = makeMockKV({ [usageKey]: "95" });
    const env: BannerEnv = { KV_STORE: kv, DB: makeMockD1(100) };

    const result = await getUsageBannerData("shop.myshopify.com", env, FIXED_NOW);

    expect(result.state).toBe("warning");
  });

  it("returns state='critical' when usage >= 100%", async () => {
    const usageKey = `usage:shop.myshopify.com:${YEAR_MONTH}`;
    const kv = makeMockKV({ [usageKey]: "100" });
    const env: BannerEnv = { KV_STORE: kv, DB: makeMockD1(100) };

    const result = await getUsageBannerData("shop.myshopify.com", env, FIXED_NOW);

    expect(result.state).toBe("critical");
    expect(result.usagePercent).toBe(100);
  });

  it("returns state='critical' when usage exceeds limit (over-quota)", async () => {
    const usageKey = `usage:shop.myshopify.com:${YEAR_MONTH}`;
    const kv = makeMockKV({ [usageKey]: "110" });
    const env: BannerEnv = { KV_STORE: kv, DB: makeMockD1(100) };

    const result = await getUsageBannerData("shop.myshopify.com", env, FIXED_NOW);

    expect(result.state).toBe("critical");
  });

  it("returns state=null when banner was dismissed, even at 100%", async () => {
    const usageKey = `usage:shop.myshopify.com:${YEAR_MONTH}`;
    const dismissKey = bannerDismissKey("shop.myshopify.com", YEAR_MONTH);
    const kv = makeMockKV({ [usageKey]: "100", [dismissKey]: "1" });
    const env: BannerEnv = { KV_STORE: kv, DB: makeMockD1(100) };

    const result = await getUsageBannerData("shop.myshopify.com", env, FIXED_NOW);

    expect(result.state).toBeNull();
  });

  it("returns state=null when banner was dismissed at warning level", async () => {
    const usageKey = `usage:shop.myshopify.com:${YEAR_MONTH}`;
    const dismissKey = bannerDismissKey("shop.myshopify.com", YEAR_MONTH);
    const kv = makeMockKV({ [usageKey]: "85", [dismissKey]: "1" });
    const env: BannerEnv = { KV_STORE: kv, DB: makeMockD1(100) };

    const result = await getUsageBannerData("shop.myshopify.com", env, FIXED_NOW);

    expect(result.state).toBeNull();
  });

  it("correctly computes usagePercent for pro plan (1000 limit)", async () => {
    const usageKey = `usage:shop.myshopify.com:${YEAR_MONTH}`;
    const kv = makeMockKV({ [usageKey]: "850" });
    const env: BannerEnv = { KV_STORE: kv, DB: makeMockD1(1000) };

    const result = await getUsageBannerData("shop.myshopify.com", env, FIXED_NOW);

    expect(result.state).toBe("warning");
    expect(result.usagePercent).toBe(85);
    expect(result.monthlyLimit).toBe(1000);
    expect(result.currentUsage).toBe(850);
  });

  it("defaults monthlyLimit to 100 when merchant not found in D1", async () => {
    const kv = makeMockKV();
    const db = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null), // merchant not found
      }),
    } as unknown as D1Database;
    const env: BannerEnv = { KV_STORE: kv, DB: db };

    const result = await getUsageBannerData("newshop.myshopify.com", env, FIXED_NOW);

    expect(result.monthlyLimit).toBe(100);
    expect(result.state).toBeNull(); // usage is 0
  });
});
