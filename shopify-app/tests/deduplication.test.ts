/**
 * PR-007: Webhook deduplication via KV idempotency keys — unit tests
 *
 * Covers:
 *  1. First occurrence is processed (key absent → written, isDuplicate = false)
 *  2. Duplicate is skipped (key present → isDuplicate = true)
 *  3. After TTL expiry (key absent again) → isDuplicate = false (reprocessed)
 *  4. Integration with handleWebhook: duplicate webhook does not call DB insert
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkDeduplication, IDEMPOTENCY_TTL_SECONDS } from "../src/deduplication.server.js";
import { handleWebhook, type WebhookTopic } from "../src/webhook.server.js";
import { createMockD1, createMockKV } from "./setup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test_webhook_secret";

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

async function buildWebhookRequest(
  topic: WebhookTopic,
  body: object,
  options: { shop?: string; webhookId?: string } = {}
): Promise<Request> {
  const rawBody = JSON.stringify(body);
  const { shop = "mystore.myshopify.com", webhookId = "wh_dedup_001" } = options;
  const hmac = await signBody(rawBody, SECRET);

  return new Request("https://myapp.example.com/webhooks/shopify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": shop,
      "X-Shopify-Webhook-Id": webhookId,
      "X-Shopify-Hmac-Sha256": hmac,
    },
    body: rawBody,
  });
}

function createMockCtx(): Pick<ExecutionContext, "waitUntil"> {
  return {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      return promise;
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. checkDeduplication() unit tests
// ---------------------------------------------------------------------------

describe("checkDeduplication()", () => {
  it("returns isDuplicate=false for first occurrence and writes key to KV", async () => {
    const kv = createMockKV();
    const result = await checkDeduplication("wh_001", "shop.myshopify.com", "products/create", kv);

    expect(result.isDuplicate).toBe(false);
    expect(kv.put).toHaveBeenCalledWith(
      "webhook:wh_001",
      "1",
      { expirationTtl: IDEMPOTENCY_TTL_SECONDS }
    );
  });

  it("returns isDuplicate=true for duplicate (key already in KV)", async () => {
    const kv = createMockKV();

    // Simulate key already present — first call to get returns "1"
    (kv.get as ReturnType<typeof vi.fn>).mockResolvedValue("1");

    const result = await checkDeduplication("wh_001", "shop.myshopify.com", "products/create", kv);

    expect(result.isDuplicate).toBe(true);
    // Should NOT write the key again
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("returns isDuplicate=false after TTL expiry (key absent again)", async () => {
    const kv = createMockKV();

    // Simulate key absent (TTL expired) — get returns null
    (kv.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await checkDeduplication("wh_001", "shop.myshopify.com", "products/create", kv);

    expect(result.isDuplicate).toBe(false);
    // Key should be re-written with 24-hour TTL
    expect(kv.put).toHaveBeenCalledWith(
      "webhook:wh_001",
      "1",
      { expirationTtl: IDEMPOTENCY_TTL_SECONDS }
    );
  });

  it("uses the correct KV key format: webhook:{webhookId}", async () => {
    const kv = createMockKV();
    await checkDeduplication("my-webhook-xyz", "shop.myshopify.com", "app/uninstalled", kv);

    expect(kv.get).toHaveBeenCalledWith("webhook:my-webhook-xyz");
  });

  it("uses 24-hour TTL (86400 seconds)", () => {
    expect(IDEMPOTENCY_TTL_SECONDS).toBe(86_400);
  });
});

// ---------------------------------------------------------------------------
// 2. handleWebhook() integration — deduplication behaviour
// ---------------------------------------------------------------------------

describe("handleWebhook() — deduplication integration", () => {
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

  it("processes first occurrence and writes idempotency key to KV", async () => {
    const req = await buildWebhookRequest("products/create", { id: 1 }, { webhookId: "wh_first" });
    const { response } = await handleWebhook(req, env, ctx);

    expect(response.status).toBe(200);

    // Flush waitUntil
    const calls = (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls as [[Promise<void>]];
    await calls[0][0];

    // KV key should have been written
    expect(kv.put).toHaveBeenCalledWith(
      "webhook:wh_first",
      "1",
      { expirationTtl: IDEMPOTENCY_TTL_SECONDS }
    );
  });

  it("returns 200 for a duplicate but skips DB insert", async () => {
    // Simulate duplicate: KV already has the key
    (kv.get as ReturnType<typeof vi.fn>).mockResolvedValue("1");

    const mockRun = vi.fn().mockResolvedValue({ success: true, meta: {} });
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: mockRun,
      first: vi.fn().mockResolvedValue(null),
    });

    const req = await buildWebhookRequest(
      "products/create",
      { id: 1 },
      { webhookId: "wh_duplicate" }
    );
    const { response } = await handleWebhook(req, env, ctx);

    expect(response.status).toBe(200);

    // Flush waitUntil
    const calls = (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls as [[Promise<void>]];
    await calls[0][0];

    // DB insert should NOT have been called (duplicate was skipped)
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("processes the same webhook ID again after TTL expiry (key absent)", async () => {
    // Simulate TTL expired: get returns null
    (kv.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = await buildWebhookRequest(
      "products/update",
      { id: 2 },
      { webhookId: "wh_expired" }
    );
    const { response } = await handleWebhook(req, env, ctx);

    expect(response.status).toBe(200);

    // Flush waitUntil
    const calls = (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls as [[Promise<void>]];
    await calls[0][0];

    // Key should be re-written (first occurrence again after expiry)
    expect(kv.put).toHaveBeenCalledWith(
      "webhook:wh_expired",
      "1",
      { expirationTtl: IDEMPOTENCY_TTL_SECONDS }
    );
  });
});
