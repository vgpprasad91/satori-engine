/**
 * PR-005: OAuth callback handler.
 *
 * Handles GET /auth/callback?shop=...&code=...&state=...&hmac=...
 * Validates HMAC, exchanges code for token, stores session in D1,
 * then redirects the merchant to the embedded app home.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";
import { handleOAuthCallback } from "../../src/auth.server.js";
import { log } from "../../src/logger.js";
import type { ShopifyEnv } from "../../src/auth.server.js";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv } }).cloudflare.env;

  try {
    const { shop } = await handleOAuthCallback(request, env);
    const host = new URL(request.url).searchParams.get("host") ?? "";
    const appHome = `/?shop=${shop}&host=${host}`;
    return redirect(appHome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const shop = new URL(request.url).searchParams.get("shop") ?? "unknown";
    log({ shop, step: "oauth_callback", status: "error", error: message });
    throw new Response(`OAuth failed: ${message}`, { status: 403 });
  }
}

export default function AuthCallback() {
  return null;
}
