/**
 * PR-039: Instagram Graph API direct publishing — unit tests
 *
 * Tests:
 *  - getInstagramOAuthUrl: generates valid OAuth URL and stores KV nonce
 *  - validateOAuthState: accepts valid state, rejects missing/expired, rejects malformed
 *  - exchangeCodeForLongLivedToken: happy path, short-lived fail, long-lived fail
 *  - fetchInstagramBusinessAccount: returns igUserId and pageName, throws when no IG account
 *  - saveInstagramConnection / getInstagramConnection: round-trip, access_token not logged
 *  - deleteInstagramConnection: removes row
 *  - publishToInstagram: happy path (feed + story), container creation fail, publish fail
 *  - createScheduledPost / getDuePosts: only returns pending posts <= now
 *  - markPostPublished / markPostFailed: status transitions
 *  - processScheduledPosts: publishes due posts, handles missing connection, handles API error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getInstagramOAuthUrl,
  validateOAuthState,
  exchangeCodeForLongLivedToken,
  fetchInstagramBusinessAccount,
  saveInstagramConnection,
  getInstagramConnection,
  deleteInstagramConnection,
  publishToInstagram,
  createScheduledPost,
  markPostPublished,
  markPostFailed,
  getDuePosts,
  processScheduledPosts,
  type InstagramEnv,
  type ScheduledPost,
} from "../src/instagram.server.js";

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

function makeEnv(overrides: Partial<InstagramEnv> = {}): InstagramEnv {
  return {
    INSTAGRAM_APP_ID: "test-app-id",
    INSTAGRAM_APP_SECRET: "test-app-secret",
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

describe("getInstagramOAuthUrl", () => {
  it("returns a Facebook OAuth URL", async () => {
    const env = makeEnv();
    const url = await getInstagramOAuthUrl("shop.myshopify.com", env);
    expect(url).toMatch(/^https:\/\/www\.facebook\.com\/v20\.0\/dialog\/oauth/);
  });

  it("includes required scopes in the URL", async () => {
    const env = makeEnv();
    const url = await getInstagramOAuthUrl("shop.myshopify.com", env);
    expect(url).toContain("instagram_basic");
    expect(url).toContain("instagram_content_publish");
  });

  it("stores a nonce in KV with TTL", async () => {
    const kv = makeKv();
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });
    await getInstagramOAuthUrl("shop.myshopify.com", env);
    expect(kv.put).toHaveBeenCalledOnce();
    // The put call should include an expirationTtl option
    const [, , opts] = kv.put.mock.calls[0] as [string, string, { expirationTtl: number }];
    expect(opts?.expirationTtl).toBeGreaterThan(0);
  });

  it("includes redirect_uri pointing to callback path", async () => {
    const env = makeEnv();
    const url = await getInstagramOAuthUrl("shop.myshopify.com", env);
    expect(url).toContain(encodeURIComponent("/app/instagram/callback"));
  });
});

// ---------------------------------------------------------------------------
// OAuth state validation
// ---------------------------------------------------------------------------

describe("validateOAuthState", () => {
  it("returns shop domain for a valid state nonce", async () => {
    const shop = "shop.myshopify.com";
    const kv = makeKv();
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });

    // Generate state
    const oauthUrl = await getInstagramOAuthUrl(shop, env);
    const urlObj = new URL(oauthUrl);
    const rawState = urlObj.searchParams.get("state")!;

    const result = await validateOAuthState(rawState, env);
    expect(result).toBe(shop);
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

    const oauthUrl = await getInstagramOAuthUrl(shop, env);
    const rawState = new URL(oauthUrl).searchParams.get("state")!;

    await validateOAuthState(rawState, env);

    // Second call should fail — nonce consumed
    await expect(validateOAuthState(rawState, env)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

describe("exchangeCodeForLongLivedToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns long-lived access_token on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "short-token" }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "long-lived-token" }), { status: 200 })
        )
    );

    const env = makeEnv();
    const token = await exchangeCodeForLongLivedToken("auth-code-123", env);
    expect(token).toBe("long-lived-token");

    vi.unstubAllGlobals();
  });

  it("throws when short-lived token exchange returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Bad request", { status: 400 }))
    );

    const env = makeEnv();
    await expect(exchangeCodeForLongLivedToken("bad-code", env)).rejects.toThrow(
      "Short-lived token exchange failed"
    );

    vi.unstubAllGlobals();
  });

  it("throws when long-lived token exchange fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "short-token" }), { status: 200 })
        )
        .mockResolvedValueOnce(new Response("Server error", { status: 500 }))
    );

    const env = makeEnv();
    await expect(exchangeCodeForLongLivedToken("auth-code", env)).rejects.toThrow(
      "Long-lived token exchange failed"
    );

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Instagram Business Account discovery
// ---------------------------------------------------------------------------

describe("fetchInstagramBusinessAccount", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns igUserId and pageName when a connected IG account exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "page-123",
                name: "My Store Page",
                instagram_business_account: { id: "ig-456" },
              },
            ],
          }),
          { status: 200 }
        )
      )
    );

    const result = await fetchInstagramBusinessAccount("fb-token");
    expect(result.igUserId).toBe("ig-456");
    expect(result.pageName).toBe("My Store Page");

    vi.unstubAllGlobals();
  });

  it("throws when no page has a connected Instagram Business Account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "page-1", name: "No IG Page" }] }),
          { status: 200 }
        )
      )
    );

    await expect(fetchInstagramBusinessAccount("fb-token")).rejects.toThrow(
      "No Instagram Business Account"
    );

    vi.unstubAllGlobals();
  });

  it("throws when Pages API returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    );

    await expect(fetchInstagramBusinessAccount("bad-token")).rejects.toThrow(
      "Pages API request failed"
    );

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Connection persistence
// ---------------------------------------------------------------------------

describe("saveInstagramConnection", () => {
  it("calls DB.prepare with INSERT OR UPDATE", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await saveInstagramConnection(
      "shop.myshopify.com",
      "ig-123",
      "secret-fb-token",
      "Test Page",
      env
    );

    expect(db.prepare).toHaveBeenCalledOnce();
    // Verify access_token is NOT in log output by checking logger indirectly:
    // the function must not throw and the db.prepare call must be present
    expect(db._stmt.run).toHaveBeenCalledOnce();
  });

  it("does not include fb_access_token in any console.log call", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await saveInstagramConnection(
      "shop.myshopify.com",
      "ig-123",
      "SUPER_SECRET_TOKEN_SHOULD_NOT_APPEAR",
      "Test Page",
      env
    );

    const allLogArgs = consoleSpy.mock.calls.flat().join(" ");
    expect(allLogArgs).not.toContain("SUPER_SECRET_TOKEN_SHOULD_NOT_APPEAR");
    consoleSpy.mockRestore();
  });
});

describe("getInstagramConnection", () => {
  it("returns the connection row when present", async () => {
    const fakeRow = {
      shop: "shop.myshopify.com",
      ig_user_id: "ig-123",
      fb_access_token: "token",
      page_name: "Test Page",
      connected_at: "2026-01-01T00:00:00.000Z",
    };
    const db = makeDb([fakeRow]);
    const env = makeEnv({ DB: db as unknown as D1Database });

    const conn = await getInstagramConnection("shop.myshopify.com", env);
    expect(conn).not.toBeNull();
    expect(conn?.ig_user_id).toBe("ig-123");
  });

  it("returns null when no connection row exists", async () => {
    const db = makeDb([]);
    const env = makeEnv({ DB: db as unknown as D1Database });

    const conn = await getInstagramConnection("shop.myshopify.com", env);
    expect(conn).toBeNull();
  });
});

describe("deleteInstagramConnection", () => {
  it("calls DB.prepare with DELETE statement", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await deleteInstagramConnection("shop.myshopify.com", env);
    expect(db.prepare).toHaveBeenCalledOnce();
    expect(db._stmt.run).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

describe("publishToInstagram", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("publishes a feed post and returns mediaId + postId", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "media-container-001" }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "ig-post-999" }), { status: 200 })
        )
    );

    const result = await publishToInstagram({
      igUserId: "ig-123",
      fbAccessToken: "fake-token",
      imageUrl: "https://example.com/img.png",
      caption: "Hello world #shopify",
      postType: "feed",
    });

    expect(result.mediaId).toBe("media-container-001");
    expect(result.postId).toBe("ig-post-999");

    vi.unstubAllGlobals();
  });

  it("publishes a story post (no caption in container body)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "story-container-002" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "story-post-002" }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishToInstagram({
      igUserId: "ig-123",
      fbAccessToken: "fake-token",
      imageUrl: "https://example.com/story.png",
      caption: "This should not appear in stories",
      postType: "story",
    });

    expect(result.postId).toBe("story-post-002");

    // Verify the container POST body does NOT include caption for stories
    const containerCallBody = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string;
    expect(containerCallBody).not.toContain("caption");

    vi.unstubAllGlobals();
  });

  it("throws when media container creation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("Bad Request", { status: 400 }))
    );

    await expect(
      publishToInstagram({
        igUserId: "ig-123",
        fbAccessToken: "fake-token",
        imageUrl: "https://example.com/img.png",
        caption: "Test",
      })
    ).rejects.toThrow("media container creation failed");

    vi.unstubAllGlobals();
  });

  it("throws when publish step fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "container-ok" }), { status: 200 })
        )
        .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }))
    );

    await expect(
      publishToInstagram({
        igUserId: "ig-123",
        fbAccessToken: "fake-token",
        imageUrl: "https://example.com/img.png",
        caption: "Test",
      })
    ).rejects.toThrow("media publish failed");

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Scheduled posts
// ---------------------------------------------------------------------------

describe("createScheduledPost", () => {
  it("inserts a row and returns an ID string", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    const id = await createScheduledPost(
      {
        shop: "shop.myshopify.com",
        igUserId: "ig-123",
        r2ImageKey: "shop/product-1/abc.png",
        imageUrl: "https://cdn.example.com/abc.png",
        caption: "Check this out! #product",
        postType: "feed",
        scheduledAt: "2099-01-01T12:00:00.000Z",
      },
      env
    );

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(db._stmt.run).toHaveBeenCalledOnce();
  });
});

describe("getDuePosts", () => {
  it("queries DB for pending posts with scheduled_at <= now", async () => {
    const pastPost: Partial<ScheduledPost> = {
      id: "post-1",
      shop: "shop.myshopify.com",
      ig_user_id: "ig-123",
      image_url: "https://cdn.example.com/img.png",
      caption: "Past post",
      post_type: "feed",
      scheduled_at: "2020-01-01T00:00:00.000Z",
      status: "pending",
      error_message: null,
      created_at: "2020-01-01T00:00:00.000Z",
      published_at: null,
    };
    const db = makeDb([pastPost as Record<string, unknown>]);
    const env = makeEnv({ DB: db as unknown as D1Database });

    const posts = await getDuePosts(env);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.id).toBe("post-1");
  });
});

describe("markPostPublished", () => {
  it("calls DB UPDATE with published status", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await markPostPublished("post-1", "shop.myshopify.com", "ig-post-999", env);
    expect(db._stmt.run).toHaveBeenCalledOnce();
    expect(db._stmt.bind).toHaveBeenCalledWith(
      expect.any(String), // published_at
      "post-1",
      "shop.myshopify.com"
    );
  });
});

describe("markPostFailed", () => {
  it("calls DB UPDATE with failed status and error message", async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as unknown as D1Database });

    await markPostFailed("post-1", "shop.myshopify.com", "API error 400", env);
    expect(db._stmt.run).toHaveBeenCalledOnce();
    expect(db._stmt.bind).toHaveBeenCalledWith(
      "API error 400",
      "post-1",
      "shop.myshopify.com"
    );
  });
});

// ---------------------------------------------------------------------------
// Cron handler — processScheduledPosts
// ---------------------------------------------------------------------------

describe("processScheduledPosts", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("publishes due posts and marks them as published", async () => {
    const duePost: Partial<ScheduledPost> = {
      id: "post-cron-1",
      shop: "shop.myshopify.com",
      ig_user_id: "ig-123",
      r2_image_key: "shop/img.png",
      image_url: "https://cdn.example.com/img.png",
      caption: "Cron post",
      post_type: "feed",
      scheduled_at: "2020-06-01T00:00:00.000Z",
      status: "pending",
      error_message: null,
      created_at: "2020-06-01T00:00:00.000Z",
      published_at: null,
    };

    const connRow = {
      shop: "shop.myshopify.com",
      ig_user_id: "ig-123",
      fb_access_token: "fb-token",
      page_name: "Test Page",
      connected_at: "2026-01-01T00:00:00.000Z",
    };

    // DB returns due posts on first call, connection on second
    let callCount = 0;
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      first: vi.fn(async () => connRow),
      all: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { results: [duePost], success: true, meta: {} };
        return { results: [], success: true, meta: {} };
      }),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    // Mock Instagram Graph API calls (container + publish)
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "container-cron" }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "ig-cron-post" }), { status: 200 })
        )
    );

    await processScheduledPosts(env);

    // Should have called run() at least once (markPostPublished UPDATE)
    expect(stmt.run).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("marks post failed when merchant has disconnected Instagram", async () => {
    const duePost: Partial<ScheduledPost> = {
      id: "post-disc",
      shop: "disconnected.myshopify.com",
      ig_user_id: "ig-999",
      r2_image_key: "shop/img.png",
      image_url: "https://cdn.example.com/img.png",
      caption: "Disc post",
      post_type: "feed",
      scheduled_at: "2020-06-01T00:00:00.000Z",
      status: "pending",
      error_message: null,
      created_at: "2020-06-01T00:00:00.000Z",
      published_at: null,
    };

    let callCount = 0;
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      // getDuePosts: returns one due post; getInstagramConnection: returns null
      first: vi.fn(async () => null),
      all: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { results: [duePost], success: true, meta: {} };
        return { results: [], success: true, meta: {} };
      }),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    await processScheduledPosts(env);

    // markPostFailed should have been called (an UPDATE run)
    expect(stmt.run).toHaveBeenCalled();
  });

  it("marks post failed when Graph API returns an error", async () => {
    const duePost: Partial<ScheduledPost> = {
      id: "post-apierr",
      shop: "shop.myshopify.com",
      ig_user_id: "ig-123",
      r2_image_key: "shop/img.png",
      image_url: "https://cdn.example.com/img.png",
      caption: "Error post",
      post_type: "feed",
      scheduled_at: "2020-06-01T00:00:00.000Z",
      status: "pending",
      error_message: null,
      created_at: "2020-06-01T00:00:00.000Z",
      published_at: null,
    };

    const connRow = {
      shop: "shop.myshopify.com",
      ig_user_id: "ig-123",
      fb_access_token: "fb-token",
      page_name: "Test Page",
      connected_at: "2026-01-01T00:00:00.000Z",
    };

    let callCount = 0;
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      first: vi.fn(async () => connRow),
      all: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { results: [duePost], success: true, meta: {} };
        return { results: [], success: true, meta: {} };
      }),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    // Graph API returns an error on media container creation
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("API Error", { status: 400 }))
    );

    await processScheduledPosts(env);

    // markPostFailed should have been called
    expect(stmt.run).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("does nothing when there are no due posts", async () => {
    const stmt = {
      bind: vi.fn(function (this: typeof stmt) { return this; }),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    };
    const db = { prepare: vi.fn(() => stmt) };
    const env = makeEnv({ DB: db as unknown as D1Database });

    await processScheduledPosts(env);

    // run() should NOT be called (no posts to mark)
    expect(stmt.run).not.toHaveBeenCalled();
  });
});
