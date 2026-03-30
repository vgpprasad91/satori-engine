/**
 * PR-010: Tests for Shopify billing API — subscription creation and plan management
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PLANS,
  SHOPIFY_API_VERSION,
  shopifyBillingGraphQL,
  createSubscription,
  handleApprovalCallback,
  chargeOverage,
  cancelSubscription,
  type PlanName,
} from "../src/billing.server.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockD1(): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(null),
    }),
  } as unknown as D1Database;
}

function shopifyResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue({ data }),
    text: vi.fn().mockResolvedValue(JSON.stringify({ data })),
  };
}

function shopifyErrorResponse(errors: Array<{ message: string }>) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ errors }),
    text: vi.fn().mockResolvedValue(""),
  };
}

// ---------------------------------------------------------------------------
// Plan configuration
// ---------------------------------------------------------------------------

describe("PLANS", () => {
  it("defines hobby plan with 100 images/month at $0", () => {
    expect(PLANS.hobby.monthlyLimit).toBe(100);
    expect(PLANS.hobby.price).toBe(0);
    expect(PLANS.hobby.cappedAmount).toBeNull();
    expect(PLANS.hobby.overagePerImage).toBeNull();
  });

  it("defines pro plan with 1000 images/month at $29", () => {
    expect(PLANS.pro.monthlyLimit).toBe(1_000);
    expect(PLANS.pro.price).toBe(29);
    expect(PLANS.pro.cappedAmount).toBe(50);
    expect(PLANS.pro.overagePerImage).toBe(0.05);
  });

  it("defines business plan with 10000 images/month at $79", () => {
    expect(PLANS.business.monthlyLimit).toBe(10_000);
    expect(PLANS.business.price).toBe(79);
    expect(PLANS.business.cappedAmount).toBe(100);
    expect(PLANS.business.overagePerImage).toBe(0.01);
  });
});

// ---------------------------------------------------------------------------
// shopifyBillingGraphQL
// ---------------------------------------------------------------------------

describe("shopifyBillingGraphQL", () => {
  beforeEach(() => mockFetch.mockReset());

  it("includes correct API version header", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({ test: true })
    );

    await shopifyBillingGraphQL(
      "test.myshopify.com",
      "token123",
      "{ test }",
      {}
    );

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(SHOPIFY_API_VERSION);
    expect((init.headers as Record<string, string>)["X-Shopify-API-Version"]).toBe(
      SHOPIFY_API_VERSION
    );
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Unauthorized"),
    });

    await expect(
      shopifyBillingGraphQL("test.myshopify.com", "bad-token", "{ test }")
    ).rejects.toThrow("401");
  });

  it("throws on GraphQL errors", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyErrorResponse([{ message: "Billing API unavailable" }])
    );

    await expect(
      shopifyBillingGraphQL("test.myshopify.com", "token", "{ test }")
    ).rejects.toThrow("Billing API unavailable");
  });
});

// ---------------------------------------------------------------------------
// createSubscription
// ---------------------------------------------------------------------------

describe("createSubscription", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns free plan immediately without API call for hobby", async () => {
    const result = await createSubscription(
      "test.myshopify.com",
      "token",
      "hobby",
      "https://example.com/return"
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.subscriptionId).toBe("free");
    expect(result.status).toBe("ACTIVE");
    expect(result.confirmationUrl).toBe("https://example.com/return");
  });

  it("creates pro plan subscription via Shopify API", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appSubscriptionCreate: {
          appSubscription: { id: "gid://shopify/AppSubscription/123", status: "PENDING" },
          confirmationUrl: "https://shopify.com/confirm/123",
          userErrors: [],
        },
      })
    );

    const result = await createSubscription(
      "test.myshopify.com",
      "token",
      "pro",
      "https://app.example.com/billing/callback"
    );

    expect(result.subscriptionId).toBe("gid://shopify/AppSubscription/123");
    expect(result.confirmationUrl).toBe("https://shopify.com/confirm/123");
    expect(result.status).toBe("PENDING");
  });

  it("creates business plan subscription via Shopify API", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appSubscriptionCreate: {
          appSubscription: { id: "gid://shopify/AppSubscription/456", status: "PENDING" },
          confirmationUrl: "https://shopify.com/confirm/456",
          userErrors: [],
        },
      })
    );

    const result = await createSubscription(
      "test.myshopify.com",
      "token",
      "business",
      "https://app.example.com/billing/callback"
    );

    expect(result.subscriptionId).toBe("gid://shopify/AppSubscription/456");
    expect(result.status).toBe("PENDING");
  });

  it("throws on userErrors from Shopify", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appSubscriptionCreate: {
          appSubscription: null,
          confirmationUrl: null,
          userErrors: [{ field: ["plan"], message: "Invalid plan configuration" }],
        },
      })
    );

    await expect(
      createSubscription("test.myshopify.com", "token", "pro", "https://example.com/return")
    ).rejects.toThrow("Invalid plan configuration");
  });

  it("passes test=true flag when specified", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appSubscriptionCreate: {
          appSubscription: { id: "gid://shopify/AppSubscription/789", status: "PENDING" },
          confirmationUrl: "https://shopify.com/confirm/789",
          userErrors: [],
        },
      })
    );

    await createSubscription(
      "test.myshopify.com",
      "token",
      "pro",
      "https://example.com/return",
      { test: true }
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables.test).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleApprovalCallback
// ---------------------------------------------------------------------------

describe("handleApprovalCallback", () => {
  beforeEach(() => mockFetch.mockReset());

  it("activates hobby plan without API call and updates D1", async () => {
    const db = makeMockD1();

    const result = await handleApprovalCallback(
      "test.myshopify.com",
      "token",
      "hobby",
      "free",
      db
    );

    // No Shopify API call for free plan
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.plan).toBe("hobby");
    expect(result.billingStatus).toBe("active");
    expect(db.prepare).toHaveBeenCalled();
  });

  it("verifies pro plan subscription and stores in D1", async () => {
    const db = makeMockD1();
    const subId = "gid://shopify/AppSubscription/123";

    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appInstallation: {
          activeSubscriptions: [{ id: subId, status: "ACTIVE" }],
        },
      })
    );

    const result = await handleApprovalCallback(
      "test.myshopify.com",
      "token",
      "pro",
      subId,
      db
    );

    expect(result.plan).toBe("pro");
    expect(result.subscriptionId).toBe(subId);
    expect(result.billingStatus).toBe("active");
    expect(db.prepare).toHaveBeenCalled();
  });

  it("throws if subscription not found in active subscriptions", async () => {
    const db = makeMockD1();

    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appInstallation: {
          activeSubscriptions: [],
        },
      })
    );

    await expect(
      handleApprovalCallback(
        "test.myshopify.com",
        "token",
        "pro",
        "gid://shopify/AppSubscription/999",
        db
      )
    ).rejects.toThrow("not found in active subscriptions");
  });

  it("stores correct monthly_limit for each plan", async () => {
    const plans: PlanName[] = ["hobby", "pro", "business"];
    const expectedLimits = [100, 1_000, 10_000];

    for (let i = 0; i < plans.length; i++) {
      const db = makeMockD1();
      const planName = plans[i] as PlanName;
      const expectedLimit = expectedLimits[i];

      if (PLANS[planName].price > 0) {
        mockFetch.mockResolvedValueOnce(
          shopifyResponse({
            appInstallation: {
              activeSubscriptions: [
                { id: "gid://shopify/AppSubscription/1", status: "ACTIVE" },
              ],
            },
          })
        );
      }

      await handleApprovalCallback(
        "test.myshopify.com",
        "token",
        planName,
        "gid://shopify/AppSubscription/1",
        db
      );

      // Verify bind was called with correct monthly_limit
      const bindMock = (db.prepare as ReturnType<typeof vi.fn>)().bind;
      const bindArgs = (bindMock as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
      expect(bindArgs).toContain(expectedLimit);
      expect(bindArgs).toContain(planName);

      mockFetch.mockReset();
    }
  });
});

// ---------------------------------------------------------------------------
// chargeOverage
// ---------------------------------------------------------------------------

describe("chargeOverage", () => {
  beforeEach(() => mockFetch.mockReset());

  it("creates overage charge for pro plan", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appUsageRecordCreate: {
          appUsageRecord: { id: "gid://shopify/AppUsageRecord/1" },
          userErrors: [],
        },
      })
    );

    const result = await chargeOverage(
      "test.myshopify.com",
      "token",
      "gid://shopify/AppSubscriptionLineItem/1",
      "pro",
      10
    );

    expect(result.usageRecordId).toBe("gid://shopify/AppUsageRecord/1");
    expect(result.imagesCharged).toBe(10);
    // 10 * $0.05 = $0.50
    expect(result.amountCharged).toBe(0.5);
  });

  it("creates overage charge for business plan", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appUsageRecordCreate: {
          appUsageRecord: { id: "gid://shopify/AppUsageRecord/2" },
          userErrors: [],
        },
      })
    );

    const result = await chargeOverage(
      "test.myshopify.com",
      "token",
      "gid://shopify/AppSubscriptionLineItem/2",
      "business",
      500
    );

    expect(result.imagesCharged).toBe(500);
    // 500 * $0.01 = $5
    expect(result.amountCharged).toBe(5);
  });

  it("caps charge at plan cappedAmount", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appUsageRecordCreate: {
          appUsageRecord: { id: "gid://shopify/AppUsageRecord/3" },
          userErrors: [],
        },
      })
    );

    // Pro plan cap = $50, overage = 5000 images * $0.05 = $250 → capped at $50
    const result = await chargeOverage(
      "test.myshopify.com",
      "token",
      "gid://shopify/AppSubscriptionLineItem/3",
      "pro",
      5_000
    );

    expect(result.amountCharged).toBe(50); // capped
  });

  it("throws if plan does not support overage (hobby)", async () => {
    await expect(
      chargeOverage(
        "test.myshopify.com",
        "token",
        "gid://shopify/AppSubscriptionLineItem/1",
        "hobby",
        10
      )
    ).rejects.toThrow('Plan "hobby" does not support overage charges');
  });

  it("throws on userErrors from Shopify", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appUsageRecordCreate: {
          appUsageRecord: null,
          userErrors: [{ field: ["price"], message: "Amount exceeds capped amount" }],
        },
      })
    );

    await expect(
      chargeOverage(
        "test.myshopify.com",
        "token",
        "gid://shopify/AppSubscriptionLineItem/1",
        "pro",
        100
      )
    ).rejects.toThrow("Amount exceeds capped amount");
  });
});

// ---------------------------------------------------------------------------
// cancelSubscription
// ---------------------------------------------------------------------------

describe("cancelSubscription", () => {
  beforeEach(() => mockFetch.mockReset());

  it("skips API call for free subscription", async () => {
    await cancelSubscription("test.myshopify.com", "token", "free");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("cancels active subscription via Shopify API", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appSubscriptionCancel: {
          appSubscription: {
            id: "gid://shopify/AppSubscription/123",
            status: "CANCELLED",
          },
          userErrors: [],
        },
      })
    );

    await expect(
      cancelSubscription(
        "test.myshopify.com",
        "token",
        "gid://shopify/AppSubscription/123"
      )
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("test.myshopify.com");
  });

  it("throws on userErrors during cancellation", async () => {
    mockFetch.mockResolvedValueOnce(
      shopifyResponse({
        appSubscriptionCancel: {
          appSubscription: null,
          userErrors: [{ field: ["id"], message: "Subscription not found" }],
        },
      })
    );

    await expect(
      cancelSubscription(
        "test.myshopify.com",
        "token",
        "gid://shopify/AppSubscription/999"
      )
    ).rejects.toThrow("Subscription not found");
  });
});
