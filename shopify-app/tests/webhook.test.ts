/**
 * PR-006: Webhook ingestion and HMAC validation — unit tests
 *
 * Covers:
 *  1. Valid HMAC passes — request processed, 200 returned
 *  2. Tampered payload rejected — 401 returned, no processing
 *  3. Missing HMAC header rejected — 401 returned
 *  4. All 7 webhook topics handled (no unhandled-topic errors)
 *  5. 200 returned immediately (before waitUntil processing completes)
 *  6. DB receipt logged for valid webhooks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateWebhookHmac,
  handleWebhook,
  type WebhookTopic,
} from "../src/webhook.server.js";
import { createMockD1, createMockKV } from "./setup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test_webhook_secret";

/** Signs a raw body string and returns the Base64 HMAC. */
async function signBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Builds a mock Shopify webhook request. */
async function buildWebhookRequest(
  topic: WebhookTopic,
  body: object,
  options: {
    secret?: string;
    tamperBody?: string;
    omitHmac?: boolean;
    shop?: string;
    webhookId?: string;
  } = {}
): Promise<Request> {
  const rawBody = JSON.stringify(body);
  const {
    secret = SECRET,
    tamperBody,
    omitHmac = false,
    shop = "mystore.myshopify.com",
    webhookId = "wh_test_123",
  } = options;

  const hmac = omitHmac ? undefined : await signBody(rawBody, secret);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Shopify-Topic": topic,
    "X-Shopify-Shop-Domain": shop,
    "X-Shopify-Webhook-Id": webhookId,
  };

  if (hmac) {
    headers["X-Shopify-Hmac-Sha256"] = hmac;
  }

  return new Request("https://myapp.example.com/webhooks/shopify", {
    method: "POST",
    headers,
    body: tamperBody ?? rawBody,
  });
}

