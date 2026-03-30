/**
 * PR-021: Unit tests for onboarding.server.ts
 *
 * Verifies:
 * - brand kit saved to KV
 * - template preference saved to D1
 * - email triggered on completion
 * - hex validation
 * - logo upload to R2
 * - onboarding state lifecycle
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  saveBrandKit,
  getBrandKit,
  saveTemplatePreference,
  completeOnboarding,
  getOnboardingState,
  saveOnboardingState,
  isOnboardingComplete,
  validateHexColor,
  uploadLogoToR2,
  estimateGenerationMinutes,
  onboardingStateKey,
  brandKitKey,
  ONBOARDING_TEMPLATES,
  type BrandKit,
  type OnboardingState,
} from "../src/onboarding.server.js";
import { createMockKV, createMockD1 } from "./setup.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHOP = "test-shop.myshopify.com";

const BRAND_KIT: BrandKit = {
  primaryColor: "#FF5733",
  fontFamily: "Inter",
  logoR2Key: null,
  logoUrl: null,
};

// ---------------------------------------------------------------------------
// KV key helpers
// ---------------------------------------------------------------------------

describe("KV key helpers", () => {
  it("onboardingStateKey returns correct prefix", () => {
    expect(onboardingStateKey(SHOP)).toBe(`onboarding:${SHOP}`);
  });

  it("brandKitKey returns correct prefix", () => {
    expect(brandKitKey(SHOP)).toBe(`brandkit:${SHOP}`);
  });
});

// ---------------------------------------------------------------------------
// validateHexColor
// ---------------------------------------------------------------------------

describe("validateHexColor", () => {
  it("accepts valid 6-digit hex", () => {
    expect(validateHexColor("#FF5733")).toBe("#FF5733");
    expect(validateHexColor("#0052cc")).toBe("#0052CC");
  });

  it("expands 3-digit hex to 6-digit", () => {
    expect(validateHexColor("#ABC")).toBe("#AABBCC");
    expect(validateHexColor("#f00")).toBe("#FF0000");
  });

  it("rejects invalid colors", () => {
    expect(() => validateHexColor("red")).toThrow();
    expect(() => validateHexColor("#GGGGGG")).toThrow();
    expect(() => validateHexColor("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Brand kit — KV storage
// ---------------------------------------------------------------------------

describe("saveBrandKit / getBrandKit", () => {
  it("saves brand kit to KV and retrieves it", async () => {
    const kv = createMockKV();

    await saveBrandKit(SHOP, BRAND_KIT, kv);

    // KV.put should have been called with the brand kit key
    expect(kv.put).toHaveBeenCalledWith(
      `brandkit:${SHOP}`,
      JSON.stringify(BRAND_KIT),
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });

  it("getBrandKit returns null if no brand kit stored", async () => {
    const kv = createMockKV();
    const result = await getBrandKit(SHOP, kv);
    expect(result).toBeNull();
  });

  it("getBrandKit returns the stored brand kit", async () => {
    const store = new Map<string, string>();
    const kv = createMockKV();

    // Simulate data already in KV
    (kv.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) =>
      store.get(key) ?? null
    );
    (kv.put as ReturnType<typeof vi.fn>).mockImplementation(async (key: string, val: string) => {
      store.set(key, val);
    });

    await saveBrandKit(SHOP, BRAND_KIT, kv);
    const retrieved = await getBrandKit(SHOP, kv);
    expect(retrieved).toEqual(BRAND_KIT);
  });
});

// ---------------------------------------------------------------------------
// Onboarding state lifecycle
// ---------------------------------------------------------------------------

describe("onboarding state", () => {
  it("getOnboardingState returns null if not set", async () => {
    const kv = createMockKV();
    const result = await getOnboardingState(SHOP, kv);
    expect(result).toBeNull();
  });

  it("saves and retrieves onboarding state", async () => {
    const store = new Map<string, string>();
    const kv = createMockKV();
    (kv.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) =>
      store.get(key) ?? null
    );
    (kv.put as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string, val: string) => {
        store.set(key, val);
      }
    );

    const state: OnboardingState = {
      shop: SHOP,
      step: 2,
      brandKit: BRAND_KIT,
      selectedTemplateId: null,
      completedAt: null,
    };

    await saveOnboardingState(SHOP, state, kv);
    const retrieved = await getOnboardingState(SHOP, kv);
    expect(retrieved).toEqual(state);
  });

  it("isOnboardingComplete returns false when step is 1", async () => {
    const store = new Map<string, string>();
    const kv = createMockKV();
    (kv.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) =>
      store.get(key) ?? null
    );
    (kv.put as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string, val: string) => {
        store.set(key, val);
      }
    );

    await saveOnboardingState(
      SHOP,
      { shop: SHOP, step: 1, brandKit: null, selectedTemplateId: null, completedAt: null },
      kv
    );
    expect(await isOnboardingComplete(SHOP, kv)).toBe(false);
  });

  it("isOnboardingComplete returns true when step is complete", async () => {
    const store = new Map<string, string>();
    const kv = createMockKV();
    (kv.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) =>
      store.get(key) ?? null
    );
    (kv.put as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string, val: string) => {
        store.set(key, val);
      }
    );

    await saveOnboardingState(
      SHOP,
      {
        shop: SHOP,
        step: "complete",
        brandKit: BRAND_KIT,
        selectedTemplateId: "product-card",
        completedAt: new Date().toISOString(),
      },
      kv
    );
    expect(await isOnboardingComplete(SHOP, kv)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Template preference — D1 storage
// ---------------------------------------------------------------------------

describe("saveTemplatePreference", () => {
  it("saves template preference to D1", async () => {
    const db = createMockD1();
    const templateId = ONBOARDING_TEMPLATES[0].id;
    await saveTemplatePreference(SHOP, templateId, db);
    expect(db.prepare).toHaveBeenCalled();
  });

  it("throws for unknown template ID", async () => {
    const db = createMockD1();
    await expect(
      saveTemplatePreference(SHOP, "non-existent-template", db)
    ).rejects.toThrow("Unknown template ID");
  });

  it("accepts all valid ONBOARDING_TEMPLATES ids", async () => {
    for (const template of ONBOARDING_TEMPLATES) {
      const db = createMockD1();
      await expect(saveTemplatePreference(SHOP, template.id, db)).resolves.not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Logo upload to R2
// ---------------------------------------------------------------------------

describe("uploadLogoToR2", () => {
  it("uploads PNG logo to R2 and returns key", async () => {
    const r2 = {
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket;

    const buffer = new ArrayBuffer(100);
    const key = await uploadLogoToR2(SHOP, buffer, "image/png", r2);

    expect(key).toBe(`logos/${SHOP}/logo.png`);
    expect(r2.put).toHaveBeenCalledWith(
      `logos/${SHOP}/logo.png`,
      buffer,
      expect.objectContaining({ httpMetadata: { contentType: "image/png" } })
    );
  });

  it("uses jpg extension for jpeg content type", async () => {
    const r2 = { put: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket;
    const key = await uploadLogoToR2(SHOP, new ArrayBuffer(100), "image/jpeg", r2);
    expect(key).toMatch(/\.jpg$/);
  });
});

// ---------------------------------------------------------------------------
// Completion email (Resend)
// ---------------------------------------------------------------------------

describe("sendOnboardingCompletionEmail", () => {
  it("calls Resend API with correct payload", async () => {
    const { sendOnboardingCompletionEmail } = await import(
      "../src/onboarding.server.js"
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"id":"email_123"}',
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    await sendOnboardingCompletionEmail({
      shop: SHOP,
      productCount: 10,
      estimatedMinutes: 3,
      resendApiKey: "test-resend-key",
      appUrl: "https://test.example.com",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-resend-key",
        }),
      })
    );

    vi.unstubAllGlobals();
  });

  it("throws when Resend API returns error", async () => {
    const { sendOnboardingCompletionEmail } = await import(
      "../src/onboarding.server.js"
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity",
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendOnboardingCompletionEmail({
        shop: SHOP,
        productCount: 5,
        estimatedMinutes: 2,
        resendApiKey: "bad-key",
        appUrl: "https://test.example.com",
      })
    ).rejects.toThrow("Resend email failed: 422");

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// estimateGenerationMinutes
// ---------------------------------------------------------------------------

describe("estimateGenerationMinutes", () => {
  it("returns 1 for up to 4 products", () => {
    expect(estimateGenerationMinutes(1)).toBe(1);
    expect(estimateGenerationMinutes(4)).toBe(1);
  });

  it("returns correct minutes for 60 products (15 minutes)", () => {
    expect(estimateGenerationMinutes(60)).toBe(15);
  });

  it("rounds up", () => {
    // 5 * 15 = 75 seconds = 1.25 min → ceil = 2
    expect(estimateGenerationMinutes(5)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// completeOnboarding
// ---------------------------------------------------------------------------

describe("completeOnboarding", () => {
  it("saves complete state to KV, writes D1 log, and sends email", async () => {
    const store = new Map<string, string>();
    const kv = createMockKV();
    (kv.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) =>
      store.get(key) ?? null
    );
    (kv.put as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string, val: string) => {
        store.set(key, val);
      }
    );

    const db = createMockD1();
    const r2 = { put: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"id":"email_123"}',
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await completeOnboarding(SHOP, BRAND_KIT, "product-card", 20, {
      KV_STORE: kv,
      DB: db,
      R2_BUCKET: r2,
      RESEND_API_KEY: "test-key",
      SHOPIFY_APP_URL: "https://test.example.com",
    });

    // State should be marked complete in KV
    const stateRaw = store.get(`onboarding:${SHOP}`);
    expect(stateRaw).toBeTruthy();
    const state = JSON.parse(stateRaw!) as OnboardingState;
    expect(state.step).toBe("complete");
    expect(state.selectedTemplateId).toBe("product-card");

    // D1 should have been written to
    expect(db.prepare).toHaveBeenCalled();

    // Resend fetch should have been called
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.any(Object)
    );

    vi.unstubAllGlobals();
  });
});
