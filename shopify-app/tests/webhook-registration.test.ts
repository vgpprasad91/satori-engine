/**
 * PR-009: Tests for webhook registration lifecycle and daily audit cron
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SHOPIFY_API_VERSION,
  REQUIRED_WEBHOOK_TOPICS,
  buildCallbackUrl,
  listRegisteredWebhooks,
  registerWebhook,
  registerWebhooksOnInstall,
  auditMerchantWebhooks,
  runWebhookAuditCron,
  shopifyGraphQL,
  type WebhookRegistrationEnv,
} from "../src/webhook-registration.server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockD1(rows: unknown[] = []): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: rows }),
      first: vi.fn().mockResolvedValue(null),
    }),
    batch: vi.fn().mockResolvedValue([]),
    exec: vi.fn().mockResolvedValue({ count: 0 }),
    dump: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as D1Database;
}

function makeEnv(
  overrides: Partial<WebhookRegistrationEnv> = {}
): WebhookRegistrationEnv {
  return {
    DB: makeMockD1(),
    APP_URL: "https://myapp.example.com",
    ...overrides,
  };
}

/** Builds a Shopify GraphQL response envelope */
function gqlResponse<T>(data: T) {
  return { ok: true, json: async () => ({ data }) } as unknown as Response;
}

// ---------------------------------------------------------------------------
// buildCallbackUrl
// ---------------------------------------------------------------------------

describe("buildCallbackUrl", () => {
  it("converts PRODUCTS_CREATE to correct URL", () => {
    const url = buildCallbackUrl("https://app.example.com", "PRODUCTS_CREATE");
    expect(url).toBe("https://app.example.com/webhooks/products/create");
  });

  it("converts APP_UNINSTALLED to correct URL", () => {
    const url = buildCallbackUrl("https://app.example.com", "APP_UNINSTALLED");
    expect(url).toBe("https://app.example.com/webhooks/app/uninstalled");
  });

  it("converts CUSTOMERS_DATA_REQUEST to correct URL", () => {
    const url = buildCallbackUrl(
      "https://app.example.com",
      "CUSTOMERS_DATA_REQUEST"
    );
    expect(url).toBe(
      "https://app.example.com/webhooks/customers/data/request"
    );
  });

  it("strips trailing slash from appUrl", () => {
    const url = buildCallbackUrl(
      "https://app.example.com/",
      "PRODUCTS_CREATE"
    );
    expect(url).toBe("https://app.example.com/webhooks/products/create");
  });
});

// ---------------------------------------------------------------------------
// SHOPIFY_API_VERSION
// ---------------------------------------------------------------------------

describe("SHOPIFY_API_VERSION", () => {
  it("is pinned to 2025-01", () => {
    expect(SHOPIFY_API_VERSION).toBe("2025-01");
  });
});

// ---------------------------------------------------------------------------
// shopifyGraphQL — API version header
// ---------------------------------------------------------------------------

describe("shopifyGraphQL", () => {
  it("sends X-Shopify-API-Version header set to 2025-01", async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        new Headers(opts.headers as HeadersInit).entries()
      );
      return Promise.resolve(
        gqlResponse({ shop: { primaryLocale: "en" } })
      );
    });

    await shopifyGraphQL(
      "test.myshopify.com",
      "fake-token",
      "query { shop { primaryLocale } }"
    );

    expect(capturedHeaders["x-shopify-api-version"]).toBe("2025-01");
    expect(capturedHeaders["x-shopify-access-token"]).toBe("fake-token");
  });

  it("throws on GraphQL errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: [{ message: "Some GraphQL error" }],
      }),
    } as unknown as Response);

    await expect(
      shopifyGraphQL("test.myshopify.com", "fake-token", "query { shop { id } }")
    ).rejects.toThrow("Some GraphQL error");
  });

  it("throws on non-200 HTTP response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as unknown as Response);

    await expect(
      shopifyGraphQL("test.myshopify.com", "fake-token", "query { shop { id } }")
    ).rejects.toThrow("HTTP 403");
  });
});

// ---------------------------------------------------------------------------
// listRegisteredWebhooks
// ---------------------------------------------------------------------------

