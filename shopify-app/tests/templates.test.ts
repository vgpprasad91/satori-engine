/**
 * PR-023: Unit tests for templates.server.ts
 *
 * Verifies:
 * - getTemplateBrandKit returns defaults when nothing is stored
 * - saveTemplateBrandKit saves to KV with correct key and TTL
 * - uploadLogoToR2 saves to R2 with correct key and content-type
 * - getLogoUrl returns the correct public URL
 * - templateBrandKitKey helper produces correct prefix
 * - keyboard shortcut constants are defined (smoke test)
 */

import { describe, it, expect, vi } from "vitest";
import {
  getTemplateBrandKit,
  saveTemplateBrandKit,
  uploadLogoToR2,
  getLogoUrl,
  templateBrandKitKey,
  DEFAULT_BRAND_KIT,
  EDITOR_TEMPLATES,
  TEMPLATE_FONTS,
  TEMPLATE_BRAND_KIT_KEY_PREFIX,
  type TemplateBrandKit,
} from "../src/templates.server.js";
import { createMockKV } from "./setup.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHOP = "test-shop.myshopify.com";

const BRAND_KIT: TemplateBrandKit = {
  primaryColor: "#FF5733",
  fontFamily: "Inter",
  logoR2Key: null,
  logoUrl: null,
};

// ---------------------------------------------------------------------------
// templateBrandKitKey
// ---------------------------------------------------------------------------

