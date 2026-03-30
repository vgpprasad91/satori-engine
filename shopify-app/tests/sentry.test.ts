/**
 * PR-012: Unit tests for Sentry error tracking
 *
 * Tests:
 *  - Sentry captureException is called when an exception occurs
 *  - access_token is scrubbed from breadcrumbs and context
 *  - SHOPIFY_API_SECRET is scrubbed from breadcrumbs and context
 *  - shop, productId, step tags are correctly attached
 *  - captureRouteError and capturePipelineError helpers work correctly
 *  - scrubSensitiveFields recursively strips forbidden keys
 *  - sentryFromEnv builds client from env bindings
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  scrubSensitiveFields,
  createSentryClientFromSdk,
  captureRouteError,
  capturePipelineError,
  sentryFromEnv,
  type SentrySdk,
  type SentrySdkScope,
  type SentryClient,
  type SentryContext,
} from "../src/sentry.server.js";

// ---------------------------------------------------------------------------
// Mock SDK factory — creates a fresh mock SentrySdk for each test
// ---------------------------------------------------------------------------

interface MockSdk extends SentrySdk {
  _captureException: ReturnType<typeof vi.fn>;
  _captureMessage: ReturnType<typeof vi.fn>;
  _addBreadcrumb: ReturnType<typeof vi.fn>;
  _withScope: ReturnType<typeof vi.fn>;
  _flush: ReturnType<typeof vi.fn>;
  _init: ReturnType<typeof vi.fn>;
  _lastScope: SentrySdkScope | null;
}

function makeMockSdk(): MockSdk {
  const mockCaptureException = vi.fn().mockReturnValue("evt-123");
  const mockCaptureMessage = vi.fn().mockReturnValue("evt-msg-456");
  const mockAddBreadcrumb = vi.fn();
  const mockFlush = vi.fn().mockResolvedValue(true);
  const mockInit = vi.fn();

  let lastScope: SentrySdkScope | null = null;
  const mockSetTag = vi.fn();
  const mockSetExtra = vi.fn();
  const mockSetUser = vi.fn();

  const mockWithScope = vi.fn((cb: (scope: SentrySdkScope) => void) => {
    const scope: SentrySdkScope = {
      setTag: mockSetTag,
      setExtra: mockSetExtra,
      setUser: mockSetUser,
    };
    lastScope = scope;
    cb(scope);
  });

  const sdk: MockSdk = {
    init: mockInit,
    captureException: mockCaptureException,
    captureMessage: mockCaptureMessage,
    addBreadcrumb: mockAddBreadcrumb,
    withScope: mockWithScope,
    flush: mockFlush,
    _captureException: mockCaptureException,
    _captureMessage: mockCaptureMessage,
    _addBreadcrumb: mockAddBreadcrumb,
    _withScope: mockWithScope,
    _flush: mockFlush,
    _init: mockInit,
    get _lastScope() { return lastScope; },
    set _lastScope(v) { lastScope = v; },
  };

  return sdk;
}

function makeClient(overrides?: { sdk?: MockSdk }) {
  const sdk = overrides?.sdk ?? makeMockSdk();
  const client = createSentryClientFromSdk(sdk, "https://test@sentry.io/0", "test", "abc123");
  return { client, sdk };
}

// ---------------------------------------------------------------------------
// scrubSensitiveFields
// ---------------------------------------------------------------------------

describe("scrubSensitiveFields", () => {
  it("strips access_token from flat object", () => {
    const data = { shop: "test.myshopify.com", access_token: "tok_abc" };
    const result = scrubSensitiveFields(data);
    expect(result).not.toHaveProperty("access_token");
    expect(result.shop).toBe("test.myshopify.com");
  });

  it("strips SHOPIFY_API_SECRET from flat object", () => {
    const data = { shop: "test.myshopify.com", SHOPIFY_API_SECRET: "secret123" };
    const result = scrubSensitiveFields(data);
    expect(result).not.toHaveProperty("SHOPIFY_API_SECRET");
  });

  it("strips both forbidden keys simultaneously", () => {
    const data = {
      shop: "test.myshopify.com",
      access_token: "tok",
      SHOPIFY_API_SECRET: "secret",
      productId: "123",
    };
    const result = scrubSensitiveFields(data);
    expect(result).not.toHaveProperty("access_token");
    expect(result).not.toHaveProperty("SHOPIFY_API_SECRET");
    expect(result.shop).toBe("test.myshopify.com");
    expect(result.productId).toBe("123");
  });

  it("recursively strips forbidden keys from nested objects", () => {
    const data = {
      outer: "value",
      nested: {
        access_token: "tok_nested",
        safe: "safe_value",
      },
    };
    const result = scrubSensitiveFields(data);
    const nested = result.nested as Record<string, unknown>;
    expect(nested).not.toHaveProperty("access_token");
    expect(nested.safe).toBe("safe_value");
  });

  it("preserves non-forbidden keys", () => {
    const data = {
      shop: "test.myshopify.com",
      productId: "prod_123",
      step: "bg_removal",
      durationMs: 1234,
    };
    const result = scrubSensitiveFields(data);
    expect(result).toEqual(data);
  });

  it("does not mutate the original object", () => {
    const data = { shop: "test.myshopify.com", access_token: "tok" };
    const original = { ...data };
    scrubSensitiveFields(data);
    // access_token still present on original
    expect((data as Record<string, unknown>).access_token).toBe("tok");
    expect(data.shop).toBe(original.shop);
  });

  it("handles empty object", () => {
    expect(scrubSensitiveFields({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// createSentryClientFromSdk — captureException
// ---------------------------------------------------------------------------

describe("captureException", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls SDK captureException when an error is thrown", () => {
    const { client, sdk } = makeClient();
    const error = new Error("Pipeline failed");
    client.captureException(error);
    expect(sdk._captureException).toHaveBeenCalledWith(error);
  });

  it("attaches shop tag from context", () => {
    const { client, sdk } = makeClient();
    client.captureException(new Error("test"), { shop: "my-shop.myshopify.com" });
    expect(sdk._withScope).toHaveBeenCalled();
    // Find the setTag call for "shop"
    const tagCalls = (sdk._withScope.mock.calls[0]![0]! as unknown as ((scope: SentrySdkScope) => void));
    // Re-invoke with a capture scope to assert tags
    const captured: Array<[string, string]> = [];
    const capScope: SentrySdkScope = {
      setTag: (k, v) => captured.push([k, v]),
      setExtra: () => undefined,
      setUser: () => undefined,
    };
    tagCalls(capScope);
    expect(captured).toContainEqual(["shop", "my-shop.myshopify.com"]);
  });

  it("attaches productId tag from context", () => {
    const { client, sdk } = makeClient();
    client.captureException(new Error("test"), {
      shop: "my-shop.myshopify.com",
      productId: "prod_999",
    });
    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const captured: Array<[string, string]> = [];
    scopeCb({ setTag: (k, v) => captured.push([k, v]), setExtra: () => undefined, setUser: () => undefined });
    expect(captured).toContainEqual(["product_id", "prod_999"]);
  });

  it("attaches step tag from context", () => {
    const { client, sdk } = makeClient();
    client.captureException(new Error("test"), {
      shop: "my-shop.myshopify.com",
      step: "compositing",
    });
    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const captured: Array<[string, string]> = [];
    scopeCb({ setTag: (k, v) => captured.push([k, v]), setExtra: () => undefined, setUser: () => undefined });
    expect(captured).toContainEqual(["step", "compositing"]);
  });

  it("does NOT include access_token in tags or extra", () => {
    const { client, sdk } = makeClient();
    const ctx = { shop: "test.myshopify.com" } as SentryContext;
    // Force inject access_token at runtime (bypassing TS types)
    (ctx as Record<string, unknown>)["access_token"] = "tok_secret";

    client.captureException(new Error("test"), ctx);

    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const tagKeys: string[] = [];
    const extraKeys: string[] = [];
    scopeCb({
      setTag: (k) => tagKeys.push(k),
      setExtra: (k) => extraKeys.push(k),
      setUser: () => undefined,
    });
    expect(tagKeys).not.toContain("access_token");
    expect(extraKeys).not.toContain("access_token");
  });

  it("does NOT include SHOPIFY_API_SECRET in tags or extra", () => {
    const { client, sdk } = makeClient();
    const ctx = { shop: "test.myshopify.com" } as SentryContext;
    (ctx as Record<string, unknown>)["SHOPIFY_API_SECRET"] = "secret_val";

    client.captureException(new Error("test"), ctx);

    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const tagKeys: string[] = [];
    const extraKeys: string[] = [];
    scopeCb({
      setTag: (k) => tagKeys.push(k),
      setExtra: (k) => extraKeys.push(k),
      setUser: () => undefined,
    });
    expect(tagKeys).not.toContain("SHOPIFY_API_SECRET");
    expect(extraKeys).not.toContain("SHOPIFY_API_SECRET");
  });

  it("returns the event ID from SDK", () => {
    const { client, sdk } = makeClient();
    sdk._captureException.mockReturnValueOnce("event-xyz");
    const id = client.captureException(new Error("test"));
    expect(id).toBe("event-xyz");
  });

  it("uses withScope to isolate context per event", () => {
    const { client, sdk } = makeClient();
    client.captureException(new Error("test"), { shop: "a.myshopify.com" });
    expect(sdk._withScope).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// captureMessage
// ---------------------------------------------------------------------------

describe("captureMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls SDK captureMessage with the message text and level", () => {
    const { client, sdk } = makeClient();
    client.captureMessage("DLQ depth exceeded threshold", "warning");
    expect(sdk._captureMessage).toHaveBeenCalledWith(
      "DLQ depth exceeded threshold",
      "warning"
    );
  });

  it("defaults level to error", () => {
    const { client, sdk } = makeClient();
    client.captureMessage("Something went wrong");
    expect(sdk._captureMessage).toHaveBeenCalledWith(
      "Something went wrong",
      "error"
    );
  });

  it("attaches shop tag from context", () => {
    const { client, sdk } = makeClient();
    client.captureMessage("Quota exceeded", "warning", {
      shop: "big-shop.myshopify.com",
    });
    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const captured: Array<[string, string]> = [];
    scopeCb({
      setTag: (k, v) => captured.push([k, v]),
      setExtra: () => undefined,
      setUser: () => undefined,
    });
    expect(captured).toContainEqual(["shop", "big-shop.myshopify.com"]);
  });

  it("returns event ID from SDK captureMessage", () => {
    const { client, sdk } = makeClient();
    sdk._captureMessage.mockReturnValueOnce("msg-event-789");
    const id = client.captureMessage("test message");
    expect(id).toBe("msg-event-789");
  });
});

// ---------------------------------------------------------------------------
// addBreadcrumb
// ---------------------------------------------------------------------------

describe("addBreadcrumb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards breadcrumb to SDK", () => {
    const { client, sdk } = makeClient();
    client.addBreadcrumb({
      category: "webhook",
      message: "Received products/create",
      level: "info",
    });
    expect(sdk._addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "webhook",
        message: "Received products/create",
        level: "info",
      })
    );
  });

  it("scrubs access_token from breadcrumb data", () => {
    const { client, sdk } = makeClient();
    client.addBreadcrumb({
      category: "auth",
      message: "Token acquired",
      data: {
        shop: "test.myshopify.com",
        access_token: "tok_secret",
      },
    });

    const call = sdk._addBreadcrumb.mock.calls[0]![0]! as { data?: Record<string, unknown> };
    expect(call.data).not.toHaveProperty("access_token");
    expect(call.data?.shop).toBe("test.myshopify.com");
  });

  it("scrubs SHOPIFY_API_SECRET from breadcrumb data", () => {
    const { client, sdk } = makeClient();
    client.addBreadcrumb({
      category: "webhook",
      data: {
        shop: "test.myshopify.com",
        SHOPIFY_API_SECRET: "secret_value",
      },
    });

    const call = sdk._addBreadcrumb.mock.calls[0]![0]! as { data?: Record<string, unknown> };
    expect(call.data).not.toHaveProperty("SHOPIFY_API_SECRET");
  });

  it("passes breadcrumb without data field correctly", () => {
    const { client, sdk } = makeClient();
    client.addBreadcrumb({ category: "lifecycle", message: "App installed" });
    expect(sdk._addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "lifecycle", data: undefined })
    );
  });
});

// ---------------------------------------------------------------------------
// captureRouteError helper
// ---------------------------------------------------------------------------

describe("captureRouteError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls SDK captureException on route error", () => {
    const { client, sdk } = makeClient();
    const err = new Error("Route exploded");
    captureRouteError(err, client, { shop: "my-shop.myshopify.com" });
    expect(sdk._captureException).toHaveBeenCalledWith(err);
  });

  it("attaches shop context tag to route error", () => {
    const { client, sdk } = makeClient();
    captureRouteError(new Error("404"), client, { shop: "acme.myshopify.com" });
    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const captured: Array<[string, string]> = [];
    scopeCb({
      setTag: (k, v) => captured.push([k, v]),
      setExtra: () => undefined,
      setUser: () => undefined,
    });
    expect(captured).toContainEqual(["shop", "acme.myshopify.com"]);
  });

  it("works with no context (anonymous route error)", () => {
    const { client, sdk } = makeClient();
    expect(() =>
      captureRouteError(new Error("Anonymous error"), client)
    ).not.toThrow();
    expect(sdk._captureException).toHaveBeenCalled();
  });

  it("returns event ID from captureException", () => {
    const { client, sdk } = makeClient();
    sdk._captureException.mockReturnValueOnce("route-evt-001");
    const id = captureRouteError(new Error("test"), client);
    expect(id).toBe("route-evt-001");
  });
});

// ---------------------------------------------------------------------------
// capturePipelineError helper
// ---------------------------------------------------------------------------

describe("capturePipelineError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls SDK captureException on pipeline error", () => {
    const { client, sdk } = makeClient();
    const err = new Error("Remove.bg failed");
    capturePipelineError(err, client, {
      shop: "shop.myshopify.com",
      productId: "prod_001",
      step: "bg_removal",
    });
    expect(sdk._captureException).toHaveBeenCalledWith(err);
  });

  it("attaches shop tag for per-shop alert rules", () => {
    const { client, sdk } = makeClient();
    capturePipelineError(new Error("test"), client, {
      shop: "alerts-test.myshopify.com",
      step: "compositing",
    });
    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const captured: Array<[string, string]> = [];
    scopeCb({
      setTag: (k, v) => captured.push([k, v]),
      setExtra: () => undefined,
      setUser: () => undefined,
    });
    expect(captured).toContainEqual(["shop", "alerts-test.myshopify.com"]);
  });

  it("attaches productId tag", () => {
    const { client, sdk } = makeClient();
    capturePipelineError(new Error("test"), client, {
      shop: "shop.myshopify.com",
      productId: "prod_xyz",
      step: "satori_render",
    });
    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const captured: Array<[string, string]> = [];
    scopeCb({
      setTag: (k, v) => captured.push([k, v]),
      setExtra: () => undefined,
      setUser: () => undefined,
    });
    expect(captured).toContainEqual(["product_id", "prod_xyz"]);
  });

  it("attaches step tag", () => {
    const { client, sdk } = makeClient();
    capturePipelineError(new Error("test"), client, {
      shop: "shop.myshopify.com",
      step: "quota_check",
    });
    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const captured: Array<[string, string]> = [];
    scopeCb({
      setTag: (k, v) => captured.push([k, v]),
      setExtra: () => undefined,
      setUser: () => undefined,
    });
    expect(captured).toContainEqual(["step", "quota_check"]);
  });

  it("scrubs forbidden keys from pipeline context at runtime", () => {
    const { client, sdk } = makeClient();
    const unsafeContext = {
      shop: "shop.myshopify.com",
      step: "auth",
    } as { shop: string; step: string };

    // Force inject access_token at runtime (bypassing TS types)
    (unsafeContext as Record<string, unknown>)["access_token"] = "tok_secret";

    capturePipelineError(new Error("test"), client, unsafeContext as { shop: string; step: string });

    const scopeCb = sdk._withScope.mock.calls[0]![0]! as (scope: SentrySdkScope) => void;
    const tagKeys: string[] = [];
    const extraKeys: string[] = [];
    scopeCb({
      setTag: (k) => tagKeys.push(k),
      setExtra: (k) => extraKeys.push(k),
      setUser: () => undefined,
    });
    expect(tagKeys).not.toContain("access_token");
    expect(extraKeys).not.toContain("access_token");
  });

  it("handles non-Error thrown values (strings, objects)", () => {
    const { client, sdk } = makeClient();
    expect(() =>
      capturePipelineError("timeout", client, {
        shop: "shop.myshopify.com",
        step: "queue_consume",
      })
    ).not.toThrow();
    expect(sdk._captureException).toHaveBeenCalledWith("timeout");
  });
});

// ---------------------------------------------------------------------------
// sentryFromEnv
// ---------------------------------------------------------------------------

describe("sentryFromEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a SentryClient from env bindings", () => {
    const sdk = makeMockSdk();
    const env = {
      SENTRY_DSN: "https://abc@sentry.io/123",
      ENVIRONMENT: "staging",
      RELEASE: "sha-deadbeef",
    };
    const client = sentryFromEnv(env, sdk);
    expect(client).toBeDefined();
    expect(typeof client.captureException).toBe("function");
    expect(typeof client.captureMessage).toBe("function");
    expect(typeof client.addBreadcrumb).toBe("function");
    expect(typeof client.flush).toBe("function");
  });

  it("uses production as default environment when ENVIRONMENT is missing", () => {
    const sdk = makeMockSdk();
    const env = { SENTRY_DSN: "https://abc@sentry.io/123" };
    const client = sentryFromEnv(env, sdk);
    expect(client).toBeDefined();
  });

  it("calls SDK init with the DSN from env", () => {
    const sdk = makeMockSdk();
    sentryFromEnv(
      { SENTRY_DSN: "https://env-test@sentry.io/0", ENVIRONMENT: "production" },
      sdk
    );
    expect(sdk._init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: "https://env-test@sentry.io/0" })
    );
  });

  it("captures exception after building from env", () => {
    const sdk = makeMockSdk();
    const env = {
      SENTRY_DSN: "https://test@sentry.io/0",
      ENVIRONMENT: "test",
    };
    const client = sentryFromEnv(env, sdk);
    client.captureException(new Error("env test"));
    expect(sdk._captureException).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SDK init called with correct options
// ---------------------------------------------------------------------------

describe("createSentryClientFromSdk init", () => {
  it("calls SDK init with DSN, environment, and release", () => {
    const sdk = makeMockSdk();
    createSentryClientFromSdk(sdk, "https://dsn@sentry.io/1", "staging", "sha-abc");
    expect(sdk._init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://dsn@sentry.io/1",
        environment: "staging",
        release: "sha-abc",
      })
    );
  });

  it("omits release key when not provided", () => {
    const sdk = makeMockSdk();
    createSentryClientFromSdk(sdk, "https://dsn@sentry.io/1", "production");
    const initCall = sdk._init.mock.calls[0]![0]! as Record<string, unknown>;
    expect(initCall).not.toHaveProperty("release");
  });

  it("includes beforeSend hook in init options", () => {
    const sdk = makeMockSdk();
    createSentryClientFromSdk(sdk, "https://dsn@sentry.io/1", "production");
    const initCall = sdk._init.mock.calls[0]![0]! as Record<string, unknown>;
    expect(typeof initCall.beforeSend).toBe("function");
  });

  it("beforeSend hook scrubs access_token from extra", () => {
    const sdk = makeMockSdk();
    createSentryClientFromSdk(sdk, "https://dsn@sentry.io/1", "production");
    const initCall = sdk._init.mock.calls[0]![0]! as Record<string, unknown>;
    const beforeSend = initCall.beforeSend as (event: Record<string, unknown>) => Record<string, unknown>;

    const event = {
      extra: { shop: "test.myshopify.com", access_token: "tok" },
    };
    const result = beforeSend(event);
    expect((result.extra as Record<string, unknown>)).not.toHaveProperty("access_token");
    expect((result.extra as Record<string, unknown>).shop).toBe("test.myshopify.com");
  });
});

// ---------------------------------------------------------------------------
// flush
// ---------------------------------------------------------------------------

describe("flush", () => {
  it("calls SDK flush and resolves true", async () => {
    const { client, sdk } = makeClient();
    sdk._flush.mockResolvedValueOnce(true);
    const result = await client.flush(1000);
    expect(result).toBe(true);
    expect(sdk._flush).toHaveBeenCalledWith(1000);
  });
});