describe("listRegisteredWebhooks", () => {
  it("returns parsed webhook list", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      gqlResponse({
        webhookSubscriptions: {
          edges: [
            {
              node: {
                id: "gid://shopify/WebhookSubscription/1",
                topic: "PRODUCTS_CREATE",
                endpoint: {
                  __typename: "WebhookHttpEndpoint",
                  callbackUrl: "https://app.example.com/webhooks/products/create",
                },
                format: "JSON",
              },
            },
          ],
        },
      })
    );

    const webhooks = await listRegisteredWebhooks(
      "test.myshopify.com",
      "fake-token"
    );

    expect(webhooks).toHaveLength(1);
    expect(webhooks[0]!.topic).toBe("PRODUCTS_CREATE");
    expect(webhooks[0]!.callbackUrl).toBe(
      "https://app.example.com/webhooks/products/create"
    );
  });

  it("returns empty array when no webhooks registered", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      gqlResponse({
        webhookSubscriptions: { edges: [] },
      })
    );

    const webhooks = await listRegisteredWebhooks(
      "test.myshopify.com",
      "fake-token"
    );
    expect(webhooks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// registerWebhook
// ---------------------------------------------------------------------------

describe("registerWebhook", () => {
  it("registers a webhook topic and returns subscription ID", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      gqlResponse({
        webhookSubscriptionCreate: {
          webhookSubscription: {
            id: "gid://shopify/WebhookSubscription/42",
            topic: "PRODUCTS_CREATE",
          },
          userErrors: [],
        },
      })
    );

    const id = await registerWebhook(
      "test.myshopify.com",
      "fake-token",
      "PRODUCTS_CREATE",
      "https://app.example.com/webhooks/products/create"
    );

    expect(id).toBe("gid://shopify/WebhookSubscription/42");
  });

  it("throws when Shopify returns userErrors", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      gqlResponse({
        webhookSubscriptionCreate: {
          webhookSubscription: null,
          userErrors: [{ field: ["topic"], message: "Invalid topic" }],
        },
      })
    );

    await expect(
      registerWebhook(
        "test.myshopify.com",
        "fake-token",
        "PRODUCTS_CREATE",
        "https://app.example.com/webhooks/products/create"
      )
    ).rejects.toThrow("Invalid topic");
  });
});

// ---------------------------------------------------------------------------
// registerWebhooksOnInstall
// ---------------------------------------------------------------------------