/** Minimal mock ExecutionContext */
function createMockCtx(): Pick<ExecutionContext, "waitUntil"> {
  return {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      // In tests, eagerly resolve the promise so we can assert side effects
      return promise;
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. validateWebhookHmac()
// ---------------------------------------------------------------------------

describe("validateWebhookHmac()", () => {
  it("returns true for a correctly signed body", async () => {
    const body = JSON.stringify({ id: 1, title: "Test Product" });
    const hmac = await signBody(body, SECRET);
    expect(await validateWebhookHmac(body, hmac, SECRET)).toBe(true);
  });

  it("returns false when HMAC header is null", async () => {
    const body = JSON.stringify({ id: 1 });
    expect(await validateWebhookHmac(body, null, SECRET)).toBe(false);
  });

  it("returns false when body has been tampered after signing", async () => {
    const originalBody = JSON.stringify({ id: 1, title: "Original" });
    const hmac = await signBody(originalBody, SECRET);
    const tamperedBody = JSON.stringify({ id: 1, title: "Hacked" });
    expect(await validateWebhookHmac(tamperedBody, hmac, SECRET)).toBe(false);
  });

  it("returns false when wrong secret is used", async () => {
    const body = JSON.stringify({ id: 1 });
    const hmac = await signBody(body, SECRET);
    expect(await validateWebhookHmac(body, hmac, "wrong_secret")).toBe(false);
  });

  it("returns false for an obviously forged HMAC", async () => {
    const body = JSON.stringify({ id: 1 });
    expect(await validateWebhookHmac(body, "deadbeef==", SECRET)).toBe(false);
  });

  it("returns false for empty HMAC string", async () => {
    const body = JSON.stringify({ id: 1 });
    expect(await validateWebhookHmac(body, "", SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. handleWebhook() — valid HMAC passes, 200 returned immediately
// ---------------------------------------------------------------------------

describe("handleWebhook() — valid requests", () => {
  let db: D1Database;
  let kv: KVNamespace;
  let env: { SHOPIFY_API_SECRET: string; DB: D1Database; KV_STORE: KVNamespace };
  let ctx: Pick<ExecutionContext, "waitUntil">;

  beforeEach(() => {
    db = createMockD1();
    kv = createMockKV();
    env = { SHOPIFY_API_SECRET: SECRET, DB: db, KV_STORE: kv };
    ctx = createMockCtx();
  });

  it("returns 200 for a valid products/create webhook", async () => {
    const req = await buildWebhookRequest("products/create", { id: 1, title: "New Product" });
    const { response, result } = await handleWebhook(req, env, ctx);
    expect(response.status).toBe(200);
    expect(result.hmacValid).toBe(true);
    expect(result.topic).toBe("products/create");
  });

  it("returns 200 before waitUntil processing completes", async () => {
    let processingStarted = false;
    const slowCtx: Pick<ExecutionContext, "waitUntil"> = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        processingStarted = true;
        // Don't await — simulate real async processing
        promise.catch(() => {});
      }),
    };

    const req = await buildWebhookRequest("products/update", { id: 2, title: "Updated" });
    const { response } = await handleWebhook(req, env, slowCtx);

    // Response should already be 200 — not blocked on processing
    expect(response.status).toBe(200);
    expect(processingStarted).toBe(true);
  });

  it("calls ctx.waitUntil() for async processing", async () => {
    const req = await buildWebhookRequest("products/delete", { id: 3 });
    await handleWebhook(req, env, ctx);
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 3. handleWebhook() — invalid HMAC rejected
// ---------------------------------------------------------------------------

describe("handleWebhook() — HMAC rejection", () => {
  let db: D1Database;
  let kv: KVNamespace;
  let env: { SHOPIFY_API_SECRET: string; DB: D1Database; KV_STORE: KVNamespace };
  let ctx: Pick<ExecutionContext, "waitUntil">;

  beforeEach(() => {
    db = createMockD1();
    kv = createMockKV();
    env = { SHOPIFY_API_SECRET: SECRET, DB: db, KV_STORE: kv };
    ctx = createMockCtx();
  });

  it("returns 401 when HMAC header is missing", async () => {
    const req = await buildWebhookRequest("products/create", { id: 1 }, { omitHmac: true });
    const { response, result } = await handleWebhook(req, env, ctx);
    expect(response.status).toBe(401);
    expect(result.hmacValid).toBe(false);
  });

  it("returns 401 when body has been tampered", async () => {
    const req = await buildWebhookRequest(
      "products/create",
      { id: 1, title: "Original" },
      { tamperBody: JSON.stringify({ id: 1, title: "Hacked" }) }
    );
    const { response, result } = await handleWebhook(req, env, ctx);
    expect(response.status).toBe(401);
    expect(result.hmacValid).toBe(false);
  });

  it("returns 401 when signed with wrong secret", async () => {
    const req = await buildWebhookRequest("app/uninstalled", {}, { secret: "wrong_secret" });
    const { response, result } = await handleWebhook(req, env, ctx);
    expect(response.status).toBe(401);
    expect(result.hmacValid).toBe(false);
  });

  it("does NOT call ctx.waitUntil() on HMAC failure (no processing)", async () => {
    const req = await buildWebhookRequest("products/create", { id: 1 }, { omitHmac: true });
    await handleWebhook(req, env, ctx);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. All 7 webhook topics handled without errors
// ---------------------------------------------------------------------------

describe("handleWebhook() — all 7 topics accepted", () => {
  const topics: WebhookTopic[] = [
    "products/create",
    "products/update",
    "products/delete",
    "app/uninstalled",
    "customers/data_request",
    "customers/redact",
    "shop/redact",
  ];

  it.each(topics)("handles topic: %s", async (topic) => {
    const db = createMockD1();
    const kv = createMockKV();
    const env = { SHOPIFY_API_SECRET: SECRET, DB: db, KV_STORE: kv };
    const ctx = createMockCtx();

    const req = await buildWebhookRequest(topic, { id: 1 });
    const { response, result } = await handleWebhook(req, env, ctx);

    expect(response.status).toBe(200);
    expect(result.hmacValid).toBe(true);
    expect(result.topic).toBe(topic);
  });
});

// ---------------------------------------------------------------------------
// 5. DB receipt logging on successful processing
// ---------------------------------------------------------------------------

describe("handleWebhook() — DB logging", () => {
  it("inserts into webhook_log after successful processing", async () => {
    const db = createMockD1();
    const kv = createMockKV();
    const mockRun = vi.fn().mockResolvedValue({ success: true, meta: {} });

    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: mockRun,
    });

    const env = { SHOPIFY_API_SECRET: SECRET, DB: db, KV_STORE: kv };
    const ctx = createMockCtx();

    const req = await buildWebhookRequest("products/create", { id: 42, title: "Fancy Product" });
    const { response } = await handleWebhook(req, env, ctx);

    expect(response.status).toBe(200);

    // Eagerly flush the waitUntil promise
    const calls = (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls as [[Promise<void>]];
    const waitUntilArg = calls[0][0];
    await waitUntilArg;

    // DB should have been called to log the receipt
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR IGNORE INTO webhook_log")
    );
    expect(mockRun).toHaveBeenCalled();
  });
});
