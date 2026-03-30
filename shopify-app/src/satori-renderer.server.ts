/**
 * PR-017: Satori renderer service binding integration
 *
 * Calls the existing `mailcraft-satori` Worker via Cloudflare service binding
 * from the Queue consumer.
 *
 * Request payload sent to satori Worker:
 *   POST /render   (JSON body)
 *   {
 *     templateId:     string          — Satori template ID
 *     productTitle:   string          — Product title for overlay text
 *     price:          string          — Currency-formatted price string, e.g. "$29.99"
 *     locale:         "ltr" | "rtl"  — Text direction derived from BCP-47 locale
 *     primaryColor:   string          — Brand primary colour hex, e.g. "#1a73e8"
 *     logoR2Key?:     string          — R2 key for merchant logo PNG (optional)
 *     fontFamily?:    string          — Font family name (optional)
 *   }
 *
 * Successful response: PNG bytes as ArrayBuffer (Content-Type: image/png)
 *
 * Timeout: 10 seconds — if the service binding does not respond within 10 s,
 *          the caller should write `renderer_timeout` to D1.
 *
 * RTL locale detection re-uses the existing isRTL() utility from locale.server.ts.
 */

import { log } from "./logger.js";
import { isRTL } from "./locale.server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Text direction token passed to the Satori renderer. */
export type LocaleDirection = "ltr" | "rtl";

/** Service binding interface for the mailcraft-satori Worker. */
export interface SatoriBinding {
  fetch(request: Request): Promise<Response>;
}

/** Caller-facing result from callSatoriRenderer(). */
export interface SatoriRenderResult {
  /** PNG bytes of the rendered layout layer. */
  imageBuffer: ArrayBuffer;
  /** Locale direction that was sent to the renderer. */
  direction: LocaleDirection;
  /** Duration of the service binding call in milliseconds. */
  durationMs: number;
}

/** Environment bindings required by this module. */
export interface SatoriRendererEnv {
  /** Cloudflare service binding to the mailcraft-satori Worker. */
  SATORI_RENDERER: SatoriBinding;
  /** D1 database for writing renderer_timeout status. */
  DB: D1Database;
}

// ---------------------------------------------------------------------------
// Currency formatting
// ---------------------------------------------------------------------------

/**
 * Format a numeric price into a currency string using the merchant's
 * stored currency format template.
 *
 * The Shopify `moneyFormat` string uses `{{amount}}` as a placeholder,
 * e.g. "${{amount}}" → "$29.99" or "{{amount}} €" → "29.99 €".
 *
 * If the template does not contain `{{amount}}`, the raw amount string is
 * returned as-is (fail-safe).
 *
 * @param amount         - Numeric price (e.g. 29.99).
 * @param currencyFormat - Shopify moneyFormat template string.
 * @returns Formatted price string.
 */
export function formatCurrencyString(
  amount: number,
  currencyFormat: string
): string {
  if (!currencyFormat.includes("{{amount}}")) {
    return String(amount);
  }
  const formatted = amount.toFixed(2);
  return currencyFormat.replace("{{amount}}", formatted);
}

// ---------------------------------------------------------------------------
// Locale direction
// ---------------------------------------------------------------------------

/**
 * Convert a BCP-47 locale code to a Satori locale direction token.
 *
 * @param locale - BCP-47 locale code, e.g. "ar", "he", "en-US".
 * @returns "rtl" for right-to-left locales, "ltr" otherwise.
 */
