/**
 * Middleware stack for Shopify app Worker.
 *
 * Applies per-merchant rate limiting and CSP headers to all responses.
 * Intended to wrap the Remix handler in the Worker fetch entry point.
 */

import {
  checkRateLimit,
  rateLimitExceededResponse,
  withRateLimitHeaders,
  API_RATE_LIMIT,
  UI_RATE_LIMIT,
} from "./rate-limit.server.js";
import { withCspHeaders } from "./csp.server.js";

interface MiddlewareEnv {
  KV_STORE: KVNamespace;
}

/**
 * Determine whether a request path is an API route or a UI route.
 */
function isApiRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/webhooks") ||
    pathname.startsWith("/auth")
  );
}

/**
 * Extract the merchant shop domain from the request for rate limiting.
 * Checks query params and common headers used by Shopify embedded apps.
 */
function extractShop(request: Request): string | null {
  const url = new URL(request.url);
  return (
    url.searchParams.get("shop") ??
    request.headers.get("x-shopify-shop-domain") ??
    null
  );
}

/**
 * Wraps a fetch handler with rate limiting and CSP middleware.
 *
 * Usage in Worker entry:
 *   export default { fetch: withMiddleware(remixHandler) }
 */
export function withMiddleware(
  handler: (request: Request, env: MiddlewareEnv & Record<string, unknown>, ctx: ExecutionContext) => Promise<Response>
) {
  return async (
    request: Request,
    env: MiddlewareEnv & Record<string, unknown>,
    ctx: ExecutionContext
  ): Promise<Response> => {
    const url = new URL(request.url);

    // Skip middleware for static assets and health checks
    if (
      url.pathname.startsWith("/build/") ||
      url.pathname.startsWith("/favicon") ||
      url.pathname === "/health"
    ) {
      return handler(request, env, ctx);
    }

    // Per-merchant rate limiting
    const shop = extractShop(request);
    if (shop) {
      const config = isApiRoute(url.pathname) ? API_RATE_LIMIT : UI_RATE_LIMIT;
      const result = await checkRateLimit(env.KV_STORE, shop, config);

      if (!result.allowed) {
        return withCspHeaders(rateLimitExceededResponse(result));
      }

      // Call the handler and attach rate limit + CSP headers
      const response = await handler(request, env, ctx);
      return withCspHeaders(withRateLimitHeaders(response, result));
    }

    // No shop identified — apply CSP only
    const response = await handler(request, env, ctx);
    return withCspHeaders(response);
  };
}
