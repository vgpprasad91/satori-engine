/**
 * PR-005: Shopify OAuth handshake utilities.
 *
 * Provides:
 *  - HMAC-SHA256 request validation (install & callback)
 *  - OAuth state generation and verification
 *  - Access-token exchange
 *  - Token refresh (re-install flow for expired offline tokens)
 *  - shopifyAuth() middleware factory for Remix loaders/actions
 *  - requireShopifyAuth() — throws a redirect on missing/expired session
 *
 * Security notes:
 *  - access_token NEVER appears in log payloads (logger.ts types enforce this)
 *  - All HMAC comparisons use timing-safe crypto.subtle
 *  - State nonces stored in KV with 10-minute TTL to prevent replay attacks
 *
 * API version:
 *  - Pinned to SHOPIFY_API_VERSION (see constant below)
 *  - Must be upgraded by SHOPIFY_API_VERSION_UPGRADE_BY
 *  - warnApiVersionUpgrade() logs a warning when within 60 days of deadline
 */

import { redirect } from "@remix-run/cloudflare";
import { log } from "./logger.js";
import {
  upsertSession,
  getSession,
  isSessionExpired,
  type MerchantSession,
} from "./session.server.js";

// ---------------------------------------------------------------------------
// API version constants (Blocker 8)
// ---------------------------------------------------------------------------

/**
 * Shopify Admin API version used by this app.
 * Upgrade-by date: 2025-10-01. Run warnApiVersionUpgrade() on startup.
 * To upgrade: update this constant and test all GraphQL queries.
 */
export const SHOPIFY_API_VERSION = "2025-01";

/**
 * Date by which this API version must be upgraded.
 * Shopify removes unsupported versions 12 months after release.
 */
export const SHOPIFY_API_VERSION_UPGRADE_BY = "2025-10-01";

/**
 * Logs a warning if within 60 days of the API version upgrade deadline.
 * Call this from the Worker fetch handler or a cron trigger.
 */
