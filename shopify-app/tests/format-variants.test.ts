/**
 * PR-042: Unit tests for format-variants.server.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildFormatTemplateId,
  parseFormatTemplateId,
  computeFormatVariantStats,
  buildDownloadUrl,
  buildCopyLinkUrl,
  enqueueFormatVariants,
  getFormatVariants,
  FORMAT_VARIANTS,
  ALL_FORMAT_VARIANTS,
} from "../src/format-variants.server.js";
import type {
  FormatVariant,
  FormatVariantRow,
  FormatVariantsEnv,
} from "../src/format-variants.server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(format: FormatVariant, status: string, r2Key?: string): FormatVariantRow {
  return {
    id: `id-${format}`,
    shop: "test.myshopify.com",
    product_id: "prod-1",
    template_id: buildFormatTemplateId("product-card", format),
    format,
    base_template_id: "product-card",
    r2_key: r2Key ?? null,
    content_hash: null,
    status,
    error_message: null,
    generated_at: status === "not_generated" ? null : "2026-03-12T10:00:00Z",
  };
}

function makeEnv(overrides: Partial<FormatVariantsEnv> = {}): FormatVariantsEnv {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    } as unknown as D1Database,
    KV_STORE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    IMAGE_QUEUE: {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildFormatTemplateId
// ---------------------------------------------------------------------------

describe("buildFormatTemplateId", () => {
  it("appends format with separator", () => {
    expect(buildFormatTemplateId("product-card", "square")).toBe("product-card::square");
    expect(buildFormatTemplateId("product-card", "story")).toBe("product-card::story");
    expect(buildFormatTemplateId("product-card", "landscape")).toBe("product-card::landscape");
    expect(buildFormatTemplateId("product-card", "og_image")).toBe("product-card::og_image");
    expect(buildFormatTemplateId("product-card", "banner")).toBe("product-card::banner");
  });

  it("works with template IDs that contain colons", () => {
    const result = buildFormatTemplateId("my:template", "square");
    expect(result).toBe("my:template::square");
  });
});

// ---------------------------------------------------------------------------
// parseFormatTemplateId
// ---------------------------------------------------------------------------

describe("parseFormatTemplateId", () => {
  it("parses valid composite IDs", () => {
    expect(parseFormatTemplateId("product-card::square")).toEqual({
      baseTemplateId: "product-card",
      format: "square",
    });
    expect(parseFormatTemplateId("product-card::og_image")).toEqual({
      baseTemplateId: "product-card",
      format: "og_image",
    });
  });

  it("returns null for IDs without separator", () => {
    expect(parseFormatTemplateId("product-card")).toBeNull();
    expect(parseFormatTemplateId("")).toBeNull();
  });

  it("returns null for unknown format suffix", () => {
    expect(parseFormatTemplateId("product-card::unknown_format")).toBeNull();
  });

  it("round-trips through build and parse", () => {
    for (const format of ALL_FORMAT_VARIANTS) {
      const composite = buildFormatTemplateId("base-template", format);
      const parsed = parseFormatTemplateId(composite);
      expect(parsed).toEqual({ baseTemplateId: "base-template", format });
    }
  });
});

// ---------------------------------------------------------------------------
// FORMAT_VARIANTS definitions
// ---------------------------------------------------------------------------

describe("FORMAT_VARIANTS", () => {
  it("contains all 5 expected formats", () => {
    expect(Object.keys(FORMAT_VARIANTS)).toHaveLength(5);
    expect(FORMAT_VARIANTS.square.width).toBe(1080);
    expect(FORMAT_VARIANTS.square.height).toBe(1080);
    expect(FORMAT_VARIANTS.story.width).toBe(1080);
    expect(FORMAT_VARIANTS.story.height).toBe(1920);
    expect(FORMAT_VARIANTS.landscape.width).toBe(1200);
    expect(FORMAT_VARIANTS.landscape.height).toBe(628);
    expect(FORMAT_VARIANTS.og_image.width).toBe(1200);
    expect(FORMAT_VARIANTS.og_image.height).toBe(630);
    expect(FORMAT_VARIANTS.banner.width).toBe(1400);
    expect(FORMAT_VARIANTS.banner.height).toBe(500);
  });

  it("ALL_FORMAT_VARIANTS matches FORMAT_VARIANTS keys", () => {
    const keys = Object.keys(FORMAT_VARIANTS) as FormatVariant[];
    expect(ALL_FORMAT_VARIANTS.sort()).toEqual(keys.sort());
  });

  it("each format has required fields", () => {
    for (const [_id, meta] of Object.entries(FORMAT_VARIANTS)) {
      expect(typeof meta.label).toBe("string");
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
      expect(typeof meta.aspectRatio).toBe("string");
      expect(typeof meta.description).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// computeFormatVariantStats
// ---------------------------------------------------------------------------

describe("computeFormatVariantStats", () => {
  it("counts empty array", () => {
    const stats = computeFormatVariantStats([]);
    expect(stats).toEqual({ total: 0, generated: 0, pending: 0, failed: 0, not_generated: 0 });
  });

  it("counts all statuses correctly", () => {
    const rows: FormatVariantRow[] = [
      makeRow("square", "success", "shop/prod/square.png"),
      makeRow("story", "pending"),
      makeRow("landscape", "failed"),
      makeRow("og_image", "not_generated"),
      makeRow("banner", "renderer_timeout"),
    ];
    const stats = computeFormatVariantStats(rows);
    expect(stats.total).toBe(5);
    expect(stats.generated).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(2); // failed + renderer_timeout
    expect(stats.not_generated).toBe(1);
  });

  it("classifies timed_out and compositing_failed as failed", () => {
    const rows = [
      makeRow("square", "timed_out"),
      makeRow("story", "compositing_failed"),
      makeRow("landscape", "bg_removal_failed"),
    ];
    const stats = computeFormatVariantStats(rows);
    expect(stats.failed).toBe(3);
  });

  it("classifies quota_exceeded as not_generated (neither failed nor generated)", () => {
    const rows = [makeRow("square", "quota_exceeded")];
    const stats = computeFormatVariantStats(rows);
    expect(stats.failed).toBe(0);
    expect(stats.generated).toBe(0);
    expect(stats.not_generated).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildDownloadUrl / buildCopyLinkUrl
// ---------------------------------------------------------------------------

describe("buildDownloadUrl", () => {
  it("returns null when r2Key is null", () => {
    expect(buildDownloadUrl(null, "square")).toBeNull();
  });

  it("returns URL with download flag", () => {
    const url = buildDownloadUrl("shop/prod/square.png", "square");
    expect(url).not.toBeNull();
    expect(url).toContain("download=1");
    expect(url).toContain("format=square");
    expect(url).toContain("shop%2Fprod%2Fsquare.png");
  });

  it("builds URLs for all formats", () => {
    for (const format of ALL_FORMAT_VARIANTS) {
      const url = buildDownloadUrl("some/key.png", format);
      expect(url).toContain(`format=${format}`);
    }
  });
});

describe("buildCopyLinkUrl", () => {
  it("returns null when r2Key is null", () => {
    expect(buildCopyLinkUrl(null, "banner")).toBeNull();
  });

  it("returns URL without download flag", () => {
    const url = buildCopyLinkUrl("shop/prod/banner.png", "banner");
    expect(url).not.toBeNull();
    expect(url).not.toContain("download=1");
    expect(url).toContain("format=banner");
  });
});

// ---------------------------------------------------------------------------
// getFormatVariants
// ---------------------------------------------------------------------------

describe("getFormatVariants", () => {
  it("returns 5 rows (one per format) even if none exist in D1", async () => {
    const env = makeEnv();
    const rows = await getFormatVariants(
      "test.myshopify.com",
      "prod-1",
      "product-card",
      env
    );
    expect(rows).toHaveLength(5);
    // All should be "not_generated" when DB returns null
    for (const row of rows) {
      expect(row.status).toBe("not_generated");
    }
  });

  it("fills in DB data when rows exist", async () => {
    // Mock: square row exists, others return null
    const mockPrepare = vi.fn((sql: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(() => {
        if (sql.includes("generated_images") && sql.includes("LIMIT 1")) {
          return Promise.resolve({
            id: "img-1",
            shop: "test.myshopify.com",
            product_id: "prod-1",
            template_id: "product-card::square",
            r2_key: "test/prod-1/square.png",
            content_hash: "abc123",
            status: "success",
            error_message: null,
            generated_at: "2026-03-12T10:00:00Z",
          });
        }
        return Promise.resolve(null);
      }),
    }));

    const env = makeEnv({
      DB: { prepare: mockPrepare } as unknown as D1Database,
    });

    const rows = await getFormatVariants(
      "test.myshopify.com",
      "prod-1",
      "product-card",
      env
    );

    // All 5 rows returned
    expect(rows).toHaveLength(5);

    // All should have format metadata
    const formats = rows.map((r) => r.format);
    expect(formats).toContain("square");
    expect(formats).toContain("story");
    expect(formats).toContain("landscape");
    expect(formats).toContain("og_image");
    expect(formats).toContain("banner");
  });

  it("handles DB errors gracefully per-format", async () => {
    const mockPrepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockRejectedValue(new Error("DB error")),
    }));

    const env = makeEnv({
      DB: { prepare: mockPrepare } as unknown as D1Database,
    });

    const rows = await getFormatVariants(
      "test.myshopify.com",
      "prod-1",
      "product-card",
      env
    );

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.status).toBe("error");
      expect(row.error_message).toContain("DB error");
    }
  });
});

// ---------------------------------------------------------------------------
// enqueueFormatVariants
// ---------------------------------------------------------------------------

describe("enqueueFormatVariants", () => {
  const jobBase = {
    shop: "test.myshopify.com",
    productId: "prod-1",
    productTitle: "Test Product",
    imageUrl: "https://cdn.shopify.com/product.jpg",
    baseTemplateId: "product-card",
    locale: "en",
    currencyFormat: "${{amount}}",
    brandKit: { primaryColor: "#1a73e8" },
  };

  it("enqueues all 5 formats when none are pending", async () => {
    const mockSend = vi.fn().mockResolvedValue(undefined);
    const mockPrepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null), // no existing rows
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env = makeEnv({
      DB: { prepare: mockPrepare } as unknown as D1Database,
      IMAGE_QUEUE: { send: mockSend } as unknown as Queue,
    });

    const result = await enqueueFormatVariants(jobBase, ALL_FORMAT_VARIANTS, env);

    expect(result.enqueued).toHaveLength(5);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it("skips formats that are already pending", async () => {
    const mockSend = vi.fn().mockResolvedValue(undefined);
    let callCount = 0;
    const mockPrepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(() => {
        // First format returns pending, rest return null
        callCount++;
        return Promise.resolve(callCount === 1 ? { status: "pending" } : null);
      }),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env = makeEnv({
      DB: { prepare: mockPrepare } as unknown as D1Database,
      IMAGE_QUEUE: { send: mockSend } as unknown as Queue,
    });

    const result = await enqueueFormatVariants(jobBase, ALL_FORMAT_VARIANTS, env);

    expect(result.skipped).toHaveLength(1);
    expect(result.enqueued).toHaveLength(4);
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it("enqueues subset of formats when specified", async () => {
    const mockSend = vi.fn().mockResolvedValue(undefined);
    const mockPrepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env = makeEnv({
      DB: { prepare: mockPrepare } as unknown as D1Database,
      IMAGE_QUEUE: { send: mockSend } as unknown as Queue,
    });

    const result = await enqueueFormatVariants(
      jobBase,
      ["square", "story"],
      env
    );

    expect(result.enqueued).toHaveLength(2);
    expect(result.enqueued).toContain("square");
    expect(result.enqueued).toContain("story");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("records errors without throwing when queue fails", async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error("Queue unavailable"));
    const mockPrepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env = makeEnv({
      DB: { prepare: mockPrepare } as unknown as D1Database,
      IMAGE_QUEUE: { send: mockSend } as unknown as Queue,
    });

    const result = await enqueueFormatVariants(jobBase, ["square"], env);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.format).toBe("square");
    expect(result.errors[0]!.error).toContain("Queue unavailable");
  });

  it("proceeds without queue if IMAGE_QUEUE is not bound", async () => {
    const mockPrepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env = makeEnv({
      DB: { prepare: mockPrepare } as unknown as D1Database,
      IMAGE_QUEUE: undefined,
    });

    const result = await enqueueFormatVariants(jobBase, ["square", "banner"], env);

    // Should still mark as enqueued (D1 write succeeded)
    expect(result.enqueued).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("embeds correct composite template IDs in queue messages", async () => {
    const messages: unknown[] = [];
    const mockSend = vi.fn((msg: unknown) => {
      messages.push(msg);
      return Promise.resolve();
    });
    const mockPrepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env = makeEnv({
      DB: { prepare: mockPrepare } as unknown as D1Database,
      IMAGE_QUEUE: { send: mockSend } as unknown as Queue,
    });

    await enqueueFormatVariants(jobBase, ALL_FORMAT_VARIANTS, env);

    const templateIds = messages.map((m) => (m as { templateId: string }).templateId);
    expect(templateIds).toContain("product-card::square");
    expect(templateIds).toContain("product-card::story");
    expect(templateIds).toContain("product-card::landscape");
    expect(templateIds).toContain("product-card::og_image");
    expect(templateIds).toContain("product-card::banner");
  });

  it("embeds format field in each queue message", async () => {
    const messages: unknown[] = [];
    const mockSend = vi.fn((msg: unknown) => {
      messages.push(msg);
      return Promise.resolve();
    });
    const mockPrepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    }));

    const env = makeEnv({
      DB: { prepare: mockPrepare } as unknown as D1Database,
      IMAGE_QUEUE: { send: mockSend } as unknown as Queue,
    });

    await enqueueFormatVariants(jobBase, ALL_FORMAT_VARIANTS, env);

    for (const format of ALL_FORMAT_VARIANTS) {
      const msg = messages.find(
        (m) => (m as { format: string }).format === format
      );
      expect(msg).toBeDefined();
    }
  });
});
