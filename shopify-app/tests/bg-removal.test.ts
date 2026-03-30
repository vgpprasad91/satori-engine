/**
 * Tests for PR-016: Background removal — Remove.bg and Cloudflare AI rembg
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  rateLimitKey,
  consumeRateLimitToken,
  getRateLimitCount,
  callRemoveBg,
  callCfRembg,
  buildNeutralBackgroundPng,
  removeBackground,
  REMOVEBG_CONFIDENCE_THRESHOLD,
  REMOVEBG_RATE_LIMIT_PER_MINUTE,
  NEUTRAL_BG_COLORS,
  type BgRemovalEnv,
  type CloudflareAiBinding,
} from "../src/bg-removal.server.js";

// ---------------------------------------------------------------------------
// KV mock factory
// ---------------------------------------------------------------------------

function makeKv(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: store.get(key) ?? null,
      metadata: null,
      cacheStatus: null,
    })),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// Rate limiter tests
// ---------------------------------------------------------------------------

describe("rateLimitKey", () => {
  it("returns key with minute-level granularity", () => {
    const now = new Date("2026-03-12T15:04:32.000Z");
    expect(rateLimitKey(now)).toBe("ratelimit:removebg:2026-03-12T15:04");
  });

  it("produces a different key for a different minute", () => {
    const a = new Date("2026-03-12T15:04:00.000Z");
    const b = new Date("2026-03-12T15:05:00.000Z");
    expect(rateLimitKey(a)).not.toBe(rateLimitKey(b));
  });
});

describe("consumeRateLimitToken", () => {
  it("allows calls below the per-minute limit", async () => {
    const kv = makeKv();
    const now = new Date("2026-03-12T10:00:00Z");

    for (let i = 0; i < REMOVEBG_RATE_LIMIT_PER_MINUTE; i++) {
      const allowed = await consumeRateLimitToken(kv, now);
      expect(allowed).toBe(true);
    }
  });

  it("blocks the (limit+1)th call in the same minute", async () => {
    const now = new Date("2026-03-12T10:00:00Z");
    const key = rateLimitKey(now);
    // Pre-fill the bucket to the limit
    const kv = makeKv({ [key]: String(REMOVEBG_RATE_LIMIT_PER_MINUTE) });

    const allowed = await consumeRateLimitToken(kv, now);
    expect(allowed).toBe(false);
  });

  it("increments the counter on successful token consumption", async () => {
    const now = new Date("2026-03-12T10:00:00Z");
    const kv = makeKv();

    await consumeRateLimitToken(kv, now);
    const count = await getRateLimitCount(kv, now);
    expect(count).toBe(1);
  });

  it("TTL expiry allows reprocessing in next minute", async () => {
    const minute1 = new Date("2026-03-12T10:00:00Z");
    const minute2 = new Date("2026-03-12T10:01:00Z");
    const kv = makeKv({ [rateLimitKey(minute1)]: String(REMOVEBG_RATE_LIMIT_PER_MINUTE) });

    // Minute 1: blocked
    expect(await consumeRateLimitToken(kv, minute1)).toBe(false);
    // Minute 2: fresh bucket
    expect(await consumeRateLimitToken(kv, minute2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Remove.bg integration tests
// ---------------------------------------------------------------------------

describe("callRemoveBg", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns high confidence on success with foreground headers", async () => {
    const fakeImage = new Uint8Array([0xff, 0xd8, 0xff]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: {
          get: (key: string) => {
            const m: Record<string, string> = {
              "X-Foreground-Width": "800",
              "X-Foreground-Height": "800",
              "X-Image-Width": "1000",
              "X-Image-Height": "1000",
            };
            return m[key] ?? null;
          },
        },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }))
    );

    const result = await callRemoveBg(fakeImage, "test-key");
    expect(result.confidence).toBeCloseTo(0.64, 2); // 800*800 / 1000*1000
    expect(result.imageBytes.length).toBeGreaterThan(0);
  });

  it("defaults to confidence=1.0 when foreground headers absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
      }))
    );

    const result = await callRemoveBg(new Uint8Array([0]), "key");
    expect(result.confidence).toBe(1.0);
  });

  it("throws on non-2xx HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        text: async () => "Insufficient credits",
      }))
    );

    await expect(callRemoveBg(new Uint8Array([0]), "key")).rejects.toThrow(
      "Remove.bg API error (HTTP 402)"
    );
  });
});

// ---------------------------------------------------------------------------
// Cloudflare AI rembg fallback tests
// ---------------------------------------------------------------------------

describe("callCfRembg", () => {
  it("returns Uint8Array from base64-encoded image response", async () => {
    const pixelBytes = new Uint8Array([1, 2, 3, 4]);
    const b64 = btoa(String.fromCharCode(...pixelBytes));

    const ai: CloudflareAiBinding = {
      run: vi.fn(async () => ({ image: b64 })),
    };

    const result = await callCfRembg(new Uint8Array([0]), ai);
    expect(result).toEqual(pixelBytes);
  });

  it("returns Uint8Array when output is raw bytes", async () => {
    const rawBytes = new Uint8Array([9, 8, 7]);
    const ai: CloudflareAiBinding = {
      run: vi.fn(async () => ({ output: rawBytes })),
    };

    const result = await callCfRembg(new Uint8Array([0]), ai);
    expect(result).toEqual(rawBytes);
  });

  it("throws when response is empty", async () => {
    const ai: CloudflareAiBinding = {
      run: vi.fn(async () => ({})),
    };

    await expect(callCfRembg(new Uint8Array([0]), ai)).rejects.toThrow(
      "@cf/inspyrenet/rembg returned an empty or unrecognised response"
    );
  });
});

// ---------------------------------------------------------------------------
// Neutral background fallback tests
// ---------------------------------------------------------------------------

describe("buildNeutralBackgroundPng", () => {
  it("returns non-empty bytes for marble preset", () => {
    const bytes = buildNeutralBackgroundPng("marble");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("embeds the correct RGB values for linen", () => {
    const bytes = buildNeutralBackgroundPng("linen");
    const hex = NEUTRAL_BG_COLORS["linen"].replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    // Find the pixel bytes in the PNG — they appear after the deflate literal marker 0x63
    const idx = Array.from(bytes).findIndex((v) => v === 0x63);
    expect(idx).toBeGreaterThan(-1);
    expect(bytes[idx + 1]).toBe(r);
    expect(bytes[idx + 2]).toBe(g);
    expect(bytes[idx + 3]).toBe(b);
  });

  it("returns different byte sequences for different presets", () => {
    const marble = buildNeutralBackgroundPng("marble");
    const slate = buildNeutralBackgroundPng("slate");
    expect(marble).not.toEqual(slate);
  });
});

// ---------------------------------------------------------------------------
// Main removeBackground pipeline tests
// ---------------------------------------------------------------------------

describe("removeBackground", () => {
  const dummyImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header

  function makeEnv(overrides: Partial<BgRemovalEnv> = {}): BgRemovalEnv {
    return {
      KV_STORE: makeKv(),
      AI: { run: vi.fn(async () => ({})) } as unknown as CloudflareAiBinding,
      REMOVEBG_API_KEY: "test-api-key",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Remove.bg when confidence >= threshold", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null }, // defaults to confidence=1.0
        arrayBuffer: async () => new Uint8Array([10, 20, 30]).buffer,
      }))
    );

    const env = makeEnv();
    const result = await removeBackground("shop.myshopify.com", "prod-1", dummyImageBytes, env);

    expect(result.strategy).toBe("removebg");
    expect(result.confidence).toBe(1.0);
  });

  it("falls back to cf_rembg when Remove.bg confidence is below threshold", async () => {
    // Remove.bg returns low confidence (small foreground)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: {
          get: (key: string) => {
            const m: Record<string, string> = {
              "X-Foreground-Width": "10",
              "X-Foreground-Height": "10",
              "X-Image-Width": "1000",
              "X-Image-Height": "1000",
            };
            return m[key] ?? null;
          },
        },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      }))
    );

    const cfBytes = new Uint8Array([99, 88, 77]);
    const b64 = btoa(String.fromCharCode(...cfBytes));
    const ai: CloudflareAiBinding = { run: vi.fn(async () => ({ image: b64 })) };
    const env = makeEnv({ AI: ai });

    const result = await removeBackground("shop.myshopify.com", "prod-2", dummyImageBytes, env);

    // confidence = 10*10 / 1000*1000 = 0.0001 < 0.75
    expect(result.strategy).toBe("cf_rembg");
    expect(result.imageBytes).toEqual(cfBytes);
  });

  it("falls back to cf_rembg when Remove.bg API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      }))
    );

    const cfBytes = new Uint8Array([55, 66]);
    const b64 = btoa(String.fromCharCode(...cfBytes));
    const ai: CloudflareAiBinding = { run: vi.fn(async () => ({ image: b64 })) };
    const env = makeEnv({ AI: ai });

    const result = await removeBackground("shop.myshopify.com", "prod-3", dummyImageBytes, env);

    expect(result.strategy).toBe("cf_rembg");
  });

  it("falls back to neutral_fallback when both Remove.bg and cf_rembg fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "Error",
      }))
    );

    const ai: CloudflareAiBinding = {
      run: vi.fn(async () => { throw new Error("AI unavailable"); }),
    };
    const env = makeEnv({ AI: ai });

    const result = await removeBackground("shop.myshopify.com", "prod-4", dummyImageBytes, env);

    expect(result.strategy).toBe("neutral_fallback");
    expect(result.neutralPreset).toBeDefined();
    expect(result.imageBytes.length).toBeGreaterThan(0);
  });

  it("skips Remove.bg and uses cf_rembg when rate limit is exhausted", async () => {
    const now = new Date("2026-03-12T10:00:00Z");
    const key = rateLimitKey(now);
    // Pre-fill the rate limit bucket
    const kv = makeKv({ [key]: String(REMOVEBG_RATE_LIMIT_PER_MINUTE) });

    const cfBytes = new Uint8Array([77, 88]);
    const b64 = btoa(String.fromCharCode(...cfBytes));
    const ai: CloudflareAiBinding = { run: vi.fn(async () => ({ image: b64 })) };
    const env = makeEnv({ KV_STORE: kv, AI: ai });

    // fetch should NOT be called because rate limit is exceeded
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await removeBackground("shop.myshopify.com", "prod-5", dummyImageBytes, env, now);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.strategy).toBe("cf_rembg");
    expect(result.imageBytes).toEqual(cfBytes);
  });

  it("rate limiter enforces the per-minute cap correctly", async () => {
    const now = new Date("2026-03-12T11:00:00Z");
    // Each Remove.bg call succeeds
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      }))
    );

    const kv = makeKv();
    const env = makeEnv({ KV_STORE: kv });

    // Fill the bucket
    for (let i = 0; i < REMOVEBG_RATE_LIMIT_PER_MINUTE; i++) {
      const r = await removeBackground("s.myshopify.com", `p-${i}`, dummyImageBytes, env, now);
      expect(r.strategy).toBe("removebg");
    }

    // The (limit+1)th call must NOT hit Remove.bg
    const cfBytes = new Uint8Array([42]);
    const b64 = btoa(String.fromCharCode(...cfBytes));
    env.AI = { run: vi.fn(async () => ({ image: b64 })) } as unknown as CloudflareAiBinding;

    const r = await removeBackground("s.myshopify.com", "p-over", dummyImageBytes, env, now);
    expect(r.strategy).toBe("cf_rembg");
  });

  it("neutral background fallback renders a valid preset name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })));
    const ai: CloudflareAiBinding = {
      run: vi.fn(async () => { throw new Error("fail"); }),
    };
    const env = makeEnv({ AI: ai });

    const result = await removeBackground("s.myshopify.com", "p-x", dummyImageBytes, env);

    expect(["marble", "linen", "slate"]).toContain(result.neutralPreset);
  });

  it("confidence threshold boundary: exactly 0.75 is accepted", async () => {
    // confidence = sqrt(0.75) squared coverage — build exact coverage headers
    // 0.75 = fgW*fgH / imgW*imgH → e.g. 750*1000 / 1000*1000 = 0.75
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: {
          get: (key: string) => {
            const m: Record<string, string> = {
              "X-Foreground-Width": "750",
              "X-Foreground-Height": "1000",
              "X-Image-Width": "1000",
              "X-Image-Height": "1000",
            };
            return m[key] ?? null;
          },
        },
        arrayBuffer: async () => new Uint8Array([200]).buffer,
      }))
    );

    const env = makeEnv();
    const result = await removeBackground("s.myshopify.com", "p-boundary", dummyImageBytes, env);

    expect(result.strategy).toBe("removebg");
    expect(result.confidence).toBeCloseTo(REMOVEBG_CONFIDENCE_THRESHOLD, 2);
  });
});
