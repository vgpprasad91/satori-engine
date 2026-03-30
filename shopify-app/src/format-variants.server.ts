/**
 * PR-042: Multi-template per product — format variants
 *
 * Generates 3–5 format variants per product simultaneously:
 *   square    — 1080×1080  (Instagram square, social post)
 *   story     — 1080×1920  (Instagram/TikTok story)
 *   landscape — 1200×628   (Twitter/Facebook feed)
 *   og_image  — 1200×630   (Open Graph / link preview)
 *   banner    — 1400×500   (Website banner / header)
 *
 * Each variant is stored as a separate row in `generated_images` with a
 * composite template_id: `{base_template_id}::{format}`.
 *
 * Variants are generated in parallel via Promise.allSettled to ensure a
 * failure in one format does not block the others.
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Format definitions
// ---------------------------------------------------------------------------

/** Supported format variant identifiers. */
export type FormatVariant =
  | "square"
  | "story"
  | "landscape"
  | "og_image"
  | "banner";

/** Metadata about a format variant. */
export interface FormatMeta {
  id: FormatVariant;
  label: string;
  width: number;
  height: number;
  aspectRatio: string;
  description: string;
}

/** All supported format variants with their display metadata. */
export const FORMAT_VARIANTS: Record<FormatVariant, FormatMeta> = {
  square: {
    id: "square",
    label: "Square",
    width: 1080,
    height: 1080,
    aspectRatio: "1:1",
    description: "Instagram square post",
  },
  story: {
    id: "story",
    label: "Story",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    description: "Instagram/TikTok story",
  },
  landscape: {
    id: "landscape",
    label: "Landscape",
    width: 1200,
    height: 628,
    aspectRatio: "1.91:1",
    description: "Twitter/Facebook feed",
  },
  og_image: {
    id: "og_image",
    label: "OG Image",
    width: 1200,
    height: 630,
    aspectRatio: "1.91:1",
    description: "Open Graph link preview",
  },
  banner: {
    id: "banner",
    label: "Banner",
    width: 1400,
    height: 500,
    aspectRatio: "2.8:1",
    description: "Website banner / header",
  },
};

export const ALL_FORMAT_VARIANTS: FormatVariant[] = [
  "square",
  "story",
  "landscape",
  "og_image",
  "banner",
];

// ---------------------------------------------------------------------------
// Template ID helpers
// ---------------------------------------------------------------------------

/** Separator used to embed format in composite template IDs. */
const FORMAT_SEPARATOR = "::";

/**
 * Build the composite template ID for a given base template + format.
 * e.g. "product-card::square"
 */
export function buildFormatTemplateId(
  baseTemplateId: string,
  format: FormatVariant
): string {
  return `${baseTemplateId}${FORMAT_SEPARATOR}${format}`;
}

/**
 * Parse a composite template ID into its base and format parts.
 * Returns null if the ID does not contain a format suffix.
 */
export function parseFormatTemplateId(
  compositeId: string
): { baseTemplateId: string; format: FormatVariant } | null {
  const idx = compositeId.lastIndexOf(FORMAT_SEPARATOR);
  if (idx === -1) return null;

  const base = compositeId.slice(0, idx);
  const formatPart = compositeId.slice(idx + FORMAT_SEPARATOR.length) as FormatVariant;

  if (!ALL_FORMAT_VARIANTS.includes(formatPart)) return null;
  return { baseTemplateId: base, format: formatPart };
}

// ---------------------------------------------------------------------------
// D1 types
// ---------------------------------------------------------------------------

export interface FormatVariantRow {
  id: string;
  shop: string;
  product_id: string;
  template_id: string; // composite: baseId::format
  format: FormatVariant;
  base_template_id: string;
  r2_key: string | null;
  content_hash: string | null;
  status: string;
  error_message: string | null;
  generated_at: string | null;
}

export interface FormatVariantsEnv {
  DB: D1Database;
  KV_STORE: KVNamespace;
  IMAGE_QUEUE?: Queue;
}

// ---------------------------------------------------------------------------
// Query format variants for a product
// ---------------------------------------------------------------------------

/**
 * Fetch all format variant rows for a given product, enriched with
 * format metadata.  Returns one entry per format (some may be missing).
 */
