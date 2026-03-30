/**
 * PR-012: Sentry error tracking
 *
 * Provides Sentry integration for:
 *  1. Remix frontend Worker — capturing unhandled route errors with shop context
 *  2. Queue consumer Worker — capturing pipeline exceptions with { shop, productId, step }
 *
 * Sensitive fields (access_token, SHOPIFY_API_SECRET) are NEVER included in
 * Sentry breadcrumbs or scope data — enforced via TypeScript types and runtime scrubbing.
 *
 * Alert rules configured via Sentry dashboard (referenced in RUNBOOK.md):
 *  - >5 errors/minute from same shop → Sentry alert + email
 *  - DLQ depth >50 → Sentry alert + email
 *
 * Source maps are uploaded to Sentry on every production deploy in CI
 * (see .github/workflows/deploy.yml "Upload source maps to Sentry" step).
 */

// ---------------------------------------------------------------------------
// Forbidden breadcrumb keys — never sent to Sentry
// ---------------------------------------------------------------------------

type ForbiddenSentryKeys = "access_token" | "SHOPIFY_API_SECRET";

/**
 * Runtime set of keys to strip from any context/extra data before sending to Sentry.
 * Mirrors ForbiddenSentryKeys above.
 */
const FORBIDDEN_SENTRY_KEYS: ReadonlySet<string> = new Set<ForbiddenSentryKeys>([
  "access_token",
  "SHOPIFY_API_SECRET",
]);

// ---------------------------------------------------------------------------
// Safe context type — forbids sensitive keys at compile time
// ---------------------------------------------------------------------------

export type SentryContext = {
  shop?: string;
  productId?: string;
  step?: string;
  [key: string]: unknown;
} & {
  [K in ForbiddenSentryKeys]?: never;
};

// ---------------------------------------------------------------------------
// Sentry SDK interface (subset of @sentry/cloudflare public API)
// Accepting this as a parameter enables full mock replacement in tests.
// ---------------------------------------------------------------------------

export interface SentrySdkScope {
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
  setUser(user: { id?: string; email?: string; username?: string }): void;
}

export interface SentrySdk {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown): string;
  captureMessage(message: string, level?: string): string;
  addBreadcrumb(breadcrumb: Record<string, unknown>): void;
  withScope(callback: (scope: SentrySdkScope) => void): void;
  flush(timeout?: number): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Sentry client interface (the object returned by createSentryClient)
// ---------------------------------------------------------------------------

export interface SentryClient {
  captureException(error: unknown, context?: SentryContext): string;
  captureMessage(
    message: string,
    level?: "debug" | "info" | "warning" | "error" | "fatal",
    context?: SentryContext
  ): string;
  addBreadcrumb(breadcrumb: SentryBreadcrumb): void;
  withScope(callback: (scope: SentrySdkScope) => void): void;
  flush(timeout?: number): Promise<boolean>;
}

export interface SentryBreadcrumb {
  category?: string;
  message?: string;
  level?: "debug" | "info" | "warning" | "error" | "fatal";
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sentry environment bindings
// ---------------------------------------------------------------------------

export interface SentryEnv {
  SENTRY_DSN: string;
  ENVIRONMENT?: string;
  RELEASE?: string;
}

// ---------------------------------------------------------------------------
// Scrub sensitive fields from arbitrary data before sending to Sentry
// ---------------------------------------------------------------------------

/**
 * Recursively strips FORBIDDEN_SENTRY_KEYS from a data object.
 * Returns a new object — never mutates the input.
 */
export function scrubSensitiveFields(
  data: Record<string, unknown>
): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN_SENTRY_KEYS.has(key)) {
      // Omit entirely — never include in Sentry payload
      continue;
    }

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      scrubbed[key] = scrubSensitiveFields(value as Record<string, unknown>);
    } else {
      scrubbed[key] = value;
    }
  }

  return scrubbed;
}

// ---------------------------------------------------------------------------
// Build a SentryClient from a concrete SentrySdk implementation
// (accepts the SDK as a parameter so tests can inject a mock)
// ---------------------------------------------------------------------------

