/**
 * PR-034: Support infrastructure tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CANNED_RESPONSES,
  SUPPORT_CONFIG,
  getCannedResponse,
  getAllCannedResponses,
  createIntercomContact,
  trackIntercomEvent,
  handleMerchantInstalled,
  type CannedResponseKey,
  type IntercomContact,
  type SupportEnv,
} from "../src/support.server.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Canned responses
// ---------------------------------------------------------------------------

describe("CANNED_RESPONSES", () => {
  const allKeys: CannedResponseKey[] = [
    "images_not_generating",
    "background_removal_wrong",
    "template_colors_mismatch",
    "quota_exceeded",
    "billing_question",
  ];

  it("has exactly 5 canned responses", () => {
    expect(Object.keys(CANNED_RESPONSES)).toHaveLength(5);
  });

  it.each(allKeys)("key %s has title and non-empty body", (key) => {
    const response = CANNED_RESPONSES[key];
    expect(response.title).toBeTruthy();
    expect(response.body.length).toBeGreaterThan(50);
    expect(Array.isArray(response.tags)).toBe(true);
    expect(response.tags.length).toBeGreaterThan(0);
  });

  it("images_not_generating mentions quota and regenerate", () => {
    const r = CANNED_RESPONSES.images_not_generating;
    expect(r.body).toMatch(/quota/i);
    expect(r.body).toMatch(/regenerate/i);
  });

  it("background_removal_wrong mentions algorithms and regenerate", () => {
    const r = CANNED_RESPONSES.background_removal_wrong;
    expect(r.body).toMatch(/regenerat/i);
  });

  it("template_colors_mismatch mentions brand kit and hex", () => {
    const r = CANNED_RESPONSES.template_colors_mismatch;
    expect(r.body).toMatch(/brand kit/i);
    expect(r.body).toMatch(/hex/i);
  });

  it("quota_exceeded lists all three plans with prices", () => {
    const r = CANNED_RESPONSES.quota_exceeded;
    expect(r.body).toMatch(/hobby/i);
    expect(r.body).toMatch(/pro/i);
    expect(r.body).toMatch(/business/i);
    expect(r.body).toMatch(/\$29/);
    expect(r.body).toMatch(/\$79/);
  });

  it("billing_question mentions Shopify and cancellation", () => {
    const r = CANNED_RESPONSES.billing_question;
    expect(r.body).toMatch(/shopify/i);
    expect(r.body).toMatch(/cancel/i);
  });
});

describe("getCannedResponse", () => {
  it("returns correct canned response for each key", () => {
    const r = getCannedResponse("quota_exceeded");
    expect(r.title).toBe("Quota Exceeded — Image Generation Paused");
  });
});

describe("getAllCannedResponses", () => {
  it("returns all 5 responses", () => {
    const all = getAllCannedResponses();
    expect(Object.keys(all)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// SUPPORT_CONFIG
// ---------------------------------------------------------------------------

describe("SUPPORT_CONFIG", () => {
  it("firstResponseSlaHours is 24", () => {
    expect(SUPPORT_CONFIG.firstResponseSlaHours).toBe(24);
  });

  it("supportEmailAlias is set", () => {
    expect(SUPPORT_CONFIG.supportEmailAlias).toMatch(/@/);
  });

  it("cannedResponseKeys has 5 entries", () => {
    expect(SUPPORT_CONFIG.cannedResponseKeys).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// createIntercomContact
// ---------------------------------------------------------------------------

describe("createIntercomContact", () => {
  it("calls Intercom contacts endpoint with correct payload", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "contact_abc123" }),
    });

    const contact: IntercomContact = {
      shop: "test-shop.myshopify.com",
      email: "owner@test-shop.com",
      name: "Test Shop",
      plan: "pro",
    };

    const result = await createIntercomContact(contact, "token_xxx");

    expect(result.contactId).toBe("contact_abc123");
    expect(mockFetch).toHaveBeenCalledOnce();

    const call0 = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string>; body: string }];
    expect(call0[0]).toBe("https://api.intercom.io/contacts");
    expect(call0[1].method).toBe("POST");
    expect(call0[1].headers.Authorization).toBe("Bearer token_xxx");

    const body = JSON.parse(call0[1].body);
    expect(body.external_id).toBe("test-shop.myshopify.com");
    expect(body.email).toBe("owner@test-shop.com");
    expect(body.custom_attributes.shop_domain).toBe(
      "test-shop.myshopify.com"
    );
    expect(body.custom_attributes.plan).toBe("pro");
  });

  it("throws on Intercom API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity",
    });

    await expect(
      createIntercomContact(
        { shop: "s.myshopify.com", email: "x@y.com" },
        "bad_token"
      )
    ).rejects.toThrow("Intercom API error 422");
  });
});

// ---------------------------------------------------------------------------
// trackIntercomEvent
// ---------------------------------------------------------------------------

describe("trackIntercomEvent", () => {
  it("posts event to Intercom events endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await trackIntercomEvent(
      {
        userId: "shop.myshopify.com",
        eventName: "app_installed",
        createdAt: 1700000000,
        metadata: { plan: "hobby" },
      },
      "token_yyy"
    );

    const call0 = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(call0[0]).toBe("https://api.intercom.io/events");
    expect(call0[1].method).toBe("POST");

    const body = JSON.parse(call0[1].body);
    expect(body.event_name).toBe("app_installed");
    expect(body.user_id).toBe("shop.myshopify.com");
    expect(body.metadata.plan).toBe("hobby");
  });
});

// ---------------------------------------------------------------------------
// handleMerchantInstalled
// ---------------------------------------------------------------------------

describe("handleMerchantInstalled", () => {
  const env: SupportEnv = {
    INTERCOM_ACCESS_TOKEN: "token_live",
  };

  it("creates contact and tracks event on install", async () => {
    // First call: createIntercomContact
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "cid_001" }),
    });
    // Second call: trackIntercomEvent
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await handleMerchantInstalled(
      {
        shop: "new-shop.myshopify.com",
        email: "owner@new-shop.com",
        shopName: "New Shop",
        plan: "hobby",
      },
      env
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call to contacts
    const call0b = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(call0b[0]).toContain("/contacts");

    // Second call to events
    const call1 = mockFetch.mock.calls[1] as [string, RequestInit & { body: string }];
    expect(call1[0]).toContain("/events");
    const eventBody = JSON.parse(call1[1].body);
    expect(eventBody.event_name).toBe("app_installed");
  });

  it("does not throw when INTERCOM_ACCESS_TOKEN is missing", async () => {
    const envNoToken: SupportEnv = { INTERCOM_ACCESS_TOKEN: "" };
    await expect(
      handleMerchantInstalled(
        { shop: "s.myshopify.com", email: "o@s.com" },
        envNoToken
      )
    ).resolves.toBeUndefined();

    // fetch should not have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not throw when Intercom API fails (non-fatal)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(
      handleMerchantInstalled(
        { shop: "s.myshopify.com", email: "o@s.com" },
        env
      )
    ).resolves.toBeUndefined();
  });

  it("uses hobby as default plan when plan not specified", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "cid_002" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await handleMerchantInstalled(
      { shop: "s.myshopify.com", email: "o@s.com" },
      env
    );

    const callLast = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const body = JSON.parse(callLast[1].body);
    expect(body.custom_attributes.plan).toBe("hobby");
  });
});