export async function getFormatVariants(
  shop: string,
  productId: string,
  baseTemplateId: string,
  env: FormatVariantsEnv
): Promise<FormatVariantRow[]> {
  const rows: FormatVariantRow[] = [];

  for (const format of ALL_FORMAT_VARIANTS) {
    const templateId = buildFormatTemplateId(baseTemplateId, format);

    try {
      const row = await env.DB.prepare(
        `SELECT id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at
         FROM generated_images
         WHERE shop = ? AND product_id = ? AND template_id = ?
         ORDER BY generated_at DESC
         LIMIT 1`
      )
        .bind(shop, productId, templateId)
        .first<Omit<FormatVariantRow, "format" | "base_template_id">>();

      if (row) {
        rows.push({ ...row, format, base_template_id: baseTemplateId });
      } else {
        // Placeholder row — not yet generated
        rows.push({
          id: "",
          shop,
          product_id: productId,
          template_id: templateId,
          format,
          base_template_id: baseTemplateId,
          r2_key: null,
          content_hash: null,
          status: "not_generated",
          error_message: null,
          generated_at: null,
        });
      }
    } catch (err) {
      log({
        shop,
        productId,
        step: "format_variants.get",
        status: "error",
        format,
        error: String(err),
      });
      rows.push({
        id: "",
        shop,
        product_id: productId,
        template_id: templateId,
        format,
        base_template_id: baseTemplateId,
        r2_key: null,
        content_hash: null,
        status: "error",
        error_message: String(err),
        generated_at: null,
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Enqueue all format variants in parallel
// ---------------------------------------------------------------------------

export interface FormatVariantJobBase {
  shop: string;
  productId: string;
  productTitle: string;
  imageUrl: string;
  baseTemplateId: string;
  locale: string;
  currencyFormat: string;
  brandKit: { primaryColor: string; logoR2Key?: string | null; fontFamily?: string | null };
}

export interface EnqueueVariantsResult {
  enqueued: FormatVariant[];
  skipped: FormatVariant[];
  errors: { format: FormatVariant; error: string }[];
}

/**
 * Enqueue all 5 format variants for a product in parallel.
 *
 * Each format becomes a separate job with template_id = baseTemplateId::format.
 * Jobs already in "pending" state are skipped to avoid duplicate processing.
 */
export async function enqueueFormatVariants(
  jobBase: FormatVariantJobBase,
  formats: FormatVariant[] = ALL_FORMAT_VARIANTS,
  env: FormatVariantsEnv
): Promise<EnqueueVariantsResult> {
  const result: EnqueueVariantsResult = { enqueued: [], skipped: [], errors: [] };

  const tasks = formats.map(async (format) => {
    const templateId = buildFormatTemplateId(jobBase.baseTemplateId, format);

    // Check if already pending
    try {
      const existing = await env.DB.prepare(
        `SELECT status FROM generated_images
         WHERE shop = ? AND product_id = ? AND template_id = ?
         ORDER BY generated_at DESC LIMIT 1`
      )
        .bind(jobBase.shop, jobBase.productId, templateId)
        .first<{ status: string }>();

      if (existing?.status === "pending") {
        result.skipped.push(format);
        log({
          shop: jobBase.shop,
          productId: jobBase.productId,
          step: "format_variants.enqueue.skip",
          status: "info",
          format,
          reason: "already_pending",
        });
        return;
      }

      // Insert/update row to pending
      await env.DB.prepare(
        `INSERT INTO generated_images (id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, NULL, NULL, 'pending', NULL, datetime('now'))
         ON CONFLICT(shop, product_id, template_id) DO UPDATE SET
           status       = 'pending',
           error_message = NULL,
           generated_at = datetime('now')`
      )
        .bind(jobBase.shop, jobBase.productId, templateId)
        .run();

      // Enqueue job
      if (env.IMAGE_QUEUE) {
        const job = {
          shop: jobBase.shop,
          productId: jobBase.productId,
          productTitle: jobBase.productTitle,
          imageUrl: jobBase.imageUrl,
          templateId,
          locale: jobBase.locale,
          currencyFormat: jobBase.currencyFormat,
          brandKit: jobBase.brandKit,
          format,
          attempt: 1,
        };
        await env.IMAGE_QUEUE.send(job);
      }

      result.enqueued.push(format);

      log({
        shop: jobBase.shop,
        productId: jobBase.productId,
        step: "format_variants.enqueued",
        status: "ok",
        format,
        templateId,
      });
    } catch (err) {
      result.errors.push({ format, error: String(err) });
      log({
        shop: jobBase.shop,
        productId: jobBase.productId,
        step: "format_variants.enqueue.error",
        status: "error",
        format,
        error: String(err),
      });
    }
  });

  await Promise.allSettled(tasks);

  return result;
}

// ---------------------------------------------------------------------------
// R2 download URL helper
// ---------------------------------------------------------------------------

/**
 * Generate a signed-path URL for a format variant R2 key.
 * Returns null if the variant has no R2 key (not yet generated).
 */
export function buildDownloadUrl(
  r2Key: string | null,
  format: FormatVariant
): string | null {
  if (!r2Key) return null;
  return `/api/image/${encodeURIComponent(r2Key)}?format=${format}&download=1`;
}

/**
 * Generate a copy-link URL for a format variant R2 key.
 * Returns null if the variant has no R2 key.
 */
export function buildCopyLinkUrl(
  r2Key: string | null,
  format: FormatVariant
): string | null {
  if (!r2Key) return null;
  return `/api/image/${encodeURIComponent(r2Key)}?format=${format}`;
}

// ---------------------------------------------------------------------------
// Stats helper
// ---------------------------------------------------------------------------

export interface FormatVariantStats {
  total: number;
  generated: number;
  pending: number;
  failed: number;
  not_generated: number;
}

/**
 * Summarise the generation state across all format variants for a product.
 */
export function computeFormatVariantStats(
  rows: FormatVariantRow[]
): FormatVariantStats {
  const stats: FormatVariantStats = {
    total: rows.length,
    generated: 0,
    pending: 0,
    failed: 0,
    not_generated: 0,
  };

  for (const row of rows) {
    if (row.status === "success") stats.generated++;
    else if (row.status === "pending") stats.pending++;
    else if (
      row.status === "failed" ||
      row.status === "error" ||
      row.status === "bg_removal_failed" ||
      row.status === "compositing_failed" ||
      row.status === "renderer_timeout" ||
      row.status === "timed_out"
    ) {
      stats.failed++;
    } else {
      stats.not_generated++;
    }
  }

  return stats;
}
