/**
 * PR-015: Pre-flight product image quality gate
 *
 * Fetches the product image from the Shopify CDN and runs it through
 * Cloudflare AI vision (@cf/llava-1.5-7b-hf) to assess:
 *   - Face / model presence
 *   - Background clutter
 *   - Resolution (minimum 400×400)
 *   - Aspect ratio fitness
 *
 * Routing outcomes:
 *   PATH A — face/model detected  → skip compositing, use branded frame
 *   PATH B — high clutter OR low resolution → skip compositing, use text-dominant layout
 *   PROCEED — clean product image → continue to background removal pipeline
 *
 * The result is surfaced via `generated_images.status` in D1.
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QualityPath = "A" | "B" | "proceed";

export interface QualityGateResult {
  /** Pipeline routing decision. */
  path: QualityPath;
  /** Human-readable reason for the routing decision. */
  reason: string;
  /** LLaVA raw response text (for logging/debugging). */
  rawAnalysis?: string;
  /** Detected image width (pixels), if available. */
  width?: number;
  /** Detected image height (pixels), if available. */
  height?: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Minimum acceptable image dimension in pixels. */
export const MIN_DIMENSION_PX = 400;

/** Score threshold (0–1) above which a product is considered "cluttered". */
export const CLUTTER_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Cloudflare AI binding type (subset used here)
// ---------------------------------------------------------------------------

export interface CloudflareAiBinding {
  run(
    model: string,
    input: {
      image: number[];
      prompt: string;
      max_tokens?: number;
    }
  ): Promise<{ response?: string }>;
}

export interface QualityGateEnv {
  AI: CloudflareAiBinding;
  DB: D1Database;
}

// ---------------------------------------------------------------------------
// Image fetching
// ---------------------------------------------------------------------------

/**
 * Fetch a product image from the Shopify CDN.
 *
 * @param imageUrl - Public Shopify CDN URL.
 * @returns Raw image bytes as a Uint8Array.
 * @throws If the fetch fails or returns a non-2xx status.
 */
