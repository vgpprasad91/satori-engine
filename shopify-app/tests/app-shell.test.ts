/**
 * PR-020: Embedded app shell — unit tests
 *
 * Covers:
 *  1. extractAppBridgeParams() — parses apiKey + host from URL
 *  2. NAV_ITEMS               — correct labels, URLs, aria-labels
 *  3. navItemA11y()           — returns proper ARIA attributes
 *  4. navLandmarkA11y()       — returns navigation landmark attrs
 *  5. mainContentA11y()       — returns main content ARIA attrs
 *  6. mapErrorToBanner()      — maps errors to user-friendly banners
 *  7. LAZY_ROUTES             — all 5 routes present
 */

import { describe, it, expect } from "vitest";
import {
  extractAppBridgeParams,
  NAV_ITEMS,
  navItemA11y,
  navLandmarkA11y,
  mainContentA11y,
  mapErrorToBanner,
  LAZY_ROUTES,
} from "../src/app-shell.server.js";

// ---------------------------------------------------------------------------
// 1. extractAppBridgeParams
// ---------------------------------------------------------------------------

describe("extractAppBridgeParams", () => {
  it("returns apiKey and host from URL search params", () => {
    const url = "https://myapp.example.com/app?apiKey=abc123&host=ZXhhbXBsZS5teXNob3BpZnkuY29t";
    const result = extractAppBridgeParams(url);
    expect(result).toEqual({ apiKey: "abc123", host: "ZXhhbXBsZS5teXNob3BpZnkuY29t" });
  });

  it("accepts api_key as alternative param name", () => {
    const url = "https://myapp.example.com/app?api_key=key999&host=aGVsbG8=";
    const result = extractAppBridgeParams(url);
    expect(result).toEqual({ apiKey: "key999", host: "aGVsbG8=" });
  });

  it("uses fallbackApiKey when apiKey param is absent", () => {
    const url = "https://myapp.example.com/app?host=dGVzdA==";
    const result = extractAppBridgeParams(url, "fallback-key");
    expect(result).toEqual({ apiKey: "fallback-key", host: "dGVzdA==" });
  });

  it("returns null when host is missing", () => {
    const url = "https://myapp.example.com/app?apiKey=abc123";
    expect(extractAppBridgeParams(url)).toBeNull();
  });

  it("returns null when both params are missing", () => {
    const url = "https://myapp.example.com/app";
    expect(extractAppBridgeParams(url)).toBeNull();
  });

  it("accepts a URL object", () => {
    const url = new URL("https://myapp.example.com/app?apiKey=k&host=h");
    expect(extractAppBridgeParams(url)).toEqual({ apiKey: "k", host: "h" });
  });

  it("returns null when apiKey missing and no fallback", () => {
    const url = "https://myapp.example.com/app?host=h";
    expect(extractAppBridgeParams(url)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. NAV_ITEMS structure
// ---------------------------------------------------------------------------

describe("NAV_ITEMS", () => {
  it("has exactly 5 top-level navigation items", () => {
    expect(NAV_ITEMS).toHaveLength(5);
  });

  it("contains Dashboard, Products, Templates, Settings, Billing in order", () => {
    const labels = NAV_ITEMS.map((n) => n.label);
    expect(labels).toEqual(["Dashboard", "Products", "Templates", "Settings", "Billing"]);
  });

  it("each item has a url starting with /app/", () => {
    NAV_ITEMS.forEach((item) => {
      expect(item.url).toMatch(/^\/app\//);
    });
  });

  it("each item has a non-empty ariaLabel", () => {
    NAV_ITEMS.forEach((item) => {
      expect(item.ariaLabel).toBeTruthy();
      expect(item.ariaLabel.length).toBeGreaterThan(0);
    });
  });

  it("each item has an accessKey", () => {
    NAV_ITEMS.forEach((item) => {
      expect(item.accessKey).toBeDefined();
      expect(item.accessKey!.length).toBe(1);
    });
  });

  it("URLs are unique", () => {
    const urls = NAV_ITEMS.map((n) => n.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("accessKeys are unique", () => {
    const keys = NAV_ITEMS.map((n) => n.accessKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// 3. navItemA11y
// ---------------------------------------------------------------------------

describe("navItemA11y", () => {
  const item = NAV_ITEMS[0]!; // Dashboard

  it("returns aria-label matching the item ariaLabel", () => {
    const attrs = navItemA11y(item, false);
    expect(attrs["aria-label"]).toBe(item.ariaLabel);
  });

  it("sets aria-current to 'page' when active", () => {
    const attrs = navItemA11y(item, true);
    expect(attrs["aria-current"]).toBe("page");
  });

  it("aria-current is undefined when not active", () => {
    const attrs = navItemA11y(item, false);
    expect(attrs["aria-current"]).toBeUndefined();
  });

  it("sets role to 'link'", () => {
    const attrs = navItemA11y(item, false);
    expect(attrs.role).toBe("link");
  });

  it("sets tabIndex to 0", () => {
    const attrs = navItemA11y(item, false);
    expect(attrs.tabIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. navLandmarkA11y
// ---------------------------------------------------------------------------

describe("navLandmarkA11y", () => {
  it("returns role='navigation'", () => {
    expect(navLandmarkA11y().role).toBe("navigation");
  });

  it("returns aria-label for main navigation", () => {
    expect(navLandmarkA11y()["aria-label"]).toBe("Main navigation");
  });
});

// ---------------------------------------------------------------------------
// 5. mainContentA11y
// ---------------------------------------------------------------------------

describe("mainContentA11y", () => {
  it("returns role='main'", () => {
    expect(mainContentA11y().role).toBe("main");
  });

  it("returns aria-label for main content", () => {
    expect(mainContentA11y()["aria-label"]).toBe("Main content");
  });

  it("returns tabIndex=-1 (skip-link target)", () => {
    expect(mainContentA11y().tabIndex).toBe(-1);
  });

  it("returns id='main-content'", () => {
    expect(mainContentA11y().id).toBe("main-content");
  });
});

// ---------------------------------------------------------------------------
// 6. mapErrorToBanner
// ---------------------------------------------------------------------------

describe("mapErrorToBanner", () => {
  it("maps 401 Response to authentication warning", () => {
    const err = new Response(null, { status: 401 });
    const banner = mapErrorToBanner(err);
    expect(banner.status).toBe("warning");
    expect(banner.title).toContain("Authentication");
  });

  it("maps 403 Response to authentication warning", () => {
    const err = new Response(null, { status: 403 });
    const banner = mapErrorToBanner(err);
    expect(banner.status).toBe("warning");
  });

  it("maps 404 Response to warning", () => {
    const err = new Response(null, { status: 404 });
    const banner = mapErrorToBanner(err);
    expect(banner.status).toBe("warning");
    expect(banner.title.toLowerCase()).toContain("not found");
  });

  it("maps 500 Response to critical", () => {
    const err = new Response(null, { status: 500 });
    const banner = mapErrorToBanner(err);
    expect(banner.status).toBe("critical");
  });

  it("maps quota_exceeded Error to warning", () => {
    const err = new Error("quota_exceeded: monthly limit reached");
    const banner = mapErrorToBanner(err);
    expect(banner.status).toBe("warning");
    expect(banner.title).toContain("quota");
  });

  it("maps generic Error to critical with message", () => {
    const err = new Error("Something broke");
    const banner = mapErrorToBanner(err);
    expect(banner.status).toBe("critical");
    expect(banner.message).toBe("Something broke");
  });

  it("maps unknown value to critical fallback", () => {
    const banner = mapErrorToBanner("unexpected string error");
    expect(banner.status).toBe("critical");
    expect(banner.title).toContain("Unexpected");
  });

  it("returns non-empty title and message for all cases", () => {
    [
      new Response(null, { status: 401 }),
      new Response(null, { status: 404 }),
      new Response(null, { status: 500 }),
      new Error("oops"),
      null,
      undefined,
      42,
    ].forEach((err) => {
      const b = mapErrorToBanner(err);
      expect(b.title.length).toBeGreaterThan(0);
      expect(b.message.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 7. LAZY_ROUTES
// ---------------------------------------------------------------------------

describe("LAZY_ROUTES", () => {
  it("contains all 5 authenticated route segments", () => {
    expect(LAZY_ROUTES).toContain("app.dashboard");
    expect(LAZY_ROUTES).toContain("app.products");
    expect(LAZY_ROUTES).toContain("app.templates");
    expect(LAZY_ROUTES).toContain("app.settings");
    expect(LAZY_ROUTES).toContain("app.billing");
  });

  it("has exactly 5 entries", () => {
    expect(LAZY_ROUTES).toHaveLength(5);
  });
});