export function localeToDirection(locale: string): LocaleDirection {
  return isRTL(locale) ? "rtl" : "ltr";
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

/** Renderer service binding timeout in milliseconds. */
export const RENDERER_TIMEOUT_MS = 10_000;

/**
 * Write `renderer_timeout` status to D1 `generated_images`.
 *
 * Called when the Satori service binding times out so the merchant can
 * surface the failure and trigger a manual regeneration.
 */
export async function writeRendererTimeout(
  shop: string,
  productId: string,
  templateId: string,
  db: D1Database
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO generated_images
         (id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at)
       VALUES
         (lower(hex(randomblob(16))), ?, ?, ?, NULL, NULL, 'renderer_timeout',
          'Satori renderer did not respond within 10 seconds', datetime('now'))
       ON CONFLICT(shop, product_id, template_id) DO UPDATE SET
         status        = 'renderer_timeout',
         error_message = 'Satori renderer did not respond within 10 seconds',
         generated_at  = datetime('now')`
    )
    .bind(shop, productId, templateId)
    .run();
}

// ---------------------------------------------------------------------------
// Main call
// ---------------------------------------------------------------------------

/**
 * Build the JSON request body for the Satori renderer.
 */
export interface SatoriRequestBody {
  templateId: string;
  productTitle: string;
  price: string;
  locale: LocaleDirection;
  primaryColor: string;
  logoR2Key?: string | null;
  fontFamily?: string | null;
}

/**
 * Call the `mailcraft-satori` Worker via service binding to render a PNG
 * layout layer.
 *
 * @param shop         - Merchant shop domain (for logging).
 * @param productId    - Product ID (for logging).
 * @param requestBody  - Payload to send to the Satori renderer.
 * @param env          - Worker bindings.
 * @returns SatoriRenderResult with the PNG ArrayBuffer and metadata.
 * @throws On HTTP error, non-PNG response, or timeout.
 */
export async function callSatoriRenderer(
  shop: string,
  productId: string,
  requestBody: SatoriRequestBody,
  env: SatoriRendererEnv
): Promise<SatoriRenderResult> {
  const start = Date.now();

  log({
    shop,
    productId,
    step: "satori_renderer.start",
    status: "info",
    templateId: requestBody.templateId,
    direction: requestBody.locale,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RENDERER_TIMEOUT_MS);

  try {
    const request = new Request("https://mailcraft-satori.internal/render", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "image/png",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const response = await env.SATORI_RENDERER.fetch(request);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `Satori renderer returned HTTP ${response.status}: ${errText}`
      );
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.startsWith("image/png")) {
      throw new Error(
        `Satori renderer returned unexpected Content-Type: ${contentType}`
      );
    }

    const imageBuffer = await response.arrayBuffer();
    const durationMs = Date.now() - start;

    log({
      shop,
      productId,
      step: "satori_renderer.success",
      status: "ok",
      templateId: requestBody.templateId,
      durationMs,
      bytes: imageBuffer.byteLength,
    });

    return {
      imageBuffer,
      direction: requestBody.locale,
      durationMs,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - start;

    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"));

    if (isTimeout) {
      log({
        shop,
        productId,
        step: "satori_renderer.timeout",
        status: "error",
        templateId: requestBody.templateId,
        durationMs,
      });

      await writeRendererTimeout(
        shop,
        productId,
        requestBody.templateId,
        env.DB
      ).catch(() => {});

      throw new Error("renderer_timeout");
    }

    log({
      shop,
      productId,
      step: "satori_renderer.error",
      status: "error",
      templateId: requestBody.templateId,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });

    throw err;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: build request body from ImageJob fields
// ---------------------------------------------------------------------------

import type { ImageJob, BrandKit } from "./queue.server.js";

/**
 * Build the SatoriRequestBody from an ImageJob and a pre-formatted price string.
 *
 * Exported for testing so callers can verify field mapping without a live
 * service binding.
 */
export function buildSatoriRequestBody(
  job: ImageJob,
  priceFormatted: string
): SatoriRequestBody {
  const direction = localeToDirection(job.locale);
  return {
    templateId: job.templateId,
    productTitle: job.productTitle,
    price: priceFormatted,
    locale: direction,
    primaryColor: job.brandKit.primaryColor,
    logoR2Key: job.brandKit.logoR2Key ?? null,
    fontFamily: job.brandKit.fontFamily ?? null,
  };
}

/**
 * High-level entry point: render a Satori layout PNG for an image job.
 *
 * Converts the job's locale to an ltr/rtl token, formats the currency price,
 * calls the service binding, and returns the PNG ArrayBuffer.
 *
 * Writes `renderer_timeout` to D1 if the call exceeds RENDERER_TIMEOUT_MS.
 *
 * @param job           - ImageJob from the Queue consumer.
 * @param priceAmount   - Numeric product price (formatted against job.currencyFormat).
 * @param env           - Worker bindings including SATORI_RENDERER service binding.
 * @returns SatoriRenderResult with PNG bytes.
 */
export async function renderLayoutForJob(
  job: ImageJob,
  priceAmount: number,
  env: SatoriRendererEnv
): Promise<SatoriRenderResult> {
  const priceFormatted = formatCurrencyString(priceAmount, job.currencyFormat);
  const requestBody = buildSatoriRequestBody(job, priceFormatted);
  return callSatoriRenderer(job.shop, job.productId, requestBody, env);
}
