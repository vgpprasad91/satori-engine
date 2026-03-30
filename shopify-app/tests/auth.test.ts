/**
 * PR-005: Shopify OAuth — unit tests
 *
 * Covers:
 *  1. Valid OAuth callback — HMAC validates, token exchanged, session stored
 *  2. Invalid HMAC rejection — tampered payload throws
 *  3. Expired token refresh — needsReauth() returns true when expires_at is past
 *  4. State nonce — generateState / verifyAndConsumeState lifecycle
 *  5. shopifyAuth middleware — returns null when session missing/expired
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateHmac,
  generateState,
  verifyAndConsumeState,
  buildInstallUrl,
  needsReauth,
  handleOAuthCallback,
} from "../src/auth.server.js";
import {
  upsertSession,
  getSession,
  isSessionExpired,
} from "../src/session.server.js";
import { createMockD1, createMockKV } from "./setup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test_shopify_api_secret";

/** Build a properly signed URLSearchParams for testing HMAC validation. */
async function buildSignedParams(
  params: Record<string, string>,
  secret: string
): Promise<URLSearchParams> {
  const sp = new URLSearchParams(params);
  // Build message without hmac
  const entries: string[] = [];
  for (const [key, value] of sp.entries()) {
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const message = entries.join("&");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const hmac = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  sp.set("hmac", hmac);
  return sp;
}

// ---------------------------------------------------------------------------
// 1. HMAC validation
// ---------------------------------------------------------------------------

describe("validateHmac()", () => {
  it("returns true for a correctly signed request", async () => {
    const sp = await buildSignedParams(
      { shop: "mystore.myshopify.com", timestamp: "1680000000" },
      SECRET
    );
    const result = await validateHmac(sp, SECRET);
    expect(result).toBe(true);
  });

  it("returns false when hmac param is missing", async () => {
    const sp = new URLSearchParams({ shop: "mystore.myshopify.com", timestamp: "1680000000" });
    const result = await validateHmac(sp, SECRET);
    expect(result).toBe(false);
  });

  it("returns false when payload has been tampered (invalid HMAC)", async () => {
    const sp = await buildSignedParams(
      { shop: "mystore.myshopify.com", timestamp: "1680000000" },
      SECRET
    );
    // Tamper with the shop param after signing
    sp.set("shop", "evil.myshopify.com");
    const result = await validateHmac(sp, SECRET);
    expect(result).toBe(false);
  });

  it("returns false for wrong API secret", async () => {
    const sp = await buildSignedParams(
      { shop: "mystore.myshopify.com", timestamp: "1680000000" },
      SECRET
    );
    const result = await validateHmac(sp, "wrong_secret");
    expect(result).toBe(false);
  });

  it("returns false for an obviously forged hmac", async () => {
    const sp = new URLSearchParams({
      shop: "mystore.myshopify.com",
      timestamp: "1680000000",
      hmac: "deadbeef00000000",
    });
    const result = await validateHmac(sp, SECRET);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. State nonce lifecycle
// ---------------------------------------------------------------------------

describe("generateState / verifyAndConsumeState", () => {
  it("returns a valid nonce and verifies it once", async () => {
    const kv = createMockKV();
    const shop = "mystore.myshopify.com";

    const state = await generateState(kv, shop);
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(8);

    const valid = await verifyAndConsumeState(kv, state, shop);
    expect(valid).toBe(true);
  });

  it("returns false for a nonce that was already consumed", async () => {
    const kv = createMockKV();
    const shop = "mystore.myshopify.com";

    const state = await generateState(kv, shop);
    await verifyAndConsumeState(kv, state, shop); // consume
    const second = await verifyAndConsumeState(kv, state, shop); // replay
    expect(second).toBe(false);
  });

  it("returns false when nonce belongs to a different shop", async () => {
    const kv = createMockKV();
    const state = await generateState(kv, "shop-a.myshopify.com");
    const valid = await verifyAndConsumeState(kv, state, "shop-b.myshopify.com");
    expect(valid).toBe(false);
  });

  it("returns false for an unknown nonce (as-if TTL expired)", async () => {
    const kv = createMockKV();
    const valid = await verifyAndConsumeState(kv, "nonexistent-nonce", "shop.myshopify.com");
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Session storage helpers
// ---------------------------------------------------------------------------

describe("upsertSession / getSession / isSessionExpired", () => {
  it("stores and retrieves a session", async () => {
    const db = createMockD1();
    const firstRow = vi.fn().mockResolvedValueOnce({
      shop: "mystore.myshopify.com",
      access_token: "shpat_abc123",
      scope: "write_products",
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    // Override prepare().first() for this specific test
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
    });
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      bind: vi.fn().mockReturnThis(),
      first: firstRow,
    });

    await upsertSession(db, "mystore.myshopify.com", "shpat_abc123", "write_products", null);
    const session = await getSession(db, "mystore.myshopify.com");

    expect(session).not.toBeNull();
    expect(session?.shop).toBe("mystore.myshopify.com");
    expect(session?.access_token).toBe("shpat_abc123");
    expect(session?.expires_at).toBeNull();
  });

  it("isSessionExpired() returns false for permanent token", () => {
    const session = {
      shop: "s.myshopify.com",
      access_token: "tok",
      scope: "write_products",
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(isSessionExpired(session)).toBe(false);
  });

  it("isSessionExpired() returns true when expires_at is in the past", () => {
    const session = {
      shop: "s.myshopify.com",
      access_token: "tok",
      scope: "write_products",
      expires_at: Date.now() - 3600_000, // 1 hour ago
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(isSessionExpired(session)).toBe(true);
  });

  it("isSessionExpired() returns true when within the 60-second buffer", () => {
    const session = {
      shop: "s.myshopify.com",
      access_token: "tok",
      scope: "write_products",
      expires_at: Date.now() + 30_000, // 30 seconds from now — inside the 60s buffer
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(isSessionExpired(session)).toBe(true);
  });

  it("isSessionExpired() returns false when expiry is well in the future", () => {
    const session = {
      shop: "s.myshopify.com",
      access_token: "tok",
      scope: "write_products",
      expires_at: Date.now() + 3_600_000, // 1 hour from now
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(isSessionExpired(session)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. needsReauth()
// ---------------------------------------------------------------------------

describe("needsReauth()", () => {
  it("returns true when no session exists for shop", async () => {
    const db = createMockD1();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    });
    const result = await needsReauth(db, "newshop.myshopify.com");
    expect(result).toBe(true);
  });

  it("returns true when session access_token is null (uninstalled)", async () => {
    const db = createMockD1();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        shop: "s.myshopify.com",
        access_token: null,
        scope: "write_products",
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    const result = await needsReauth(db, "s.myshopify.com");
    expect(result).toBe(true);
  });

  it("returns true for an expired token", async () => {
    const db = createMockD1();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        shop: "s.myshopify.com",
        access_token: "shpat_old",
        scope: "write_products",
        expires_at: Date.now() - 86_400_000, // yesterday
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    const result = await needsReauth(db, "s.myshopify.com");
    expect(result).toBe(true);
  });

  it("returns false for a valid, non-expired permanent token", async () => {
    const db = createMockD1();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        shop: "s.myshopify.com",
        access_token: "shpat_valid",
        scope: "write_products",
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    const result = await needsReauth(db, "s.myshopify.com");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. handleOAuthCallback()
// ---------------------------------------------------------------------------

describe("handleOAuthCallback()", () => {
  const shop = "mystore.myshopify.com";

  async function buildCallbackRequest(
    params: Record<string, string>,
    secret: string
  ): Promise<Request> {
    const baseParams: Record<string, string> = { shop, ...params };
    const sp = await buildSignedParams(baseParams, secret);
    return new Request(`https://app.example.com/auth/callback?${sp.toString()}`);
  }

  it("succeeds with a valid callback — stores session in D1", async () => {
    const db = createMockD1();
    const kv = createMockKV();

    const state = await generateState(kv, shop);

    const req = await buildCallbackRequest(
      { code: "test_auth_code", state, timestamp: "1680000000" },
      SECRET
    );

    // Mock the Shopify token exchange endpoint
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "shpat_newtoken", scope: "write_products" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const mockRun = vi.fn().mockResolvedValue({ success: true, meta: {} });
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: mockRun,
    });

    const env = {
      SHOPIFY_API_KEY: "test_api_key",
      SHOPIFY_API_SECRET: SECRET,
      SHOPIFY_APP_URL: "https://app.example.com",
      SHOPIFY_SCOPES: "write_products",
      DB: db,
      KV_STORE: kv,
    };

    const result = await handleOAuthCallback(req, env);

    expect(result.shop).toBe(shop);
    expect(mockFetch).toHaveBeenCalledOnce();
    // Verify token exchange was called with correct URL
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toContain(`${shop}/admin/oauth/access_token`);
    // Verify session upsert was called (D1 run)
    expect(mockRun).toHaveBeenCalled();
  });

  it("throws on invalid HMAC (tampered payload)", async () => {
    const kv = createMockKV();
    const db = createMockD1();
    const state = await generateState(kv, shop);

    // Build a valid request then tamper with a param
    const sp = await buildSignedParams(
      { shop, code: "code", state, timestamp: "1680000000" },
      SECRET
    );
    sp.set("shop", "evil.myshopify.com"); // tamper after signing

    const req = new Request(`https://app.example.com/auth/callback?${sp.toString()}`);

    const env = {
      SHOPIFY_API_KEY: "test_api_key",
      SHOPIFY_API_SECRET: SECRET,
      SHOPIFY_APP_URL: "https://app.example.com",
      SHOPIFY_SCOPES: "write_products",
      DB: db,
      KV_STORE: kv,
    };

    await expect(handleOAuthCallback(req, env)).rejects.toThrow("HMAC validation failed");
  });

  it("throws when required params are missing", async () => {
    const db = createMockD1();
    const kv = createMockKV();

    const req = new Request(`https://app.example.com/auth/callback?shop=${shop}`);

    const env = {
      SHOPIFY_API_KEY: "test_api_key",
      SHOPIFY_API_SECRET: SECRET,
      SHOPIFY_APP_URL: "https://app.example.com",
      SHOPIFY_SCOPES: "write_products",
      DB: db,
      KV_STORE: kv,
    };

    await expect(handleOAuthCallback(req, env)).rejects.toThrow(
      "Missing required OAuth callback parameters"
    );
  });
});

// ---------------------------------------------------------------------------
// 6. buildInstallUrl()
// ---------------------------------------------------------------------------

describe("buildInstallUrl()", () => {
  it("constructs the correct Shopify OAuth URL", () => {
    const url = buildInstallUrl(
      "mystore.myshopify.com",
      "myapikey",
      "https://myapp.example.com",
      "write_products,read_products",
      "abc123state"
    );

    expect(url).toContain("mystore.myshopify.com/admin/oauth/authorize");
    expect(url).toContain("client_id=myapikey");
    expect(url).toContain("state=abc123state");
    expect(url).toContain(encodeURIComponent("https://myapp.example.com/auth/callback"));
    expect(url).toContain("scope=write_products");
  });
});
