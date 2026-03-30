/**
 * Tests for PR-018: Image compositing and R2 storage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sha256Hex,
  brandKitHash,
  buildR2Key,
  findExistingImage,
  writeSuccessRow,
  compositeAndStore,
  R2_CACHE_CONTROL,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  type CompositingEnv,
} from "../src/compositing.server.js";
import type { BrandKit } from "../src/queue.server.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBrandKit(overrides: Partial<BrandKit> = {}): BrandKit {
  return {
    primaryColor: "#1a73e8",
    logoR2Key: null,
    fontFamily: null,
    ...overrides,
  };
}

function makeD1(existingRow: { r2_key: string } | null = null): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ success: true }),
        first: vi.fn().mockResolvedValue(existingRow),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    }),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

function makeR2(): R2Bucket {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    head: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
    createMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function makeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

function makeEnv(
  r2: R2Bucket = makeR2(),
  db: D1Database = makeD1(),
  kv: KVNamespace = makeKV()
): CompositingEnv {
  return {
    IMAGE_BUCKET: r2,
    DB: db,
    KV_STORE: kv,
  };
}

/** Create a minimal fake PNG buffer (enough to pass Blob/createImageBitmap in happy-path mocks). */
function fakePng(size: number = 64): ArrayBuffer {
  return new Uint8Array(size).fill(0x89).buffer; // 0x89 = first byte of real PNG signature
}

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------

