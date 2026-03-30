/**
 * Per-merchant rate limiting middleware for Shopify app routes.
 *
 * Uses KV to track request counts per merchant with sliding-window counters.
 * Returns 429 with Retry-After when limits are exceeded.
 */

export interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

/** API routes: 60 requests/minute */
export const API_RATE_LIMIT: RateLimitConfig = { limit: 60, windowSeconds: 60 };

/** UI routes: 120 requests/minute */
export const UI_RATE_LIMIT: RateLimitConfig = { limit: 120, windowSeconds: 60 };

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * Check and increment the rate limit counter for a merchant.
 * Uses KV with expiring keys for automatic cleanup.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  shop: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % config.windowSeconds);
  const resetAt = windowStart + config.windowSeconds;
  const key = `ratelimit:${shop}:${windowStart}`;

  const currentStr = await kv.get(key);
  const current = currentStr ? parseInt(currentStr, 10) : 0;

  if (current >= config.limit) {
    return {
      allowed: false,
      remaining: 0,
      limit: config.limit,
      resetAt,
      retryAfter: resetAt - now,
    };
  }

  // Increment counter with TTL = 2x window to ensure cleanup
  await kv.put(key, String(current + 1), {
    expirationTtl: config.windowSeconds * 2,
  });

  return {
    allowed: true,
    remaining: config.limit - current - 1,
    limit: config.limit,
    resetAt,
  };
}

/**
 * Apply rate limit headers to a Response.
 */
export function withRateLimitHeaders(
  response: Response,
  result: RateLimitResult
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-RateLimit-Limit", String(result.limit));
  headers.set("X-RateLimit-Remaining", String(result.remaining));
  headers.set("X-RateLimit-Reset", String(result.resetAt));
  if (result.retryAfter !== undefined) {
    headers.set("Retry-After", String(result.retryAfter));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create a 429 Too Many Requests response with rate limit headers.
 */
export function rateLimitExceededResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      retryAfter: result.retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfter ?? 60),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(result.resetAt),
      },
    }
  );
}