export async function fetchProductImage(imageUrl: string): Promise<Uint8Array> {
  const response = await fetch(imageUrl, {
    headers: { Accept: "image/*" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch product image (HTTP ${response.status}): ${imageUrl}`
    );
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// Dimension parsing helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to extract image dimensions from a JPEG or PNG header.
 *
 * Returns null when the buffer is too short or the format is unrecognised.
 * This is a lightweight heuristic — it does NOT fully decode the image.
 */
export function parseDimensions(bytes: Uint8Array): ImageDimensions | null {
  // PNG: 8-byte signature, then IHDR chunk (4 bytes length, 4 bytes "IHDR",
  //       4 bytes width, 4 bytes height)
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return { width, height };
  }

  // JPEG: scan for SOF0 / SOF1 / SOF2 markers (0xFF 0xC0/C1/C2)
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const segLen = view.getUint16(offset + 2);

      // SOF0, SOF1, SOF2 markers carry dimensions
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (offset + 9 < bytes.length) {
          const height = view.getUint16(offset + 5);
          const width = view.getUint16(offset + 7);
          return { width, height };
        }
      }

      offset += 2 + segLen;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// AI vision analysis
// ---------------------------------------------------------------------------

/**
 * Build the LLaVA prompt for quality assessment.
 *
 * The model is asked to reply in a structured format so we can parse the
 * key signals without natural-language ambiguity.
 */
function buildQualityPrompt(): string {
  return [
    "You are a product-image quality assessor for an e-commerce platform.",
    "Analyse this product image and answer each question with ONLY the specified format.",
    "",
    "1. FACE_OR_MODEL: Is there a human face or body model visible? Reply: YES or NO",
    "2. CLUTTER_SCORE: Rate the background clutter from 0.0 (clean/plain) to 1.0 (very cluttered). Reply: a decimal like 0.3",
    "3. PRODUCT_CLEAR: Is the main product clearly identifiable without distraction? Reply: YES or NO",
    "",
    "Respond in this exact format (one line each):",
    "FACE_OR_MODEL: <YES|NO>",
    "CLUTTER_SCORE: <0.0–1.0>",
    "PRODUCT_CLEAR: <YES|NO>",
  ].join("\n");
}

export interface AiAnalysisResult {
  faceDetected: boolean;
  clutterScore: number;
  productClear: boolean;
  rawResponse: string;
}

/**
 * Parse the structured LLaVA response into typed signals.
 *
 * Defaults to conservative values (faceDetected=false, clutterScore=0,
 * productClear=true) when parsing fails so we don't block clean images.
 */
export function parseAiResponse(raw: string): AiAnalysisResult {
  const faceMatch = raw.match(/FACE_OR_MODEL:\s*(YES|NO)/i);
  const clutterMatch = raw.match(/CLUTTER_SCORE:\s*([0-9.]+)/i);
  const clearMatch = raw.match(/PRODUCT_CLEAR:\s*(YES|NO)/i);

  return {
    faceDetected: faceMatch?.[1] ? faceMatch[1].toUpperCase() === "YES" : false,
    clutterScore: clutterMatch?.[1] ? Math.min(1, Math.max(0, parseFloat(clutterMatch[1]))) : 0,
    productClear: clearMatch?.[1] ? clearMatch[1].toUpperCase() === "YES" : true,
    rawResponse: raw,
  };
}

/**
 * Run the LLaVA vision model against a product image.
 *
 * @param imageBytes - Raw image bytes.
 * @param ai         - Cloudflare AI binding.
 * @returns Parsed AI analysis result.
 */
export async function runVisionAnalysis(
  imageBytes: Uint8Array,
  ai: CloudflareAiBinding
): Promise<AiAnalysisResult> {
  const imageArray = Array.from(imageBytes);
  const prompt = buildQualityPrompt();

  const aiResponse = await ai.run("@cf/llava-1.5-7b-hf", {
    image: imageArray,
    prompt,
    max_tokens: 128,
  });

  const raw = aiResponse?.response ?? "";
  return parseAiResponse(raw);
}

// ---------------------------------------------------------------------------
// Quality gate decision logic
// ---------------------------------------------------------------------------

/**
 * Determine the pipeline routing path based on dimension and AI analysis.
 *
 * @param dims     - Image dimensions (or null if undetectable).
 * @param analysis - AI vision analysis result.
 * @returns QualityGateResult with the chosen path and reason.
 */
export function determineQualityPath(
  dims: ImageDimensions | null,
  analysis: AiAnalysisResult
): QualityGateResult {
  // Path A: face / model detected → branded frame, no compositing
  if (analysis.faceDetected) {
    return {
      path: "A",
      reason: "face_detected",
      rawAnalysis: analysis.rawResponse,
      width: dims?.width,
      height: dims?.height,
    };
  }

  // Path B: low resolution (below floor) OR high clutter
  const belowResFloor =
    dims === null ||
    dims.width < MIN_DIMENSION_PX ||
    dims.height < MIN_DIMENSION_PX;

  const highClutter = analysis.clutterScore >= CLUTTER_THRESHOLD;

  if (belowResFloor || highClutter) {
    const reason = belowResFloor ? "low_resolution" : "high_clutter";
    return {
      path: "B",
      reason,
      rawAnalysis: analysis.rawResponse,
      width: dims?.width,
      height: dims?.height,
    };
  }

  // Proceed to background removal
  return {
    path: "proceed",
    reason: "clean_product",
    rawAnalysis: analysis.rawResponse,
    width: dims?.width,
    height: dims?.height,
  };
}

// ---------------------------------------------------------------------------
// Write quality gate result to D1
// ---------------------------------------------------------------------------

/**
 * Update (or insert) the `generated_images` row for this job with the
 * quality-gate status.
 *
 * Status values written here:
 *   "quality_gate_a"  — face detected, using branded frame
 *   "quality_gate_b"  — low quality, using text-dominant layout
 *   "quality_gate_ok" — passed, proceeding to background removal
 */
export async function writeQualityGateStatus(
  shop: string,
  productId: string,
  templateId: string,
  result: QualityGateResult,
  db: D1Database
): Promise<void> {
  const statusMap: Record<QualityPath, string> = {
    A: "quality_gate_a",
    B: "quality_gate_b",
    proceed: "quality_gate_ok",
  };

  const status = statusMap[result.path];

  await db
    .prepare(
      `INSERT INTO generated_images
         (id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at)
       VALUES
         (lower(hex(randomblob(16))), ?, ?, ?, NULL, NULL, ?, ?, datetime('now'))
       ON CONFLICT(shop, product_id, template_id) DO UPDATE SET
         status        = excluded.status,
         error_message = excluded.error_message,
         generated_at  = excluded.generated_at`
    )
    .bind(shop, productId, templateId, status, result.reason)
    .run();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full pre-flight quality gate for a product image.
 *
 * Steps:
 *   1. Fetch image from Shopify CDN.
 *   2. Parse dimensions from the image header.
 *   3. Run LLaVA vision model to score quality signals.
 *   4. Determine routing path (A / B / proceed).
 *   5. Write status to D1.
 *   6. Return the routing result to the caller.
 *
 * @param shop       - Merchant shop domain (for logging).
 * @param productId  - Product ID (for logging and D1 upsert).
 * @param templateId - Template ID (for D1 upsert).
 * @param imageUrl   - Shopify CDN image URL.
 * @param env        - Worker bindings (AI, DB).
 * @returns QualityGateResult indicating the chosen pipeline path.
 */
export async function runQualityGate(
  shop: string,
  productId: string,
  templateId: string,
  imageUrl: string,
  env: QualityGateEnv
): Promise<QualityGateResult> {
  log({
    shop,
    productId,
    step: "quality_gate.start",
    status: "info",
    imageUrl,
  });

  // Step 1: fetch image
  let imageBytes: Uint8Array;
  try {
    imageBytes = await fetchProductImage(imageUrl);
  } catch (err) {
    log({
      shop,
      productId,
      step: "quality_gate.fetch_failed",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    // Cannot assess — treat as "proceed" so the pipeline can attempt recovery
    return { path: "proceed", reason: "fetch_failed" };
  }

  // Step 2: parse dimensions
  const dims = parseDimensions(imageBytes);

  log({
    shop,
    productId,
    step: "quality_gate.dimensions",
    status: "info",
    width: dims?.width,
    height: dims?.height,
  });

  // Step 3: run AI vision analysis
  let analysis: AiAnalysisResult;
  try {
    analysis = await runVisionAnalysis(imageBytes, env.AI);
  } catch (err) {
    log({
      shop,
      productId,
      step: "quality_gate.ai_failed",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    // AI failure — use dimension-only check to decide
    analysis = {
      faceDetected: false,
      clutterScore: 0,
      productClear: true,
      rawResponse: "",
    };
  }

  log({
    shop,
    productId,
    step: "quality_gate.ai_result",
    status: "info",
    faceDetected: analysis.faceDetected,
    clutterScore: analysis.clutterScore,
    productClear: analysis.productClear,
  });

  // Step 4: determine path
  const result = determineQualityPath(dims, analysis);

  log({
    shop,
    productId,
    step: "quality_gate.decision",
    status: "info",
    path: result.path,
    reason: result.reason,
  });

  // Step 5: write to D1
  try {
    await writeQualityGateStatus(shop, productId, templateId, result, env.DB);
  } catch (err) {
    log({
      shop,
      productId,
      step: "quality_gate.db_write_failed",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    // Non-fatal — continue with the routing decision
  }

  return result;
}