describe("sha256Hex", () => {
  it("returns a 64-char lowercase hex string", async () => {
    const hash = await sha256Hex("hello world");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", async () => {
    const h1 = await sha256Hex("shopify-test");
    const h2 = await sha256Hex("shopify-test");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different inputs", async () => {
    const h1 = await sha256Hex("input-A");
    const h2 = await sha256Hex("input-B");
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// brandKitHash
// ---------------------------------------------------------------------------

describe("brandKitHash", () => {
  it("includes primaryColor, logoR2Key and fontFamily", () => {
    const bk = makeBrandKit({ primaryColor: "#ff0000", logoR2Key: "logo.png", fontFamily: "Inter" });
    const hash = brandKitHash(bk);
    expect(hash).toContain("#ff0000");
    expect(hash).toContain("logo.png");
    expect(hash).toContain("Inter");
  });

  it("treats null logoR2Key and fontFamily as empty string", () => {
    const h1 = brandKitHash(makeBrandKit({ logoR2Key: null, fontFamily: null }));
    const h2 = brandKitHash(makeBrandKit({ logoR2Key: undefined, fontFamily: undefined }));
    expect(h1).toBe(h2);
  });

  it("returns different strings for different brand kits", () => {
    const h1 = brandKitHash(makeBrandKit({ primaryColor: "#aaa" }));
    const h2 = brandKitHash(makeBrandKit({ primaryColor: "#bbb" }));
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// buildR2Key — content-addressed key generation
// ---------------------------------------------------------------------------

describe("buildR2Key", () => {
  it("generates a key in the format {shop}/{productId}/{hash}.png", async () => {
    const bk = makeBrandKit();
    const { r2Key, hash } = await buildR2Key(
      "mystore.myshopify.com",
      "prod-123",
      "tmpl-abc",
      bk
    );
    expect(r2Key).toBe(`mystore.myshopify.com/prod-123/${hash}.png`);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same key for the same inputs (deterministic)", async () => {
    const bk = makeBrandKit();
    const { r2Key: k1 } = await buildR2Key("shop.myshopify.com", "p1", "t1", bk);
    const { r2Key: k2 } = await buildR2Key("shop.myshopify.com", "p1", "t1", bk);
    expect(k1).toBe(k2);
  });

  it("produces different keys when templateId changes", async () => {
    const bk = makeBrandKit();
    const { r2Key: k1 } = await buildR2Key("s.myshopify.com", "p1", "tmpl-A", bk);
    const { r2Key: k2 } = await buildR2Key("s.myshopify.com", "p1", "tmpl-B", bk);
    expect(k1).not.toBe(k2);
  });

  it("produces different keys when brandKit primaryColor changes", async () => {
    const bk1 = makeBrandKit({ primaryColor: "#111111" });
    const bk2 = makeBrandKit({ primaryColor: "#222222" });
    const { r2Key: k1 } = await buildR2Key("s.myshopify.com", "p1", "tmpl-X", bk1);
    const { r2Key: k2 } = await buildR2Key("s.myshopify.com", "p1", "tmpl-X", bk2);
    expect(k1).not.toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// findExistingImage
// ---------------------------------------------------------------------------

describe("findExistingImage", () => {
  it("returns null when no matching row exists", async () => {
    const db = makeD1(null);
    const result = await findExistingImage(
      "shop.myshopify.com",
      "prod-1",
      "tmpl-1",
      "abc123",
      db
    );
    expect(result).toBeNull();
  });

  it("returns the r2_key when a matching row is found", async () => {
    const db = makeD1({ r2_key: "shop/prod-1/abc123.png" });
    const result = await findExistingImage(
      "shop.myshopify.com",
      "prod-1",
      "tmpl-1",
      "abc123",
      db
    );
    expect(result).toBe("shop/prod-1/abc123.png");
  });
});

// ---------------------------------------------------------------------------
// writeSuccessRow
// ---------------------------------------------------------------------------

describe("writeSuccessRow", () => {
  it("calls D1 prepare with the correct parameters", async () => {
    const db = makeD1();
    await writeSuccessRow(
      "shop.myshopify.com",
      "prod-2",
      "tmpl-2",
      "shop.myshopify.com/prod-2/hash123.png",
      "hash123",
      db
    );

    expect(db.prepare).toHaveBeenCalledOnce();
    const prepareResult = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0];
    const bindMock = prepareResult?.value?.bind as ReturnType<typeof vi.fn>;
    expect(bindMock).toHaveBeenCalledWith(
      "shop.myshopify.com",
      "prod-2",
      "tmpl-2",
      "shop.myshopify.com/prod-2/hash123.png",
      "hash123"
    );
  });
});

// ---------------------------------------------------------------------------
// compositeAndStore — cache hit skips upload
// ---------------------------------------------------------------------------

describe("compositeAndStore — cache hit", () => {
  it("returns cacheHit=true and skips R2 upload when content hash already exists", async () => {
    const existingR2Key = "shop.myshopify.com/prod-1/existing.png";
    const bk = makeBrandKit();
    const { hash } = await buildR2Key("shop.myshopify.com", "prod-1", "tmpl-1", bk);

    // D1 returns the existing row with matching r2_key
    const db = makeD1({ r2_key: existingR2Key });
    const r2 = makeR2();
    const kv = makeKV();
    const env = makeEnv(r2, db, kv);

    const result = await compositeAndStore(
      "shop.myshopify.com",
      "prod-1",
      "tmpl-1",
      bk,
      fakePng(),
      fakePng(),
      env
    );

    expect(result.cacheHit).toBe(true);
    expect(result.r2Key).toBe(existingR2Key);
    expect(result.contentHash).toBe(hash);
    // R2 put must NOT have been called
    expect(r2.put).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// compositeAndStore — happy path (mocked OffscreenCanvas)
// ---------------------------------------------------------------------------

describe("compositeAndStore — upload path", () => {
  beforeEach(() => {
    // Mock OffscreenCanvas and createImageBitmap for test environment
    const mockCtx = {
      drawImage: vi.fn(),
    };
    const mockBitmap = {
      width: 400,
      height: 400,
      close: vi.fn(),
    };
    const mockBlob = {
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array(200).fill(1).buffer),
    };
    const mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockCtx),
      convertToBlob: vi.fn().mockResolvedValue(mockBlob),
    };

    vi.stubGlobal("OffscreenCanvas", vi.fn().mockImplementation(() => mockCanvas));
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue(mockBitmap)
    );
  });

  it("uploads to R2 with correct Cache-Control metadata", async () => {
    const bk = makeBrandKit();
    const r2 = makeR2();
    const db = makeD1(null); // no existing row → must upload
    const kv = makeKV();
    const env = makeEnv(r2, db, kv);

    await compositeAndStore(
      "shop.myshopify.com",
      "prod-3",
      "tmpl-3",
      bk,
      fakePng(),
      fakePng(),
      env
    );

    expect(r2.put).toHaveBeenCalledOnce();
    const call = (r2.put as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const opts = call[2] as { httpMetadata?: { contentType?: string; cacheControl?: string } } | undefined;
    expect(opts?.httpMetadata?.contentType).toBe("image/png");
    expect(opts?.httpMetadata?.cacheControl).toBe(R2_CACHE_CONTROL);
  });

  it("writes success row to D1 with r2Key and contentHash", async () => {
    const bk = makeBrandKit();
    const r2 = makeR2();
    const db = makeD1(null);
    const kv = makeKV();
    const env = makeEnv(r2, db, kv);

    const result = await compositeAndStore(
      "shop.myshopify.com",
      "prod-4",
      "tmpl-4",
      bk,
      fakePng(),
      fakePng(),
      env
    );

    expect(result.cacheHit).toBe(false);
    expect(result.r2Key).toContain("shop.myshopify.com/prod-4/");
    expect(result.r2Key).toMatch(/\.png$/);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // D1 prepare called at least twice (find + write)
    expect((db.prepare as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("increments the KV usage counter on success", async () => {
    const bk = makeBrandKit();
    const r2 = makeR2();
    const db = makeD1(null);
    const kv = makeKV();
    const env = makeEnv(r2, db, kv);

    await compositeAndStore(
      "shop.myshopify.com",
      "prod-5",
      "tmpl-5",
      bk,
      fakePng(),
      fakePng(),
      env
    );

    expect(kv.put).toHaveBeenCalled();
    const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls as [string, string, ...unknown[]][];
    const usagePut = putCalls.find((args) => typeof args[0] === "string" && args[0].startsWith("usage:"));
    expect(usagePut).toBeDefined();
    expect(usagePut?.[1]).toBe("1"); // first increment
  });

  it("returns cacheHit=false on a fresh upload", async () => {
    const bk = makeBrandKit();
    const env = makeEnv(makeR2(), makeD1(null), makeKV());

    const result = await compositeAndStore(
      "shop.myshopify.com",
      "prod-6",
      "tmpl-6",
      bk,
      fakePng(),
      fakePng(),
      env
    );

    expect(result.cacheHit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R2_CACHE_CONTROL constant
// ---------------------------------------------------------------------------

describe("R2_CACHE_CONTROL", () => {
  it("is the immutable long-lived cache directive", () => {
    expect(R2_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
  });
});
