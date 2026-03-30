/**
 * KV-based per-merchant sliding-window rate limiter (Blocker 2).
 *
 * Limits: 60 requests per 60 seconds per shop domain.
 * Storage: Cloudflare KV — key `rate:{shop}` → JSON array of Unix-ms timestamps.
 * Each entry expires automatically after WINDOW_SECONDS + 5 s via KV TTL.
 *
 * Usage in a Remix loader/action:
 *   const rl = await checkRateLimit(shop, env.KV_STORE);
 *   if (!rl.allowed) throw rateLimitResponse(rl.retryAfterSeconds);
 */

export const RATE_LIMIT_REQUESTS = 60;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the oldest request falls outside the window. */
  retryAfterSeconds: number;
}

/**
 * Check whether `shop` is within its rate limit for the current window.
 * Increments the counter when allowed.
 */
export async function checkRateLimit(
  shop: string,
  kv: KVNamespace
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_SECONDS * 1000;
  const key = `rate:${shop}`;

  // Load existing timestamps from KV
  const raw = await kv.get(key);
  let timestamps: number[] = raw ? (JSON.parse(raw) as number[]) : [];

  // Discard timestamps outside the sliding window
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= RATE_LIMIT_REQUESTS) {
    // The oldest request determines when the window will clear
    const oldest = timestamps[0]!;
    const retryAfterMs = oldest + RATE_LIMIT_WINDOW_SECONDS * 1000 - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  // Record this request
  timestamps.push(now);
  await kv.put(key, JSON.stringify(timestamps), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 5,
  });

  return {
    allowed: true,
    remaining: RATE_LIMIT_REQUESTS - timestamps.length,
    retryAfterSeconds: 0,
  };
}

/**
 * Build a 429 Too Many Requests Response with appropriate headers.
 * Throw or return this from a Remix loader/action.
 */
export function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message: `Rate limit exceeded. Retry after ${retryAfterSeconds} second(s).`,
      retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(RATE_LIMIT_REQUESTS),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(
          Math.ceil(Date.now() / 1000) + retryAfterSeconds
        ),
      },
    }
  );
}
