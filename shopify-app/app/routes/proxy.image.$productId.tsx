/**
 * App Proxy — generated image delivery (Blocker 6)
 *
 * URL pattern (served via Shopify app proxy):
 *   /apps/satori/image/:productId
 *
 * Shopify forwards requests to:
 *   https://your-worker.workers.dev/proxy/image/:productId
 *
 * The Worker looks up the generated image's R2 key in D1 and streams the PNG.
 * Falls back to a 404 if no generated image exists for the product.
 *
 * Configure the app proxy subpath in shopify.app.toml:
 *   [app_proxy]
 *   url = "https://your-worker.workers.dev/proxy"
 *   subpath = "satori"
 *   prefix = "apps"
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";

interface ProxyEnv {
  DB?: D1Database;
  ASSETS_BUCKET?: R2Bucket;
}

interface GeneratedImageRow {
  r2_key: string;
  status: string;
}

export async function loader({ params, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ProxyEnv } }).cloudflare.env;
  const productId = params.productId;

  if (!productId || !env.DB || !env.ASSETS_BUCKET) {
    return new Response("Not found", { status: 404 });
  }

  // Look up the most recent successful generated image for this product
  let row: GeneratedImageRow | null = null;
  try {
    row = await env.DB.prepare(
      `SELECT r2_key, status FROM generated_images
       WHERE product_id = ?1 AND status = 'success' AND r2_key IS NOT NULL
       ORDER BY generated_at DESC LIMIT 1`
    )
      .bind(productId)
      .first<GeneratedImageRow>();
  } catch {
    return new Response("Service unavailable", { status: 503 });
  }

  if (!row?.r2_key) {
    return new Response("No generated image found for this product", {
      status: 404,
    });
  }

  // Stream the image from R2
  let object: R2ObjectBody | null = null;
  try {
    object = await env.ASSETS_BUCKET.get(row.r2_key);
  } catch {
    return new Response("Image retrieval failed", { status: 502 });
  }

  if (!object) {
    return new Response("Image not found in storage", { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