/**
 * Internal factory used by createSentryClient and createSentryClientFromSdk.
 * Wraps a raw SentrySdk with context-tagging, scrubbing, and error-capture helpers.
 */
function buildClient(sdk: SentrySdk): SentryClient {
  return {
    captureException(error: unknown, context?: SentryContext): string {
      const safeContext = context
        ? scrubSensitiveFields(context as Record<string, unknown>)
        : undefined;

      let eventId = "unknown";
      sdk.withScope((scope) => {
        if (safeContext?.shop) scope.setTag("shop", safeContext.shop as string);
        if (safeContext?.productId)
          scope.setTag("product_id", safeContext.productId as string);
        if (safeContext?.step) scope.setTag("step", safeContext.step as string);
        if (safeContext) {
          const { shop: _s, productId: _p, step: _st, ...extra } = safeContext;
          for (const [k, v] of Object.entries(extra)) {
            scope.setExtra(k, v);
          }
        }
        eventId = sdk.captureException(error);
      });

      return eventId;
    },

    captureMessage(
      message: string,
      level: "debug" | "info" | "warning" | "error" | "fatal" = "error",
      context?: SentryContext
    ): string {
      const safeContext = context
        ? scrubSensitiveFields(context as Record<string, unknown>)
        : undefined;

      let eventId = "unknown";
      sdk.withScope((scope) => {
        if (safeContext?.shop) scope.setTag("shop", safeContext.shop as string);
        if (safeContext?.step) scope.setTag("step", safeContext.step as string);
        if (safeContext) {
          const { shop: _s, step: _st, ...extra } = safeContext;
          for (const [k, v] of Object.entries(extra)) {
            scope.setExtra(k, v);
          }
        }
        eventId = sdk.captureMessage(message, level);
      });

      return eventId;
    },

    addBreadcrumb(breadcrumb: SentryBreadcrumb): void {
      const safe: Record<string, unknown> = {
        ...breadcrumb,
        data: breadcrumb.data
          ? scrubSensitiveFields(breadcrumb.data)
          : undefined,
      };
      sdk.addBreadcrumb(safe);
    },

    withScope(callback: (scope: SentrySdkScope) => void): void {
      sdk.withScope(callback);
    },

    async flush(timeout = 2000): Promise<boolean> {
      return sdk.flush(timeout);
    },
  };
}

// ---------------------------------------------------------------------------
// createSentryClientFromSdk — accepts an injected SDK (used by tests)
// ---------------------------------------------------------------------------

/**
 * Builds a SentryClient from an injected SentrySdk instance.
 * Use this in tests to inject a mock SDK without touching module-level mocks.
 *
 * @param sdk         - A SentrySdk-compatible object (real or mock)
 * @param dsn         - Sentry project DSN
 * @param environment - Deployment environment
 * @param release     - Git commit SHA
 */
export function createSentryClientFromSdk(
  sdk: SentrySdk,
  dsn: string,
  environment = "production",
  release?: string
): SentryClient {
  sdk.init({
    dsn,
    environment,
    ...(release ? { release } : {}),
    tracesSampleRate: 0.1,
    beforeSend(event: Record<string, unknown>) {
      if (event.extra && typeof event.extra === "object") {
        event.extra = scrubSensitiveFields(
          event.extra as Record<string, unknown>
        );
      }
      if (event.breadcrumbs && typeof event.breadcrumbs === "object") {
        const bc = event.breadcrumbs as {
          values?: Array<{ data?: Record<string, unknown> }>;
        };
        if (Array.isArray(bc.values)) {
          bc.values = bc.values.map((b) => ({
            ...b,
            data: b.data ? scrubSensitiveFields(b.data) : undefined,
          }));
        }
      }
      return event;
    },
  });

  return buildClient(sdk);
}

// ---------------------------------------------------------------------------
// createSentryClient — production entrypoint (imports @sentry/cloudflare)
// ---------------------------------------------------------------------------