export function warnApiVersionUpgrade(): void {
  const upgradeDate = new Date(SHOPIFY_API_VERSION_UPGRADE_BY).getTime();
  const daysUntil = Math.floor((upgradeDate - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysUntil <= 60 && daysUntil >= 0) {
    log({
      shop: "system",
      step: "api_version_upgrade_warning",
      status: "warn",
      error: `Shopify API ${SHOPIFY_API_VERSION} must be upgraded by ${SHOPIFY_API_VERSION_UPGRADE_BY} — ${daysUntil} day(s) remaining`,
    });
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShopifyEnv {
  SHOPIFY_API_KEY: string;
  /** NEVER log this */
  SHOPIFY_API_SECRET: string;
  SHOPIFY_APP_URL: string;
  SHOPIFY_SCOPES: string;
  DB: D1Database;
  KV_STORE: KVNamespace;
}

export interface OAuthCallbackParams {
  shop: string;
  code: string;
  state: string;
  hmac: string;
  timestamp: string;
  host?: string;
}

export interface TokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
}

// ---------------------------------------------------------------------------
// HMAC validation
// ---------------------------------------------------------------------------

/**
 * Validates a Shopify HMAC-SHA256 signature on an install/callback request.
 *
 * Algorithm:
 *   1. Remove `hmac` param from the query string.
 *   2. Sort remaining params alphabetically.
 *   3. Join as `key=value&key=value`.
 *   4. HMAC-SHA256 with SHOPIFY_API_SECRET as key.
 *   5. Compare hex digest to provided `hmac` using timing-safe comparison.
 */
export async function validateHmac(
  params: URLSearchParams,
  apiSecret: string
): Promise<boolean> {
  const hmac = params.get("hmac");
  if (!hmac) return false;

  // Build message: all params except hmac, sorted
  const entries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hmac") continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const message = entries.join("&");

  // Import key
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Sign
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  // Convert to hex
  const digest = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Timing-safe compare: convert both to Uint8Array and compare lengths then bytes
  return timingSafeEqual(digest, hmac);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// State nonce helpers (stored in KV for 10 minutes)
// ---------------------------------------------------------------------------

export async function generateState(kv: KVNamespace, shop: string): Promise<string> {
  const nonce = crypto.randomUUID();
  await kv.put(`oauth_state:${nonce}`, shop, { expirationTtl: 600 });
  return nonce;
}

export async function verifyAndConsumeState(
  kv: KVNamespace,
  state: string,
  shop: string
): Promise<boolean> {
  const storedShop = await kv.get(`oauth_state:${state}`);
  if (!storedShop) return false;
  if (storedShop !== shop) return false;
  await kv.delete(`oauth_state:${state}`);
  return true;
}

// ---------------------------------------------------------------------------
// Install URL builder
// ---------------------------------------------------------------------------

export function buildInstallUrl(
  shop: string,
  apiKey: string,
  appUrl: string,
  scopes: string,
  state: string
): string {
  const redirectUri = `${appUrl}/auth/callback`;
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
    "grant_options[]": "per-user",
  });
  return `https://${shop}/admin/oauth/authorize?${params}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export async function exchangeCodeForToken(
  shop: string,
  code: string,
  apiKey: string,
  apiSecret: string,
  appUrl: string
): Promise<TokenResponse> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  return (await res.json()) as TokenResponse;
}

// ---------------------------------------------------------------------------
// Token refresh (re-OAuth flow — offline tokens don't have a refresh_token)
// For Shopify, "refresh" means redirecting the merchant through OAuth again.
// We expose a helper that checks expiry and returns true if re-auth is needed.
// ---------------------------------------------------------------------------

export async function needsReauth(
  db: D1Database,
  shop: string
): Promise<boolean> {
  const session = await getSession(db, shop);
  if (!session || session.access_token === null) return true;
  return isSessionExpired(session);
}

// ---------------------------------------------------------------------------
// shopifyAuth middleware for Remix loader/action functions
// ---------------------------------------------------------------------------

export interface AuthContext {
  shop: string;
  session: MerchantSession;
  admin: {
    graphql: (query: string, variables?: Record<string, unknown>) => Promise<Response>;
  };
}

/**
 * Call this at the top of every protected Remix loader/action.
 *
 * Returns an AuthContext if the merchant has a valid session.
 * Returns null and redirects to /auth?shop=... if re-auth is needed.
 *
 * Usage:
 *   export async function loader({ request, context }: LoaderFunctionArgs) {
 *     const auth = await shopifyAuth(request, context.cloudflare.env);
 *     if (!auth) return redirect(`/auth?shop=${shop}`);
 *     // use auth.admin.graphql(...)
 *   }
 */
export async function shopifyAuth(
  request: Request,
  env: ShopifyEnv
): Promise<AuthContext | null> {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";

  if (!shop) return null;

  const reauth = await needsReauth(env.DB, shop);
  if (reauth) {
    log({
      shop,
      step: "auth_check",
      status: "warn",
      error: "Session expired or missing — reauth required",
    });
    return null;
  }

  const session = await getSession(env.DB, shop);
  if (!session) return null;

  const adminGraphql = async (
    query: string,
    variables?: Record<string, unknown>
  ): Promise<Response> => {
    return fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.access_token,
          "X-Shopify-API-Version": SHOPIFY_API_VERSION,
        },
        body: JSON.stringify({ query, variables }),
      }
    );
  };

  return { shop, session, admin: { graphql: adminGraphql } };
}

// ---------------------------------------------------------------------------
// requireShopifyAuth — throws a redirect instead of returning null (Blocker 1)
// ---------------------------------------------------------------------------

/**
 * Like shopifyAuth() but throws a Remix redirect response when the session is
 * missing or expired, rather than returning null.
 *
 * Usage in child route loaders/actions:
 *   const auth = await requireShopifyAuth(request, env);
 *   // auth is always AuthContext here — expired sessions redirect to /auth
 */
export async function requireShopifyAuth(
  request: Request,
  env: ShopifyEnv
): Promise<AuthContext> {
  const auth = await shopifyAuth(request, env);
  if (!auth) {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") ?? "";
    const destination = shop ? `/auth?shop=${shop}` : "/auth";
    throw redirect(destination);
  }
  return auth;
}

// ---------------------------------------------------------------------------
// Full OAuth callback handler (used by the /auth/callback route)
// ---------------------------------------------------------------------------

export async function handleOAuthCallback(
  request: Request,
  env: ShopifyEnv
): Promise<{ shop: string }> {
  const url = new URL(request.url);
  const params = url.searchParams;

  const shop = params.get("shop");
  const code = params.get("code");
  const state = params.get("state");
  const hmac = params.get("hmac");

  if (!shop || !code || !state || !hmac) {
    throw new Error("Missing required OAuth callback parameters");
  }

  // 1. Validate HMAC
  const hmacValid = await validateHmac(params, env.SHOPIFY_API_SECRET);
  if (!hmacValid) {
    log({ shop, step: "oauth_callback", status: "error", error: "HMAC validation failed" });
    throw new Error("HMAC validation failed");
  }

  // 2. Verify and consume state nonce (replay protection)
  const stateValid = await verifyAndConsumeState(env.KV_STORE, state, shop);
  if (!stateValid) {
    log({ shop, step: "oauth_callback", status: "error", error: "State nonce invalid or expired" });
    throw new Error("Invalid or expired state nonce");
  }

  // 3. Exchange code for token
  const tokenData = await exchangeCodeForToken(
    shop,
    code,
    env.SHOPIFY_API_KEY,
    env.SHOPIFY_API_SECRET,
    env.SHOPIFY_APP_URL
  );

  // Calculate expiry if present
  const expiresAt = tokenData.expires_in
    ? Date.now() + tokenData.expires_in * 1000
    : null;

  // 4. Store session in D1
  await upsertSession(env.DB, shop, tokenData.access_token, tokenData.scope, expiresAt);

  log({
    shop,
    step: "oauth_callback",
    status: "ok",
    error: undefined,
  });

  return { shop };
}