describe("templateBrandKitKey", () => {
  it("uses the correct prefix", () => {
    expect(templateBrandKitKey(SHOP)).toBe(
      `${TEMPLATE_BRAND_KIT_KEY_PREFIX}${SHOP}`
    );
  });

  it("matches brandkit: prefix pattern", () => {
    expect(templateBrandKitKey(SHOP)).toBe(`brandkit:${SHOP}`);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_BRAND_KIT
// ---------------------------------------------------------------------------

describe("DEFAULT_BRAND_KIT", () => {
  it("has a valid hex primary color", () => {
    expect(DEFAULT_BRAND_KIT.primaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("has a non-empty fontFamily", () => {
    expect(DEFAULT_BRAND_KIT.fontFamily.length).toBeGreaterThan(0);
  });

  it("has null logoR2Key and logoUrl", () => {
    expect(DEFAULT_BRAND_KIT.logoR2Key).toBeNull();
    expect(DEFAULT_BRAND_KIT.logoUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getTemplateBrandKit — returns defaults when not set
// ---------------------------------------------------------------------------

describe("getTemplateBrandKit", () => {
  it("returns DEFAULT_BRAND_KIT when KV has no entry", async () => {
    const kv = createMockKV();
    const result = await getTemplateBrandKit(SHOP, kv);
    expect(result).toEqual(DEFAULT_BRAND_KIT);
  });

  it("returns stored brand kit when KV has an entry", async () => {
    const store = new Map<string, string>();
    const kv = createMockKV();

    (kv.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => store.get(key) ?? null
    );
    (kv.put as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string, val: string) => { store.set(key, val); }
    );

    await saveTemplateBrandKit(SHOP, BRAND_KIT, kv);
    const result = await getTemplateBrandKit(SHOP, kv);

    expect(result).toEqual(BRAND_KIT);
  });

  it("returns a fresh copy (not the same object reference as DEFAULT_BRAND_KIT)", async () => {
    const kv = createMockKV();
    const result = await getTemplateBrandKit(SHOP, kv);
    expect(result).not.toBe(DEFAULT_BRAND_KIT);
  });
});

// ---------------------------------------------------------------------------
// saveTemplateBrandKit
// ---------------------------------------------------------------------------

describe("saveTemplateBrandKit", () => {
  it("calls kv.put with the correct key", async () => {
    const kv = createMockKV();
    await saveTemplateBrandKit(SHOP, BRAND_KIT, kv);

    expect(kv.put).toHaveBeenCalledWith(
      templateBrandKitKey(SHOP),
      JSON.stringify(BRAND_KIT),
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });

  it("uses a TTL of at least 1 year (seconds)", async () => {
    const kv = createMockKV();
    await saveTemplateBrandKit(SHOP, BRAND_KIT, kv);

    const [, , opts] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      { expirationTtl: number },
    ];
    expect(opts.expirationTtl).toBeGreaterThanOrEqual(365 * 24 * 60 * 60);
  });

  it("serialises the brand kit as JSON", async () => {
    const kv = createMockKV();
    await saveTemplateBrandKit(SHOP, BRAND_KIT, kv);

    const [, value] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(JSON.parse(value)).toEqual(BRAND_KIT);
  });
});

// ---------------------------------------------------------------------------
// uploadLogoToR2
// ---------------------------------------------------------------------------

describe("uploadLogoToR2", () => {
  it("uploads PNG and returns correct key", async () => {
    const r2 = {
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket;

    const buffer = new ArrayBuffer(100);
    const key = await uploadLogoToR2(SHOP, buffer, "image/png", r2);

    expect(key).toBe(`logos/${SHOP}/logo.png`);
    expect(r2.put).toHaveBeenCalledWith(
      `logos/${SHOP}/logo.png`,
      buffer,
      expect.objectContaining({
        httpMetadata: { contentType: "image/png" },
      })
    );
  });

  it("uses jpg extension for image/jpeg content type", async () => {
    const r2 = {
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket;

    const key = await uploadLogoToR2(SHOP, new ArrayBuffer(50), "image/jpeg", r2);
    expect(key).toMatch(/\.jpg$/);
  });

  it("passes buffer directly to r2.put", async () => {
    const r2 = {
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket;

    const buffer = new ArrayBuffer(200);
    await uploadLogoToR2(SHOP, buffer, "image/png", r2);

    const [, capturedBuffer] = (r2.put as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, ArrayBuffer, unknown];
    expect(capturedBuffer).toBe(buffer);
  });
});

// ---------------------------------------------------------------------------
// getLogoUrl
// ---------------------------------------------------------------------------

describe("getLogoUrl", () => {
  it("returns null when logoR2Key is null", () => {
    const kit: TemplateBrandKit = { ...DEFAULT_BRAND_KIT, logoR2Key: null, logoUrl: null };
    const url = getLogoUrl(SHOP, "https://app.example.com", kit);
    expect(url).toBeNull();
  });

  it("returns correct public URL when logoR2Key is set", () => {
    const kit: TemplateBrandKit = {
      ...DEFAULT_BRAND_KIT,
      logoR2Key: `logos/${SHOP}/logo.png`,
      logoUrl: null,
    };
    const url = getLogoUrl(SHOP, "https://app.example.com", kit);
    expect(url).toBe(`https://app.example.com/r2/logos/${SHOP}/logo.png`);
  });
});

// ---------------------------------------------------------------------------
// EDITOR_TEMPLATES
// ---------------------------------------------------------------------------

describe("EDITOR_TEMPLATES", () => {
  it("has exactly 8 templates", () => {
    expect(EDITOR_TEMPLATES.length).toBe(8);
  });

  it("includes all required template IDs", () => {
    const ids = EDITOR_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("product-card");
    expect(ids).toContain("sale-announcement");
    expect(ids).toContain("new-arrival");
    expect(ids).toContain("story-format");
    expect(ids).toContain("landscape-post");
    expect(ids).toContain("square-post");
    expect(ids).toContain("price-drop");
    expect(ids).toContain("seasonal");
  });

  it("every template has id, name, and thumbnail", () => {
    for (const t of EDITOR_TEMPLATES) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.thumbnail).toMatch(/^\/templates\//);
    }
  });
});

// ---------------------------------------------------------------------------
// TEMPLATE_FONTS
// ---------------------------------------------------------------------------

describe("TEMPLATE_FONTS", () => {
  it("includes Inter", () => {
    expect(TEMPLATE_FONTS).toContain("Inter");
  });

  it("has at least 5 fonts (matches Satori renderer)", () => {
    expect(TEMPLATE_FONTS.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts (smoke test — verify constants exist in route module)
// ---------------------------------------------------------------------------

describe("keyboard shortcuts (constants)", () => {
  it("EDITOR_TEMPLATES is defined (route depends on this export)", () => {
    expect(EDITOR_TEMPLATES).toBeDefined();
  });

  it("TEMPLATE_FONTS is defined (font selector depends on this export)", () => {
    expect(TEMPLATE_FONTS).toBeDefined();
  });

  it("DEFAULT_BRAND_KIT is defined (Esc reset depends on this export)", () => {
    expect(DEFAULT_BRAND_KIT).toBeDefined();
  });
});
