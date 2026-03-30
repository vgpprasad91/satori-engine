/**
 * App proxy route — serves generated images for a given product.
 *
 * URL pattern: /apps/satori/api/proxy/images/:productId
 * (The Shopify app proxy forwards /apps/satori/* to this Worker)
 *
 * Returns JSON with image URLs for the theme extension to render.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";

interface ProxyEnv {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
}

interface ImageEntry {
  url: string;
  alt: string;
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ProxyEnv } }).cloudflare.env;

  // Extract productId from the splat param
  const productId = params["*"] ?? "";
  if (!productId) {
    return json({ images: [] }, { status: 400 });
  }

  // Validate that this is a legitimate app proxy request
  // (Shopify signs proxy requests; in production, validate the signature)
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ images: [] }, { status: 400 });
  }

  try {
    const rows = await env.DB.prepare(
      `SELECT id, r2_key, product_id
       FROM generated_images
       WHERE shop = ?1 AND product_id = ?2 AND status = 'success' AND r2_key IS NOT NULL
       ORDER BY generated_at DESC
       LIMIT 12`
    )
      .bind(shop, productId)
      .all<{ id: string; r2_key: string; product_id: string }>();

    const images: ImageEntry[] = (rows.results ?? []).map((row) => ({
      url: `/api/image/${encodeURIComponent(row.r2_key)}`,
      alt: `Generated image for product ${row.product_id}`,
    }));

    return json(
      { images },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch {
    return json({ images: [] }, { status: 500 });
  }
}
