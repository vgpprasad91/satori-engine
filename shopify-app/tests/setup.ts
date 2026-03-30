/**
 * Vitest setup for Cloudflare Workers environment.
 *
 * Uses @cloudflare/vitest-pool-workers (miniflare) for accurate
 * Workers-runtime globals (fetch, Request, Response, Headers, crypto, etc.).
 *
 * To use miniflare as the Vitest environment install:
 *   npm i -D @cloudflare/vitest-pool-workers
 * and set `environment: "miniflare"` in vite.config.ts test options.
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Global stubs for APIs not present in the miniflare test environment
// ---------------------------------------------------------------------------

// Stub crypto.randomUUID if missing (Node < 19 or some Miniflare versions)
if (typeof crypto === "undefined" || typeof crypto.randomUUID === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      randomUUID: () =>
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        }),
      getRandomValues: <T extends ArrayBufferView>(arr: T): T => {
        const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      },
      subtle: (globalThis as typeof globalThis & { crypto?: { subtle?: unknown } }).crypto?.subtle,
    },
    writable: false,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Mock Cloudflare bindings available to every test via vi.stubEnv
// ---------------------------------------------------------------------------
beforeAll(() => {
  vi.stubEnv("SHOPIFY_API_KEY", "test-api-key");
  vi.stubEnv("SHOPIFY_API_SECRET", "test-api-secret");
  vi.stubEnv("SHOPIFY_APP_URL", "https://test.example.com");
  vi.stubEnv("SHOPIFY_SCOPES", "write_products,read_products,write_content");
  vi.stubEnv("INTERNAL_API_KEY", "test-internal-key");
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("REMOVE_BG_API_KEY", "test-removebg-key");
  vi.stubEnv("RESEND_API_KEY", "test-resend-key");
  vi.stubEnv("SENTRY_DSN", "https://test@sentry.io/0");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Per-test lifecycle hooks
// ---------------------------------------------------------------------------
beforeEach(() => {
  // Reset all mocks between tests so state doesn't leak
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Miniflare D1 mock helpers (re-exported for use in test files)
// ---------------------------------------------------------------------------

/** Creates an in-memory D1-compatible stub for unit tests that don't use miniflare. */
export function createMockD1(): D1Database {
  const rows: Record<string, unknown>[] = [];

  const stub: Partial<D1Database> = {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: rows, success: true, meta: {} }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
    }),
    exec: vi.fn().mockResolvedValue({ count: 0, duration: 0 }),
    batch: vi.fn().mockResolvedValue([]),
    dump: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  };

  return stub as D1Database;
}

/** Creates a minimal KV namespace stub. */
export function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  const stub = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true, cursor: undefined }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  };

  return stub as unknown as KVNamespace;
}

/** Creates a minimal Queue producer stub. */
export function createMockQueue(): Queue {
  const sent: unknown[] = [];

  const stub: Partial<Queue> = {
    send: vi.fn(async (msg: unknown) => {
      sent.push(msg);
    }),
    sendBatch: vi.fn(async (msgs: MessageSendRequest[]) => {
      msgs.forEach((m) => sent.push(m.body));
    }),
  };

  // Expose sent messages for assertions
  (stub as Queue & { _sent: unknown[] })._sent = sent;

  return stub as Queue;
}
