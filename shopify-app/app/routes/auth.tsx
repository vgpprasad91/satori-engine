/**
 * PR-005: OAuth install entry point.
 *
 * Handles GET /auth?shop=mystore.myshopify.com
 * Validates the HMAC, generates a state nonce, and redirects to Shopify OAuth.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";
import {
  validateHmac,
  generateState,
  buildInstallUrl,
} from "../../src/auth.server.js";
import { log } from "../../src/logger.js";
import type { ShopifyEnv } from "../../src/auth.server.js";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv } }).cloudflare.env;
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    throw new Response("Missing shop parameter", { status: 400 });
  }

  // Validate HMAC when present (Shopify-initiated installs include it)
  const hmac = url.searchParams.get("hmac");
  if (hmac) {
    const valid = await validateHmac(url.searchParams, env.SHOPIFY_API_SECRET);
    if (!valid) {
      log({ shop, step: "auth_install", status: "error", error: "HMAC validation failed" });
      throw new Response("Invalid HMAC", { status: 403 });
    }
  }

  log({ shop, step: "auth_install", status: "info" });

  const state = await generateState(env.KV_STORE, shop);
  const installUrl = buildInstallUrl(
    shop,
    env.SHOPIFY_API_KEY,
    env.SHOPIFY_APP_URL,
    env.SHOPIFY_SCOPES,
    state
  );

  return redirect(installUrl);
}

// No UI — this route only redirects
export default function Auth() {
  return null;
}
