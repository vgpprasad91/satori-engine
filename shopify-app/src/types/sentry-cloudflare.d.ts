/**
 * Type stub for @sentry/cloudflare.
 *
 * The real package is installed as a dependency and bundled by wrangler.
 * This stub satisfies TypeScript when the package is not yet installed
 * in the local node_modules (e.g. CI before npm ci, or in tests).
 *
 * Generated types here mirror the subset of @sentry/cloudflare API used
 * by sentry.server.ts.
 */
declare module "@sentry/cloudflare" {
  export interface SentryOptions {
    dsn: string;
    environment?: string;
    release?: string;
    tracesSampleRate?: number;
    beforeSend?: (event: Record<string, unknown>) => Record<string, unknown> | null;
    [key: string]: unknown;
  }

  export interface Scope {
    setTag(key: string, value: string): void;
    setExtra(key: string, value: unknown): void;
    setUser(user: { id?: string; email?: string; username?: string }): void;
  }

  export function init(options: SentryOptions): void;
  export function captureException(error: unknown): string;
  export function captureMessage(message: string, level?: string): string;
  export function addBreadcrumb(breadcrumb: Record<string, unknown>): void;
  export function withScope(callback: (scope: Scope) => void): void;
  export function flush(timeout?: number): Promise<boolean>;
}