describe("registerWebhooksOnInstall", () => {
  it("registers all required topics when none exist", async () => {
    // First call: listRegisteredWebhooks → empty
    // Subsequent calls: registerWebhook → success
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // listRegisteredWebhooks
        return Promise.resolve(
          gqlResponse({
            webhookSubscriptions: { edges: [] },
          })
        );
      }
      // registerWebhook calls
      return Promise.resolve(
        gqlResponse({
          webhookSubscriptionCreate: {
            webhookSubscription: {
              id: `gid://shopify/WebhookSubscription/${callCount}`,
              topic: "PRODUCTS_CREATE",
            },
            userErrors: [],
          },
        })
      );
    });

    const result = await registerWebhooksOnInstall(
      "test.myshopify.com",
      "fake-token",
      "https://app.example.com"
    );

    expect(result.shop).toBe("test.myshopify.com");
    expect(result.registered).toHaveLength(REQUIRED_WEBHOOK_TOPICS.length);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it("skips already-registered topics", async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      // listRegisteredWebhooks returns all topics already registered
      return Promise.resolve(
        gqlResponse({
          webhookSubscriptions: {
            edges: REQUIRED_WEBHOOK_TOPICS.map((topic, i) => ({
              node: {
                id: `gid://shopify/WebhookSubscription/${i}`,
                topic,
                endpoint: {
                  __typename: "WebhookHttpEndpoint",
                  callbackUrl: `https://app.example.com/webhooks/${topic.toLowerCase()}`,
                },
                format: "JSON",
              },
            })),
          },
        })
      );
    });

    const result = await registerWebhooksOnInstall(
      "test.myshopify.com",
      "fake-token",
      "https://app.example.com"
    );

    expect(result.registered).toHaveLength(0);
    expect(result.skipped).toHaveLength(REQUIRED_WEBHOOK_TOPICS.length);
    expect(result.failed).toHaveLength(0);
  });

  it("captures registration failures without throwing", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          gqlResponse({ webhookSubscriptions: { edges: [] } })
        );
      }
      // All registrations fail
      return Promise.resolve({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as unknown as Response);
    });

    const result = await registerWebhooksOnInstall(
      "test.myshopify.com",
      "fake-token",
      "https://app.example.com"
    );

    expect(result.failed).toHaveLength(REQUIRED_WEBHOOK_TOPICS.length);
    expect(result.registered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// auditMerchantWebhooks
// ---------------------------------------------------------------------------

describe("auditMerchantWebhooks", () => {
  it("returns empty missing array when all topics registered", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      gqlResponse({
        webhookSubscriptions: {
          edges: REQUIRED_WEBHOOK_TOPICS.map((topic, i) => ({
            node: {
              id: `gid://shopify/WebhookSubscription/${i}`,
              topic,
              endpoint: {
                __typename: "WebhookHttpEndpoint",
                callbackUrl: `https://app.example.com/webhooks/${i}`,
              },
              format: "JSON",
            },
          })),
        },
      })
    );

    const result = await auditMerchantWebhooks(
      "test.myshopify.com",
      "fake-token",
      "https://app.example.com"
    );

    expect(result.missing).toHaveLength(0);
    expect(result.reregistered).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it("detects missing topics and re-registers them", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Only PRODUCTS_CREATE registered, rest missing
        return Promise.resolve(
          gqlResponse({
            webhookSubscriptions: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/WebhookSubscription/1",
                    topic: "PRODUCTS_CREATE",
                    endpoint: {
                      __typename: "WebhookHttpEndpoint",
                      callbackUrl: "https://app.example.com/webhooks/products/create",
                    },
                    format: "JSON",
                  },
                },
              ],
            },
          })
        );
      }
      // Re-registration success
      return Promise.resolve(
        gqlResponse({
          webhookSubscriptionCreate: {
            webhookSubscription: {
              id: `gid://shopify/WebhookSubscription/${callCount}`,
              topic: "PRODUCTS_UPDATE",
            },
            userErrors: [],
          },
        })
      );
    });

    const result = await auditMerchantWebhooks(
      "test.myshopify.com",
      "fake-token",
      "https://app.example.com"
    );

    // 6 topics missing (all except PRODUCTS_CREATE)
    expect(result.missing).toHaveLength(REQUIRED_WEBHOOK_TOPICS.length - 1);
    expect(result.reregistered).toHaveLength(REQUIRED_WEBHOOK_TOPICS.length - 1);
    expect(result.failed).toHaveLength(0);
  });

  it("records failed re-registrations without throwing", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          gqlResponse({ webhookSubscriptions: { edges: [] } })
        );
      }
      return Promise.resolve({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      } as unknown as Response);
    });

    const result = await auditMerchantWebhooks(
      "test.myshopify.com",
      "fake-token",
      "https://app.example.com"
    );

    expect(result.missing).toHaveLength(REQUIRED_WEBHOOK_TOPICS.length);
    expect(result.failed).toHaveLength(REQUIRED_WEBHOOK_TOPICS.length);
    expect(result.reregistered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runWebhookAuditCron
// ---------------------------------------------------------------------------

describe("runWebhookAuditCron", () => {
  it("audits all active merchants from D1", async () => {
    const mockMerchants = [
      { shop: "shop1.myshopify.com", access_token: "token1" },
      { shop: "shop2.myshopify.com", access_token: "token2" },
    ];

    const mockDB = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: mockMerchants }),
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ success: true }),
        first: vi.fn().mockResolvedValue(null),
      }),
      batch: vi.fn(),
      exec: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;

    // All webhooks registered — no missing
    global.fetch = vi.fn().mockResolvedValue(
      gqlResponse({
        webhookSubscriptions: {
          edges: REQUIRED_WEBHOOK_TOPICS.map((topic, i) => ({
            node: {
              id: `gid://shopify/WebhookSubscription/${i}`,
              topic,
              endpoint: {
                __typename: "WebhookHttpEndpoint",
                callbackUrl: `https://myapp.example.com/webhooks/${i}`,
              },
              format: "JSON",
            },
          })),
        },
      })
    );

    const env = makeEnv({ DB: mockDB });
    await expect(runWebhookAuditCron(env)).resolves.toBeUndefined();

    // fetch called once per merchant for listRegisteredWebhooks
    expect(global.fetch).toHaveBeenCalledTimes(mockMerchants.length);
  });

  it("does not throw when DB query fails", async () => {
    const mockDB = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockRejectedValue(new Error("DB unavailable")),
        bind: vi.fn().mockReturnThis(),
        run: vi.fn(),
        first: vi.fn(),
      }),
      batch: vi.fn(),
      exec: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;

    const env = makeEnv({ DB: mockDB });
    await expect(runWebhookAuditCron(env)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// REQUIRED_WEBHOOK_TOPICS completeness
// ---------------------------------------------------------------------------

describe("REQUIRED_WEBHOOK_TOPICS", () => {
  it("includes all 7 mandatory topics", () => {
    expect(REQUIRED_WEBHOOK_TOPICS).toContain("PRODUCTS_CREATE");
    expect(REQUIRED_WEBHOOK_TOPICS).toContain("PRODUCTS_UPDATE");
    expect(REQUIRED_WEBHOOK_TOPICS).toContain("PRODUCTS_DELETE");
    expect(REQUIRED_WEBHOOK_TOPICS).toContain("APP_UNINSTALLED");
    expect(REQUIRED_WEBHOOK_TOPICS).toContain("CUSTOMERS_DATA_REQUEST");
    expect(REQUIRED_WEBHOOK_TOPICS).toContain("CUSTOMERS_REDACT");
    expect(REQUIRED_WEBHOOK_TOPICS).toContain("SHOP_REDACT");
    expect(REQUIRED_WEBHOOK_TOPICS).toHaveLength(7);
  });
});
