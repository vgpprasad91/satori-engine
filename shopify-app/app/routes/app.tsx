/**
 * PR-020 + PR-025: App layout route — wraps all /app/* authenticated routes.
 *
 * Extracts apiKey + host from URL search params for App Bridge.
 * Renders AppShell (Polaris Frame + Navigation) around child routes.
 *
 * PR-025: Loads usage banner data and renders UsageBanner at the top of every
 * embedded page when usage >= 80% of the monthly limit.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Outlet, useLoaderData } from "@remix-run/react";
import { AppShell } from "../components/AppShell.js";
import { UsageBanner } from "../components/UsageBanner.js";
import { extractAppBridgeParams } from "../../src/app-shell.server.js";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";
import { checkRateLimit, rateLimitResponse } from "../../src/rate-limit.server.js";
import { getUsageBannerData } from "../../src/usage-banner.server.js";
import type { UsageBannerData } from "../../src/usage-banner.server.js";

interface AppLayoutData {
  apiKey: string;
  host: string;
  shop: string;
  banner: UsageBannerData;
}

const NULL_BANNER: UsageBannerData = {
  state: null,
  currentUsage: 0,
  monthlyLimit: 100,
  usagePercent: 0,
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (
    context as {
      cloudflare: {
        env: ShopifyEnv & {
          SHOPIFY_API_KEY?: string;
          DB: D1Database;
          KV_STORE: KVNamespace;
        };
      };
    }
  ).cloudflare.env;

  // Enforce OAuth — redirect to /auth if session missing or expired
  const auth = await shopifyAuth(request, env);
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? auth?.shop;

  if (!auth) {
    const redirectUrl = shop ? `/auth?shop=${shop}` : "/auth";
    return redirect(redirectUrl);
  }

  // Per-merchant rate limiting: 60 requests/minute (Blocker 2)
  const rl = await checkRateLimit(auth.shop, env.KV_STORE);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfterSeconds);
  }

  // Load usage banner data (non-fatal — falls back to null banner on error)
  let banner: UsageBannerData = NULL_BANNER;
  try {
    banner = await getUsageBannerData(auth.shop, {
      KV_STORE: env.KV_STORE,
      DB: env.DB,
    });
  } catch {
    // DB/KV not yet available (local dev) — no banner
  }

  // Extract App Bridge params; fall back to SHOPIFY_API_KEY env var
  const params = extractAppBridgeParams(request.url, env.SHOPIFY_API_KEY);

  if (!params) {
    return json<AppLayoutData>({
      apiKey: env.SHOPIFY_API_KEY ?? "",
      host: "",
      shop: auth.shop,
      banner,
    });
  }

  return json<AppLayoutData>({
    apiKey: params.apiKey,
    host: params.host,
    shop: auth.shop,
    banner,
  });
}

export default function AppLayout() {
  const { apiKey, host, banner } = useLoaderData<typeof loader>();

  return (
    <AppShell apiKey={apiKey} host={host}>
      {banner.state && (
        <UsageBanner
          state={banner.state}
          currentUsage={banner.currentUsage}
          monthlyLimit={banner.monthlyLimit}
        />
      )}
      <Outlet />
    </AppShell>
  );
}
