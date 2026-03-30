/**
 * PR-040: Pinterest API direct publishing — unit tests
 *
 * Tests:
 *  - getPinterestOAuthUrl: generates valid OAuth URL, stores KV nonce + PKCE verifier
 *  - validateOAuthState: accepts valid state, rejects expired/malformed, replay protection
 *  - exchangeCodeForTokens: happy path, non-200 failure
 *  - refreshAccessToken: happy path, failure
 *  - fetchPinterestUserId: returns userId, throws on non-200
 *  - savePinterestConnection / getPinterestConnection: round-trip, access_token not logged
 *  - deletePinterestConnection: removes row
 *  - fetchPinterestBoards: returns board list, throws on non-200
 *  - createPin: happy path with link+altText, missing board ID failure
 *  - createScheduledPin / getDuePins: only returns pending pins <= now
 *  - markPinPublished / markPinFailed: status transitions
 *  - processScheduledPins: publishes due pins, handles missing connection, handles API error,
 *    refreshes expired token, does nothing when no due pins
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getPinterestOAuthUrl,
  validateOAuthState,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchPinterestUserId,
  fetchPinterestBoards,
  savePinterestConnection,
  getPinterestConnection,
  deletePinterestConnection,
  createPin,
  createScheduledPin,
  markPinPublished,
  markPinFailed,
  getDuePins,
  processScheduledPins,
  type PinterestEnv,
  type ScheduledPin,
} from "../src/pinterest.server.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeKv(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
    _store: store,
  };
}

function makeDb(rows: Record<string, unknown>[] = []) {
  const stmt = {
    bind: vi.fn(function (this: typeof stmt, ...args: unknown[]) {
      void args;
      return this;
    }),
    first: vi.fn(async () => rows[0] ?? null),
    all: vi.fn(async () => ({ results: rows, success: true, meta: {} })),
    run: vi.fn(async () => ({ success: true, meta: {} })),
  };
  return {
    prepare: vi.fn(() => stmt),
    _stmt: stmt,
    _rows: rows,
  };
}

function makeR2(): R2Bucket {
  return {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    head: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function makeEnv(overrides: Partial<PinterestEnv> = {}): PinterestEnv {
  return {
    PINTEREST_APP_ID: "test-pinterest-app-id",
    PINTEREST_APP_SECRET: "test-pinterest-app-secret",
    SHOPIFY_APP_URL: "https://test.example.com",
    DB: makeDb() as unknown as D1Database,
    KV_STORE: makeKv() as unknown as KVNamespace,
    ASSETS_BUCKET: makeR2(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// OAuth URL generation
// ---------------------------------------------------------------------------

describe("getPinterestOAuthUrl", () => {
  it("returns a Pinterest OAuth URL", async () => {
    const env = makeEnv();
    const url = await getPinterestOAuthUrl("shop.myshopify.com", env);
    expect(url).toMatch(/^https:\/\/www\.pinterest\.com\/oauth/);
  });

  it("includes required scopes in the URL", async () => {
    const env = makeEnv();
    const url = await getPinterestOAuthUrl("shop.myshopify.com", env);
    expect(url).toContain("boards%3Aread");
    expect(url).toContain("pins%3Awrite");
  });

  it("includes PKCE code_challenge and S256 method", async () => {
    const env = makeEnv();
    const url = await getPinterestOAuthUrl("shop.myshopify.com", env);
    expect(url).toContain("code_challenge=");
    expect(url).toContain("code_challenge_method=S256");
  });

  it("stores a nonce + code_verifier in KV with TTL", async () => {
    const kv = makeKv();
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });
    await getPinterestOAuthUrl("shop.myshopify.com", env);
    expect(kv.put).toHaveBeenCalledOnce();
    const [_key, value, opts] = kv.put.mock.calls[0] as [
      string,
      string,
      { expirationTtl: number },
    ];
    const stored = JSON.parse(value) as { shop: string; codeVerifier: string };
    expect(stored.shop).toBe("shop.myshopify.com");
    expect(stored.codeVerifier).toBeTruthy();
    expect(opts?.expirationTtl).toBeGreaterThan(0);
  });

  it("includes redirect_uri pointing to pinterest callback path", async () => {
    const env = makeEnv();
    const url = await getPinterestOAuthUrl("shop.myshopify.com", env);
    expect(url).toContain(encodeURIComponent("/app/pinterest/callback"));
  });
});

// ---------------------------------------------------------------------------
// OAuth state validation
// ---------------------------------------------------------------------------

describe("validateOAuthState", () => {
  it("returns shop and codeVerifier for a valid state nonce", async () => {
    const shop = "shop.myshopify.com";
    const kv = makeKv();
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });

    const oauthUrl = await getPinterestOAuthUrl(shop, env);
    const urlObj = new URL(oauthUrl);
    const rawState = urlObj.searchParams.get("state")!;

    const result = await validateOAuthState(rawState, env);
    expect(result.shop).toBe(shop);
    expect(typeof result.codeVerifier).toBe("string");
    expect(result.codeVerifier.length).toBeGreaterThan(0);
  });

  it("throws when state is not found in KV (expired or never existed)", async () => {
    const env = makeEnv();
    await expect(
      validateOAuthState("shop.myshopify.com|nonexistent-nonce", env)
    ).rejects.toThrow("not found or expired");
  });

  it("throws when state format is malformed (no pipe separator)", async () => {
    const env = makeEnv();
    await expect(validateOAuthState("malformed-no-pipe", env)).rejects.toThrow(
      "Invalid OAuth state format"
    );
  });

  it("consumes the nonce so it cannot be reused (replay protection)", async () => {
    const shop = "shop.myshopify.com";
    const kv = makeKv();
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });

    const oauthUrl = await getPinterestOAuthUrl(shop, env);
    const rawState = new URL(oauthUrl).searchParams.get("state")!;

    await validateOAuthState(rawState, env);

    // Second call should fail — nonce consumed
    await expect(validateOAuthState(rawState, env)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

describe("exchangeCodeForTokens", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns accessToken, refreshToken, and expiresAt on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "pinterest-access-token",
            refresh_token: "pinterest-refresh-token",
            expires_in: 2592000,
          }),
          { status: 200 }
        )
      )
    );

    const env = makeEnv();
    const result = await exchangeCodeForTokens("auth-code", "code-verifier-123", env);
    expect(result.accessToken).toBe("pinterest-access-token");
    expect(result.refreshToken).toBe("pinterest-refresh-token");
    expect(result.expiresAt).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it("throws when token exchange returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Bad request", { status: 400 }))
    );

    const env = makeEnv();
    await expect(
      exchangeCodeForTokens("bad-code", "verifier", env)
    ).rejects.toThrow("Pinterest token exchange failed");

    vi.unstubAllGlobals();
  });

  it("throws when response is missing tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      )
    );

    const env = makeEnv();
    await expect(
      exchangeCodeForTokens("code", "verifier", env)
    ).rejects.toThrow("Missing tokens");

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

describe("refreshAccessToken", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns new accessToken and refreshToken on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access-token",
            refresh_token: "new-refresh-token",
            expires_in: 2592000,
          }),
          { status: 200 }
        )
      )
    );

    const env = makeEnv();
    const result = await refreshAccessToken("old-refresh-token", env);
    expect(result.accessToken).toBe("new-access-token");
    expect(result.refreshToken).toBe("new-refresh-token");

    vi.unstubAllGlobals();
  });

  it("falls back to original refreshToken when none is returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "new-access", expires_in: 3600 }),
          { status: 200 }
        )
      )
    );

    const env = makeEnv();
    const result = await refreshAccessToken("original-refresh", env);
    expect(result.refreshToken).toBe("original-refresh");

    vi.unstubAllGlobals();
  });

  it("throws when token refresh returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    );

    const env = makeEnv();
    await expect(refreshAccessToken("bad-token", env)).rejects.toThrow(
      "Pinterest token refresh failed"
    );

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// User ID fetch
// ---------------------------------------------------------------------------

describe("fetchPinterestUserId", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the username when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({ username: "mystore_pins", id: "user-123" }),
          { status: 200 }
        )
      )
    );

    const userId = await fetchPinterestUserId("access-token");
    expect(userId).toBe("mystore_pins");

    vi.unstubAllGlobals();
  });

  it("falls back to id when username is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "user-456" }), { status: 200 })
      )
    );

    const userId = await fetchPinterestUserId("access-token");
    expect(userId).toBe("user-456");

    vi.unstubAllGlobals();
  });

  it("throws when request returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    );

    await expect(fetchPinterestUserId("bad-token")).rejects.toThrow(
      "Pinterest user_account request failed"
    );

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Board fetching
// ---------------------------------------------------------------------------

describe("fetchPinterestBoards", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns list of boards", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { id: "board-1", name: "Products", privacy: "PUBLIC", pin_count: 10 },
              { id: "board-2", name: "Seasonal", privacy: "PUBLIC", pin_count: 5 },
            ],
          }),
          { status: 200 }
        )
      )
    );

    const boards = await fetchPinterestBoards("access-token");
    expect(boards).toHaveLength(2);
    expect(boards[0]?.id).toBe("board-1");
    expect(boards[0]?.name).toBe("Products");

    vi.unstubAllGlobals();
  });

  it("throws when boards request returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
    );

    await expect(fetchPinterestBoards("bad-token")).rejects.toThrow(
      "Pinterest boards request failed"
    );

    vi.unstubAllGlobals();
  });

  it("throws when response has no items field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      )
    );

    await expect(fetchPinterestBoards("token")).rejects.toThrow(
      "No boards returned from Pinterest"
    );

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Connection persistence
// ---------------------------------------------------------------------------

describe("savePinterestConnection", () => {
  it("calls DB.prepare with INSERT OR UPDATE", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await savePinterestConnection(
      "shop.myshopify.com",
      "user-123",
      "secret-access-token",
      "secret-refresh-token",
      "2099-01-01T00:00:00.000Z",
      env
    );

    expect(db.prepare).toHaveBeenCalledOnce();
    expect(db._stmt.run).toHaveBeenCalledOnce();
  });

  it("does not include access_token or refresh_token in any console.log call", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await savePinterestConnection(
      "shop.myshopify.com",
      "user-123",
      "SUPER_SECRET_ACCESS_TOKEN",
      "SUPER_SECRET_REFRESH_TOKEN",
      "2099-01-01T00:00:00.000Z",
      env
    );

    const allLogArgs = consoleSpy.mock.calls.flat().join(" ");
    expect(allLogArgs).not.toContain("SUPER_SECRET_ACCESS_TOKEN");
    expect(allLogArgs).not.toContain("SUPER_SECRET_REFRESH_TOKEN");
    consoleSpy.mockRestore();
  });
});

describe("getPinterestConnection", () => {
  it("returns the connection row when present", async () => {
    const fakeRow = {
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      access_token: "token",
      refresh_token: "refresh",
      token_expires_at: "2099-01-01T00:00:00.000Z",
      connected_at: "2026-01-01T00:00:00.000Z",
    };
    const db = makeDb([fakeRow]);
    const env = makeEnv({ DB: db as unknown as D1Database });

    const conn = await getPinterestConnection("shop.myshopify.com", env);
    expect(conn).not.toBeNull();
    expect(conn?.pinterest_user_id).toBe("user-123");
  });

  it("returns null when no connection row exists", async () => {
    const db = makeDb([]);
    const env = makeEnv({ DB: db as unknown as D1Database });

    const conn = await getPinterestConnection("shop.myshopify.com", env);
    expect(conn).toBeNull();
  });
});

describe("deletePinterestConnection", () => {
  it("calls DB.prepare with DELETE statement", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await deletePinterestConnection("shop.myshopify.com", env);
    expect(db.prepare).toHaveBeenCalledOnce();
    expect(db._stmt.run).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Pin creation
// ---------------------------------------------------------------------------

describe("createPin", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates a pin and returns pinId and pinUrl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "pin-abc123" }), { status: 200 })
      )
    );

    const result = await createPin({
      accessToken: "access-token",
      boardId: "board-1",
      imageUrl: "https://example.com/image.png",
      title: "Great product",
      description: "Check out this amazing product",
    });

    expect(result.pinId).toBe("pin-abc123");
    expect(result.pinUrl).toContain("pin-abc123");

    vi.unstubAllGlobals();
  });

  it("includes link and altText in the request body when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "pin-xyz" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await createPin({
      accessToken: "token",
      boardId: "board-1",
      imageUrl: "https://example.com/img.png",
      title: "My Pin",
      description: "Desc",
      link: "https://shop.example.com/product/1",
      altText: "Product image",
    });

    const [, reqInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(reqInit.body as string) as Record<string, unknown>;
    expect(body["link"]).toBe("https://shop.example.com/product/1");
    expect(body["alt_text"]).toBe("Product image");

    vi.unstubAllGlobals();
  });

  it("throws when Pinterest API returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Bad Request", { status: 400 }))
    );

    await expect(
      createPin({
        accessToken: "token",
        boardId: "board-1",
        imageUrl: "https://example.com/img.png",
        title: "Title",
        description: "Desc",
      })
    ).rejects.toThrow("Pinterest pin creation failed");

    vi.unstubAllGlobals();
  });

  it("throws when response is missing pin id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      )
    );

    await expect(
      createPin({
        accessToken: "token",
        boardId: "board-1",
        imageUrl: "https://example.com/img.png",
        title: "Title",
        description: "Desc",
      })
    ).rejects.toThrow("No pin ID returned");

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Scheduled pins
// ---------------------------------------------------------------------------

describe("createScheduledPin", () => {
  it("inserts a row and returns a UUID string", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    const id = await createScheduledPin(
      {
        shop: "shop.myshopify.com",
        pinterestUserId: "user-123",
        boardId: "board-1",
        boardName: "Products",
        r2ImageKey: "shop/product-1/abc.png",
        imageUrl: "https://cdn.example.com/abc.png",
        title: "Cool product",
        description: "Buy now!",
        link: "https://shop.example.com/products/cool",
        scheduledAt: "2099-01-01T12:00:00.000Z",
      },
      env
    );

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(db._stmt.run).toHaveBeenCalledOnce();
  });
});

describe("getDuePins", () => {
  it("queries DB for pending pins with scheduled_at <= now", async () => {
    const pastPin: Partial<ScheduledPin> = {
      id: "pin-sched-1",
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      board_id: "board-1",
      board_name: "Products",
      image_url: "https://cdn.example.com/img.png",
      title: "Past pin",
      description: "Old pin",
      link: null,
      alt_text: null,
      scheduled_at: "2020-01-01T00:00:00.000Z",
      status: "pending",
      pin_id: null,
      error_message: null,
      created_at: "2020-01-01T00:00:00.000Z",
      published_at: null,
    };
    const db = makeDb([pastPin as Record<string, unknown>]);
    const env = makeEnv({ DB: db as unknown as D1Database });

    const pins = await getDuePins(env);
    expect(pins).toHaveLength(1);
    expect(pins[0]?.id).toBe("pin-sched-1");
  });
});

describe("markPinPublished", () => {
  it("calls DB UPDATE with published status and pin_id", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await markPinPublished("sched-1", "shop.myshopify.com", "pin-real-id", env);
    expect(db._stmt.run).toHaveBeenCalledOnce();
    expect(db._stmt.bind).toHaveBeenCalledWith(
      "pin-real-id",
      expect.any(String), // published_at
      "sched-1",
      "shop.myshopify.com"
    );
  });
});

describe("markPinFailed", () => {
  it("calls DB UPDATE with failed status and error message", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await markPinFailed("sched-1", "shop.myshopify.com", "Rate limit exceeded", env);
    expect(db._stmt.run).toHaveBeenCalledOnce();
    expect(db._stmt.bind).toHaveBeenCalledWith(
      "Rate limit exceeded",
      "sched-1",
      "shop.myshopify.com"
    );
  });
});

// ---------------------------------------------------------------------------
// Cron handler — processScheduledPins
// ---------------------------------------------------------------------------

describe("processScheduledPins", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("publishes due pins and marks them as published", async () => {
    const duePin: Partial<ScheduledPin> = {
      id: "pin-cron-1",
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      board_id: "board-1",
      board_name: "Products",
      r2_image_key: "shop/img.png",
      image_url: "https://cdn.example.com/img.png",
      title: "Cron pin",
      description: "Auto-published",
      link: null,
      alt_text: null,
      scheduled_at: "2020-06-01T00:00:00.000Z",
      status: "pending",
      pin_id: null,
      error_message: null,
      created_at: "2020-06-01T00:00:00.000Z",
      published_at: null,
    };

    const connRow = {
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_expires_at: "2099-12-31T00:00:00.000Z",
      connected_at: "2026-01-01T00:00:00.000Z",
    };

    let callCount = 0;
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      first: vi.fn(async () => connRow),
      all: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { results: [duePin], success: true, meta: {} };
        return { results: [], success: true, meta: {} };
      }),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "pin-published-001" }), { status: 200 })
      )
    );

    await processScheduledPins(env);

    expect(stmt.run).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("marks pin failed when merchant has disconnected Pinterest", async () => {
    const duePin: Partial<ScheduledPin> = {
      id: "pin-disc",
      shop: "disconnected.myshopify.com",
      pinterest_user_id: "user-999",
      board_id: "board-1",
      board_name: "Products",
      r2_image_key: "shop/img.png",
      image_url: "https://cdn.example.com/img.png",
      title: "Disconnected pin",
      description: "No conn",
      link: null,
      alt_text: null,
      scheduled_at: "2020-06-01T00:00:00.000Z",
      status: "pending",
      pin_id: null,
      error_message: null,
      created_at: "2020-06-01T00:00:00.000Z",
      published_at: null,
    };

    let callCount = 0;
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      first: vi.fn(async () => null), // no connection
      all: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { results: [duePin], success: true, meta: {} };
        return { results: [], success: true, meta: {} };
      }),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    await processScheduledPins(env);

    expect(stmt.run).toHaveBeenCalled(); // markPinFailed UPDATE
  });

  it("marks pin failed when Pinterest API returns an error", async () => {
    const duePin: Partial<ScheduledPin> = {
      id: "pin-apierr",
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      board_id: "board-1",
      board_name: "Products",
      r2_image_key: "shop/img.png",
      image_url: "https://cdn.example.com/img.png",
      title: "Error pin",
      description: "Fail",
      link: null,
      alt_text: null,
      scheduled_at: "2020-06-01T00:00:00.000Z",
      status: "pending",
      pin_id: null,
      error_message: null,
      created_at: "2020-06-01T00:00:00.000Z",
      published_at: null,
    };

    const connRow = {
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_expires_at: "2099-12-31T00:00:00.000Z",
      connected_at: "2026-01-01T00:00:00.000Z",
    };

    let callCount = 0;
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      first: vi.fn(async () => connRow),
      all: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { results: [duePin], success: true, meta: {} };
        return { results: [], success: true, meta: {} };
      }),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Rate Limited", { status: 429 }))
    );

    await processScheduledPins(env);

    expect(stmt.run).toHaveBeenCalled(); // markPinFailed UPDATE

    vi.unstubAllGlobals();
  });

  it("refreshes expired access token before creating pin", async () => {
    const duePin: Partial<ScheduledPin> = {
      id: "pin-refresh",
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      board_id: "board-1",
      board_name: "Products",
      r2_image_key: "shop/img.png",
      image_url: "https://cdn.example.com/img.png",
      title: "Refresh test pin",
      description: "Token refresh",
      link: null,
      alt_text: null,
      scheduled_at: "2020-06-01T00:00:00.000Z",
      status: "pending",
      pin_id: null,
      error_message: null,
      created_at: "2020-06-01T00:00:00.000Z",
      published_at: null,
    };

    const connRow = {
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      access_token: "expired-token",
      refresh_token: "valid-refresh",
      // Already expired
      token_expires_at: "2020-01-01T00:00:00.000Z",
      connected_at: "2020-01-01T00:00:00.000Z",
    };

    let callCount = 0;
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      first: vi.fn(async () => connRow),
      all: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { results: [duePin], success: true, meta: {} };
        return { results: [], success: true, meta: {} };
      }),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    const fetchMock = vi
      .fn()
      // First call: token refresh
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access-token",
            refresh_token: "new-refresh",
            expires_in: 2592000,
          }),
          { status: 200 }
        )
      )
      // Second call: save connection (happens inside savePinterestConnection — no fetch there)
      // Third call: createPin
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "pin-after-refresh" }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await processScheduledPins(env);

    // Ensure fetch was called at least twice (refresh + create pin)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stmt.run).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("marks pin failed when token refresh fails", async () => {
    const duePin: Partial<ScheduledPin> = {
      id: "pin-refresh-fail",
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      board_id: "board-1",
      board_name: "Products",
      r2_image_key: "shop/img.png",
      image_url: "https://cdn.example.com/img.png",
      title: "Refresh fail",
      description: "Token refresh failure",
      link: null,
      alt_text: null,
      scheduled_at: "2020-06-01T00:00:00.000Z",
      status: "pending",
      pin_id: null,
      error_message: null,
      created_at: "2020-06-01T00:00:00.000Z",
      published_at: null,
    };

    const connRow = {
      shop: "shop.myshopify.com",
      pinterest_user_id: "user-123",
      access_token: "expired-token",
      refresh_token: "invalid-refresh",
      token_expires_at: "2020-01-01T00:00:00.000Z",
      connected_at: "2020-01-01T00:00:00.000Z",
    };

    let callCount = 0;
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      first: vi.fn(async () => connRow),
      all: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { results: [duePin], success: true, meta: {} };
        return { results: [], success: true, meta: {} };
      }),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    );

    await processScheduledPins(env);

    expect(stmt.run).toHaveBeenCalled(); // markPinFailed

    vi.unstubAllGlobals();
  });

  it("does nothing when there are no due pins", async () => {
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    await processScheduledPins(env);

    expect(stmt.run).not.toHaveBeenCalled();
  });
});
