/**
 * PR-015: Pre-flight product image quality gate — unit tests
 *
 * Covers:
 *   - Face detection → fallback path A
 *   - Low-resolution image → fallback path B
 *   - High-clutter image → fallback path B
 *   - Clean product image → proceed
 *   - PNG / JPEG dimension parsing
 *   - AI response parsing (structured format)
 *   - AI failure → dimension-only fallback
 *   - Image fetch failure → graceful proceed
 *   - D1 status values (quality_gate_a / quality_gate_b / quality_gate_ok)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseAiResponse,
  parseDimensions,
  determineQualityPath,
  runQualityGate,
  writeQualityGateStatus,
  fetchProductImage,
  runVisionAnalysis,
  MIN_DIMENSION_PX,
  CLUTTER_THRESHOLD,
  type QualityGateEnv,
  type ImageDimensions,
  type AiAnalysisResult,
} from "../src/quality-gate.server.js";

// ---------------------------------------------------------------------------
// Helpers — build minimal fake binary headers
// ---------------------------------------------------------------------------

function makePngBytes(width: number, height: number): Uint8Array {
  // Minimal PNG: 8-byte signature + IHDR chunk (25 bytes)
  const buf = new Uint8Array(25);
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  // IHDR chunk length = 13
  buf[8] = 0; buf[9] = 0; buf[10] = 0; buf[11] = 13;
  // "IHDR"
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52;
  // Width (big-endian uint32)
  const view = new DataView(buf.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buf;
}

function makeJpegBytes(width: number, height: number): Uint8Array {
  // Minimal JPEG: SOI (0xFF 0xD8) + SOF0 marker
  // SOF0 format: 0xFF 0xC0, 2-byte seg length, 1-byte precision,
  //              2-byte height, 2-byte width, 1-byte components
  const buf = new Uint8Array(20);
  // SOI
  buf[0] = 0xff; buf[1] = 0xd8;
  // SOF0 marker
  buf[2] = 0xff; buf[3] = 0xc0;
  // Segment length = 11
  const view = new DataView(buf.buffer);
  view.setUint16(4, 11);
  // Precision byte
  buf[6] = 8;
  // Height
  view.setUint16(7, height);
  // Width
  view.setUint16(9, width);
  return buf;
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeAiBinding(response: string) {
  return {
    run: vi.fn().mockResolvedValue({ response }),
  };
}

function makeDb() {
  const runMock = vi.fn().mockResolvedValue({ success: true });
  const bindMock = vi.fn().mockReturnValue({ run: runMock });
  const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
  return {
    prepare: prepareMock,
    _runMock: runMock,
  } as unknown as D1Database & { _runMock: ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// parseDimensions
// ---------------------------------------------------------------------------

describe("parseDimensions", () => {
  it("correctly parses PNG dimensions", () => {
    const bytes = makePngBytes(800, 600);
    const result = parseDimensions(bytes);
    expect(result).toEqual({ width: 800, height: 600 });
  });

  it("correctly parses JPEG dimensions", () => {
    const bytes = makeJpegBytes(1024, 768);
    const result = parseDimensions(bytes);
    expect(result).toEqual({ width: 1024, height: 768 });
  });

  it("returns null for an empty buffer", () => {
    expect(parseDimensions(new Uint8Array(0))).toBeNull();
  });

  it("returns null for an unrecognised format", () => {
    const buf = new Uint8Array(20).fill(0x42);
    expect(parseDimensions(buf)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseAiResponse
// ---------------------------------------------------------------------------

describe("parseAiResponse", () => {
  it("parses a well-formed response with face detected", () => {
    const raw = "FACE_OR_MODEL: YES\nCLUTTER_SCORE: 0.3\nPRODUCT_CLEAR: YES";
    const result = parseAiResponse(raw);
    expect(result.faceDetected).toBe(true);
    expect(result.clutterScore).toBe(0.3);
    expect(result.productClear).toBe(true);
  });

  it("parses a response with no face and high clutter", () => {
    const raw = "FACE_OR_MODEL: NO\nCLUTTER_SCORE: 0.85\nPRODUCT_CLEAR: NO";
    const result = parseAiResponse(raw);
    expect(result.faceDetected).toBe(false);
    expect(result.clutterScore).toBe(0.85);
    expect(result.productClear).toBe(false);
  });

  it("defaults to safe values on empty / garbage response", () => {
    const result = parseAiResponse("garbage output from model");
    expect(result.faceDetected).toBe(false);
    expect(result.clutterScore).toBe(0);
    expect(result.productClear).toBe(true);
  });

  it("clamps clutterScore to [0, 1]", () => {
    const raw = "FACE_OR_MODEL: NO\nCLUTTER_SCORE: 1.5\nPRODUCT_CLEAR: YES";
    const result = parseAiResponse(raw);
    expect(result.clutterScore).toBe(1);
  });

  it("is case-insensitive for YES/NO tokens", () => {
    const raw = "FACE_OR_MODEL: yes\nCLUTTER_SCORE: 0.2\nPRODUCT_CLEAR: no";
    const result = parseAiResponse(raw);
    expect(result.faceDetected).toBe(true);
    expect(result.productClear).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// determineQualityPath
// ---------------------------------------------------------------------------

describe("determineQualityPath", () => {
  const okDims: ImageDimensions = { width: 800, height: 800 };

  it("routes to PATH A when face is detected (regardless of clutter)", () => {
    const analysis: AiAnalysisResult = {
      faceDetected: true,
      clutterScore: 0.1,
      productClear: true,
      rawResponse: "",
    };
    const result = determineQualityPath(okDims, analysis);
    expect(result.path).toBe("A");
    expect(result.reason).toBe("face_detected");
  });

  it("routes to PATH A when face detected AND clutter is high", () => {
    const analysis: AiAnalysisResult = {
      faceDetected: true,
      clutterScore: 0.9,
      productClear: false,
      rawResponse: "",
    };
    const result = determineQualityPath(okDims, analysis);
    expect(result.path).toBe("A");
  });

  it("routes to PATH B when image width is below MIN_DIMENSION_PX", () => {
    const dims: ImageDimensions = { width: MIN_DIMENSION_PX - 1, height: 800 };
    const analysis: AiAnalysisResult = {
      faceDetected: false,
      clutterScore: 0.1,
      productClear: true,
      rawResponse: "",
    };
    const result = determineQualityPath(dims, analysis);
    expect(result.path).toBe("B");
    expect(result.reason).toBe("low_resolution");
  });

  it("routes to PATH B when image height is below MIN_DIMENSION_PX", () => {
    const dims: ImageDimensions = { width: 800, height: MIN_DIMENSION_PX - 1 };
    const analysis: AiAnalysisResult = {
      faceDetected: false,
      clutterScore: 0.1,
      productClear: true,
      rawResponse: "",
    };
    const result = determineQualityPath(dims, analysis);
    expect(result.path).toBe("B");
    expect(result.reason).toBe("low_resolution");
  });

  it("routes to PATH B when dims are null (undetectable resolution)", () => {
    const analysis: AiAnalysisResult = {
      faceDetected: false,
      clutterScore: 0.1,
      productClear: true,
      rawResponse: "",
    };
    const result = determineQualityPath(null, analysis);
    expect(result.path).toBe("B");
    expect(result.reason).toBe("low_resolution");
  });

  it("routes to PATH B when clutter score meets or exceeds CLUTTER_THRESHOLD", () => {
    const analysis: AiAnalysisResult = {
      faceDetected: false,
      clutterScore: CLUTTER_THRESHOLD,
      productClear: false,
      rawResponse: "",
    };
    const result = determineQualityPath(okDims, analysis);
    expect(result.path).toBe("B");
    expect(result.reason).toBe("high_clutter");
  });

  it("proceeds when image is clean, adequate resolution, no face", () => {
    const dims: ImageDimensions = { width: MIN_DIMENSION_PX, height: MIN_DIMENSION_PX };
    const analysis: AiAnalysisResult = {
      faceDetected: false,
      clutterScore: CLUTTER_THRESHOLD - 0.01,
      productClear: true,
      rawResponse: "",
    };
    const result = determineQualityPath(dims, analysis);
    expect(result.path).toBe("proceed");
    expect(result.reason).toBe("clean_product");
  });

  it("includes dimensions in the result", () => {
    const dims: ImageDimensions = { width: 1000, height: 1000 };
    const analysis: AiAnalysisResult = {
      faceDetected: false,
      clutterScore: 0.1,
      productClear: true,
      rawResponse: "raw",
    };
    const result = determineQualityPath(dims, analysis);
    expect(result.width).toBe(1000);
    expect(result.height).toBe(1000);
    expect(result.rawAnalysis).toBe("raw");
  });
});

// ---------------------------------------------------------------------------
// writeQualityGateStatus
// ---------------------------------------------------------------------------

describe("writeQualityGateStatus", () => {
  it("writes quality_gate_a status for path A", async () => {
    const db = makeDb();
    await writeQualityGateStatus("shop.myshopify.com", "prod_1", "tmpl_1", {
      path: "A",
      reason: "face_detected",
    }, db as unknown as D1Database);

    const prepareMock = (db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
    const callArgs = prepareMock.mock.calls[0]?.[0] as string;
    expect(callArgs).toContain("INSERT INTO generated_images");
    // Check bind was called with the correct status
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const bindArgs = prepareMock.mock.results[0]!.value.bind.mock.calls[0] as unknown[];
    expect(bindArgs).toContain("quality_gate_a");
  });

  it("writes quality_gate_b status for path B", async () => {
    const db = makeDb();
    await writeQualityGateStatus("shop.myshopify.com", "prod_1", "tmpl_1", {
      path: "B",
      reason: "low_resolution",
    }, db as unknown as D1Database);

    const prepareMock = (db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
    const bindArgs = prepareMock.mock.results[0]!.value.bind.mock.calls[0] as unknown[];
    expect(bindArgs).toContain("quality_gate_b");
  });

  it("writes quality_gate_ok status for proceed path", async () => {
    const db = makeDb();
    await writeQualityGateStatus("shop.myshopify.com", "prod_1", "tmpl_1", {
      path: "proceed",
      reason: "clean_product",
    }, db as unknown as D1Database);

    const prepareMock = (db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
    const bindArgs = prepareMock.mock.results[0]!.value.bind.mock.calls[0] as unknown[];
    expect(bindArgs).toContain("quality_gate_ok");
  });
});

// ---------------------------------------------------------------------------
// fetchProductImage
// ---------------------------------------------------------------------------

describe("fetchProductImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns image bytes on successful fetch", async () => {
    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(fakeBytes.buffer),
    });

    const result = await fetchProductImage("https://cdn.shopify.com/image.jpg");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toHaveLength(4);
  });

  it("throws when fetch returns non-2xx status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(
      fetchProductImage("https://cdn.shopify.com/missing.jpg")
    ).rejects.toThrow("HTTP 404");
  });
});

// ---------------------------------------------------------------------------
// runVisionAnalysis
// ---------------------------------------------------------------------------

describe("runVisionAnalysis", () => {
  it("calls the LLaVA model and parses the response", async () => {
    const ai = makeAiBinding(
      "FACE_OR_MODEL: NO\nCLUTTER_SCORE: 0.2\nPRODUCT_CLEAR: YES"
    );
    const bytes = new Uint8Array([0xff, 0xd8]); // minimal JPEG marker

    const result = await runVisionAnalysis(bytes, ai);

    expect(ai.run).toHaveBeenCalledWith(
      "@cf/llava-1.5-7b-hf",
      expect.objectContaining({
        image: expect.any(Array),
        prompt: expect.stringContaining("FACE_OR_MODEL"),
      })
    );
    expect(result.faceDetected).toBe(false);
    expect(result.clutterScore).toBe(0.2);
  });

  it("handles empty AI response gracefully", async () => {
    const ai = makeAiBinding("");
    const bytes = new Uint8Array([0]);

    const result = await runVisionAnalysis(bytes, ai);
    expect(result.faceDetected).toBe(false);
    expect(result.clutterScore).toBe(0);
    expect(result.productClear).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runQualityGate — integration-style tests
// ---------------------------------------------------------------------------

describe("runQualityGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeEnv(aiResponse: string): QualityGateEnv {
    return {
      AI: makeAiBinding(aiResponse),
      DB: makeDb() as unknown as D1Database,
    };
  }

  it("returns path A when AI detects a face (fallback path A)", async () => {
    const pngBytes = makePngBytes(800, 800);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(pngBytes.buffer),
    });

    const env = makeEnv("FACE_OR_MODEL: YES\nCLUTTER_SCORE: 0.1\nPRODUCT_CLEAR: YES");
    const result = await runQualityGate(
      "shop.myshopify.com", "prod_1", "tmpl_1",
      "https://cdn.shopify.com/product.png", env
    );

    expect(result.path).toBe("A");
    expect(result.reason).toBe("face_detected");
  });

  it("returns path B for a low-resolution image (fallback path B)", async () => {
    // 200×200 PNG — below the 400px floor
    const pngBytes = makePngBytes(200, 200);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(pngBytes.buffer),
    });

    const env = makeEnv("FACE_OR_MODEL: NO\nCLUTTER_SCORE: 0.1\nPRODUCT_CLEAR: YES");
    const result = await runQualityGate(
      "shop.myshopify.com", "prod_2", "tmpl_1",
      "https://cdn.shopify.com/small.png", env
    );

    expect(result.path).toBe("B");
    expect(result.reason).toBe("low_resolution");
  });

  it("returns path B when clutter score is at or above threshold", async () => {
    const pngBytes = makePngBytes(800, 800);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(pngBytes.buffer),
    });

    const env = makeEnv(`FACE_OR_MODEL: NO\nCLUTTER_SCORE: ${CLUTTER_THRESHOLD}\nPRODUCT_CLEAR: NO`);
    const result = await runQualityGate(
      "shop.myshopify.com", "prod_3", "tmpl_1",
      "https://cdn.shopify.com/cluttered.png", env
    );

    expect(result.path).toBe("B");
    expect(result.reason).toBe("high_clutter");
  });

  it("returns proceed for a clean product image", async () => {
    const pngBytes = makePngBytes(800, 800);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(pngBytes.buffer),
    });

    const env = makeEnv("FACE_OR_MODEL: NO\nCLUTTER_SCORE: 0.1\nPRODUCT_CLEAR: YES");
    const result = await runQualityGate(
      "shop.myshopify.com", "prod_4", "tmpl_1",
      "https://cdn.shopify.com/clean.png", env
    );

    expect(result.path).toBe("proceed");
    expect(result.reason).toBe("clean_product");
  });

  it("returns proceed (graceful) when image fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const env = makeEnv("");
    const result = await runQualityGate(
      "shop.myshopify.com", "prod_5", "tmpl_1",
      "https://cdn.shopify.com/missing.png", env
    );

    // Fetch failure must not crash; we fail open
    expect(result.path).toBe("proceed");
    expect(result.reason).toBe("fetch_failed");
  });

  it("falls back to dimension-only check when AI model throws", async () => {
    // Below-resolution PNG so dimension check triggers path B
    const pngBytes = makePngBytes(100, 100);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(pngBytes.buffer),
    });

    const env: QualityGateEnv = {
      AI: { run: vi.fn().mockRejectedValue(new Error("AI unavailable")) },
      DB: makeDb() as unknown as D1Database,
    };

    const result = await runQualityGate(
      "shop.myshopify.com", "prod_6", "tmpl_1",
      "https://cdn.shopify.com/tiny.png", env
    );

    // Dimension check fires because AI failed → path B (low_resolution)
    expect(result.path).toBe("B");
  });

  it("writes the correct status to D1", async () => {
    const pngBytes = makePngBytes(800, 800);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(pngBytes.buffer),
    });

    const db = makeDb();
    const env: QualityGateEnv = {
      AI: makeAiBinding("FACE_OR_MODEL: YES\nCLUTTER_SCORE: 0.1\nPRODUCT_CLEAR: YES"),
      DB: db as unknown as D1Database,
    };

    await runQualityGate(
      "shop.myshopify.com", "prod_7", "tmpl_1",
      "https://cdn.shopify.com/product.png", env
    );

    // D1 prepare must have been called at least once (for status write)
    const prepareMock = (db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
    expect(prepareMock).toHaveBeenCalled();
    const bindArgs = prepareMock.mock.results[0]!.value.bind.mock.calls[0] as unknown[];
    expect(bindArgs).toContain("quality_gate_a");
  });
});
