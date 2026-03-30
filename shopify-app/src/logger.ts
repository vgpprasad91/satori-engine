/**
 * PR-004: Structured logger
 *
 * Emits JSON log lines to console.log for Cloudflare Logpush to capture.
 *
 * TypeScript enforces at compile-time that sensitive fields (access_token,
 * SHOPIFY_API_SECRET) can NEVER appear in the log payload — they are excluded
 * from the accepted input type via the Omit / never trick below.
 */

// ---------------------------------------------------------------------------
// Forbidden keys — any field in this union will cause a compile-time error
// if it is ever passed to log().
// ---------------------------------------------------------------------------
type ForbiddenLogKeys = "access_token" | "SHOPIFY_API_SECRET";

// ---------------------------------------------------------------------------
// Public log payload type
// ---------------------------------------------------------------------------
export type LogPayload = {
  shop: string;
  step: string;
  status: "ok" | "error" | "warn" | "info";
  productId?: string;
  durationMs?: number;
  error?: string;
  // Allow arbitrary extra fields …
  [key: string]: unknown;
} & {
  // … but forbid the sensitive ones by making their type `never`.
  // If a caller tries to pass access_token or SHOPIFY_API_SECRET the
  // TypeScript compiler will reject it with "Type X is not assignable to
  // type 'never'".
  [K in ForbiddenLogKeys]?: never;
};

// Runtime set of forbidden keys — mirrors ForbiddenLogKeys above.
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set<ForbiddenLogKeys>([
  "access_token",
  "SHOPIFY_API_SECRET",
]);

// ---------------------------------------------------------------------------
// Log function
// ---------------------------------------------------------------------------
export function log(payload: LogPayload): void {
  // Build entry, stripping any forbidden keys that may have been injected at
  // runtime (e.g. from untyped JS callers or object spread from external data).
  const raw: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    ...(payload as Record<string, unknown>),
  };
  for (const key of FORBIDDEN_KEYS) {
    delete raw[key];
  }
  // Emit as a single-line JSON string so Logpush can parse it easily.
  console.log(JSON.stringify(raw));
}
