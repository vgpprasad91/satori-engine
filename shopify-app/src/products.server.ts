/**
 * PR-022: Products dashboard — data access layer
 *
 * Fetches products joined with their latest generated image status.
 * KV caches the product list for sub-200ms loads (TTL: 60 seconds).
 *
 * Supports:
 *  - Filter by status: success | failed | pending | quota_exceeded | timed_out | all
 *  - Sort by generated_at (asc/desc) or title
 *  - Re-queue a product for regeneration (calls queue producer)
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GeneratedImageStatus =
  | "success"
  | "failed"
  | "pending"
  | "quota_exceeded"
  | "timed_out"
  | "quality_gate"
  | "bg_removal_failed"
  | "renderer_timeout"
  | "compositing_failed"
  | "unknown_error";

export interface ProductRow {
  id: string;
  shop: string;
  shopify_product_id: string;
  title: string;
  image_url: string | null;
  last_synced: string | null;
}

export interface GeneratedImageRow {
  id: string;
  shop: string;
  product_id: string;
  template_id: string;
  r2_key: string | null;
  content_hash: string | null;
  status: GeneratedImageStatus;
  error_message: string | null;
  generated_at: string | null;
}

export interface ProductWithImage {
  id: string;
  shopify_product_id: string;
  title: string;
  image_url: string | null;
  last_synced: string | null;
  generated_image_status: GeneratedImageStatus | null;
  generated_image_r2_key: string | null;
  generated_at: string | null;
  error_message: string | null;
}

export type StatusFilter = GeneratedImageStatus | "all" | "no_image";
export type SortField = "generated_at" | "title";
export type SortDir = "asc" | "desc";

export interface ProductsQuery {
  statusFilter?: StatusFilter;
  sortField?: SortField;
  sortDir?: SortDir;
}

export interface ProductsEnv {
  DB: D1Database;
  KV_STORE: KVNamespace;
  IMAGE_QUEUE?: Queue;
}

// ---------------------------------------------------------------------------
// KV cache helpers
// ---------------------------------------------------------------------------

const KV_TTL_SECONDS = 60;

function cacheKey(shop: string): string {
  return `products-list:${shop}`;
}

export async function invalidateProductsCache(
  shop: string,
  env: ProductsEnv
): Promise<void> {
  await env.KV_STORE.delete(cacheKey(shop));
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/**
 * Returns products joined with their most-recent generated image.
 * Results are KV-cached for KV_TTL_SECONDS seconds.
 */
export async function listProducts(
  shop: string,
  env: ProductsEnv,
  query: ProductsQuery = {}
): Promise<ProductWithImage[]> {
  const key = cacheKey(shop);
  const cached = await env.KV_STORE.get(key, "json") as ProductWithImage[] | null;

  if (cached) {
    return applyQuery(cached, query);
  }

  // Fetch from D1 — left join to get products without images too
  const sql = `
    SELECT
      p.id,
      p.shopify_product_id,
      p.title,
      p.image_url,
      p.last_synced,
      gi.status      AS generated_image_status,
      gi.r2_key      AS generated_image_r2_key,
      gi.generated_at,
      gi.error_message
    FROM products p
    LEFT JOIN (
      SELECT g1.product_id, g1.status, g1.r2_key, g1.generated_at, g1.error_message
      FROM generated_images g1
      INNER JOIN (
        SELECT product_id, MAX(generated_at) AS max_gen
        FROM generated_images
        WHERE shop = ?
        GROUP BY product_id
      ) g2 ON g1.product_id = g2.product_id AND g1.generated_at = g2.max_gen
      WHERE g1.shop = ?
    ) gi ON p.id = gi.product_id
    WHERE p.shop = ?
    ORDER BY p.title ASC
  `;

  let rows: ProductWithImage[] = [];
  try {
    const result = await env.DB.prepare(sql)
      .bind(shop, shop, shop)
      .all<ProductWithImage>();
    rows = result.results ?? [];
  } catch (err) {
    log({ shop, step: "list_products", status: "error", error: String(err) });
    return [];
  }

  // Cache for TTL
  await env.KV_STORE.put(key, JSON.stringify(rows), {
    expirationTtl: KV_TTL_SECONDS,
  });

  return applyQuery(rows, query);
}

/**
 * Applies in-memory filter + sort to the cached product list.
 */
export function applyQuery(
  rows: ProductWithImage[],
  query: ProductsQuery
): ProductWithImage[] {
  const { statusFilter = "all", sortField = "generated_at", sortDir = "desc" } = query;

  let filtered = rows;

  if (statusFilter === "no_image") {
    filtered = rows.filter((r) => r.generated_image_status === null);
  } else if (statusFilter !== "all") {
    filtered = rows.filter((r) => r.generated_image_status === statusFilter);
  }

  return filtered.slice().sort((a, b) => {
    if (sortField === "title") {
      const cmp = (a.title ?? "").localeCompare(b.title ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    }
    // generated_at — nulls last
    const at = a.generated_at ?? "";
    const bt = b.generated_at ?? "";
    if (!at && !bt) return 0;
    if (!at) return 1;
    if (!bt) return -1;
    const cmp = at < bt ? -1 : at > bt ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Bulk regenerate
// ---------------------------------------------------------------------------

export interface RequeueResult {
  queued: string[];
  skipped: string[];
}

/**
 * Re-queues a list of product IDs for regeneration.
 * Skips products that are currently pending.
 * Invalidates the KV cache after queuing.
 */
export async function bulkRequeue(
  shop: string,
  productIds: string[],
  env: ProductsEnv
): Promise<RequeueResult> {
  const queued: string[] = [];
  const skipped: string[] = [];

  for (const productId of productIds) {
    try {
      // Fetch current status
      const row = await env.DB.prepare(
        `SELECT status FROM generated_images WHERE shop = ? AND product_id = ? ORDER BY generated_at DESC LIMIT 1`
      )
        .bind(shop, productId)
        .first<{ status: string }>();

      if (row?.status === "pending") {
        skipped.push(productId);
        continue;
      }

      // Mark as pending
      await env.DB.prepare(
        `INSERT OR REPLACE INTO generated_images (id, shop, product_id, template_id, status, generated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, 'default', 'pending', datetime('now'))`
      )
        .bind(shop, productId)
        .run();

      queued.push(productId);

      log({
        shop,
        productId,
        step: "bulk_requeue",
        status: "ok",
      });
    } catch (err) {
      log({
        shop,
        productId,
        step: "bulk_requeue",
        status: "error",
        error: String(err),
      });
      skipped.push(productId);
    }
  }

  if (queued.length > 0) {
    await invalidateProductsCache(shop, env);
  }

  return { queued, skipped };
}