// No-op SDK used as a safe fallback when the real SDK is unavailable.
const noopSdk: SentrySdk = {
  init: () => undefined,
  captureException: () => "noop-id",
  captureMessage: () => "noop-msg-id",
  addBreadcrumb: () => undefined,
  withScope: (cb) => cb({ setTag: () => undefined, setExtra: () => undefined, setUser: () => undefined }),
  flush: async () => true,
};

/**
 * Creates a Sentry client configured for Cloudflare Workers.
 *
 * Dynamically imports @sentry/cloudflare so it can be tree-shaken by wrangler.
 * Falls back to a no-op client if the import fails (e.g. in test environments
 * where the package is not installed).
 *
 * In tests, prefer createSentryClientFromSdk() with an injected mock SDK.
 *
 * @param dsn         - Sentry project DSN (from env.SENTRY_DSN)
 * @param environment - Deployment environment (development/staging/production)
 * @param release     - Git commit SHA (injected by CI as RELEASE env var)
 */
export async function createSentryClient(
  dsn: string,
  environment = "production",
  release?: string
): Promise<SentryClient> {
  let sdk: SentrySdk;

  try {
    const Sentry = await import("@sentry/cloudflare");
    sdk = Sentry as unknown as SentrySdk;
  } catch {
    // Package not available — use no-op fallback (safe in tests or edge cases)
    sdk = noopSdk;
  }

  return createSentryClientFromSdk(sdk, dsn, environment, release);
}

// ---------------------------------------------------------------------------
// Remix route error handler helper
// ---------------------------------------------------------------------------

/**
 * Called from Remix error boundaries to capture unhandled route errors.
 *
 * Attaches shop context from the Remix request (extracted from session/URL).
 * Ensures access_token never leaks into Sentry.
 *
 * @param error   - The thrown value (Error or unknown)
 * @param sentry  - SentryClient instance
 * @param context - Optional context with shop information
 */
export function captureRouteError(
  error: unknown,
  sentry: SentryClient,
  context?: SentryContext
): string {
  return sentry.captureException(error, context);
}

// ---------------------------------------------------------------------------
// Queue consumer pipeline error handler helper
// ---------------------------------------------------------------------------

export interface PipelineErrorContext {
  shop: string;
  productId?: string;
  step: string;
  templateId?: string;
  locale?: string;
}

// Compile-time check: PipelineErrorContext must NOT have forbidden keys
type _AssertNoForbiddenKeys = PipelineErrorContext extends {
  [K in ForbiddenSentryKeys]?: unknown;
}
  ? never
  : true;
const _check: _AssertNoForbiddenKeys = true;
void _check;

/**
 * Called from Queue consumer Worker to capture pipeline exceptions.
 *
 * Attaches { shop, productId, step } tags to every Sentry event so
 * per-shop error rate alerts can fire correctly.
 *
 * @param error   - The thrown value (Error or unknown)
 * @param sentry  - SentryClient instance
 * @param context - Pipeline context (shop, productId, step)
 */
export function capturePipelineError(
  error: unknown,
  sentry: SentryClient,
  context: PipelineErrorContext
): string {
  // Scrub at runtime too — belt-and-suspenders against untyped callers
  const safeContext = scrubSensitiveFields(
    context as unknown as Record<string, unknown>
  ) as SentryContext;
  return sentry.captureException(error, safeContext);
}

// ---------------------------------------------------------------------------
// Convenience factory — builds a SentryClient from Worker env bindings
// ---------------------------------------------------------------------------

/**
 * Builds a SentryClient synchronously from standard Worker environment bindings
 * using an injected SDK.
 *
 * This is the preferred factory for production Workers:
 *
 *   import * as Sentry from "@sentry/cloudflare";
 *   const client = sentryFromEnv(env, Sentry);
 *
 * @param env - Worker environment bindings containing SENTRY_DSN
 * @param sdk - The @sentry/cloudflare SDK (or a mock for tests)
 */
export function sentryFromEnv(env: SentryEnv, sdk: SentrySdk): SentryClient {
  return createSentryClientFromSdk(
    sdk,
    env.SENTRY_DSN,
    env.ENVIRONMENT ?? "production",
    env.RELEASE
  );
}
