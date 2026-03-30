/**
 * PR-033: Privacy policy and terms of service pages — static content validation
 *
 * These tests verify the static legal HTML files contain all required content
 * as specified: data categories, retention periods, third-party processors,
 * acceptable use policy, prohibited categories, and DMCA process.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGAL_DIR = join(__dirname, "../legal-pages");

let privacyHtml: string;
let tosHtml: string;

beforeAll(() => {
  privacyHtml = readFileSync(join(LEGAL_DIR, "privacy-policy.html"), "utf-8");
  tosHtml = readFileSync(join(LEGAL_DIR, "terms-of-service.html"), "utf-8");
});

// ---------------------------------------------------------------------------
// Privacy Policy
// ---------------------------------------------------------------------------

describe("Privacy Policy — data categories", () => {
  it("mentions product images", () => {
    expect(privacyHtml.toLowerCase()).toContain("product image");
  });

  it("mentions product titles", () => {
    expect(privacyHtml.toLowerCase()).toContain("product title");
  });

  it("mentions access tokens", () => {
    expect(privacyHtml.toLowerCase()).toContain("access token");
  });
});

describe("Privacy Policy — retention periods", () => {
  it("states access tokens deleted on uninstall", () => {
    expect(privacyHtml.toLowerCase()).toMatch(/token.{0,60}uninstall|uninstall.{0,60}token/i);
  });

  it("states 90-day retention for generated images", () => {
    expect(privacyHtml).toContain("90");
    expect(privacyHtml.toLowerCase()).toContain("generated image");
  });

  it("states 90-day retention for logs", () => {
    // "90 days" must appear at least twice (images + logs)
    const matches = privacyHtml.match(/90 days/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Privacy Policy — third-party processors", () => {
  it("lists Remove.bg as a processor", () => {
    expect(privacyHtml).toContain("Remove.bg");
  });

  it("lists Resend as a processor", () => {
    expect(privacyHtml).toContain("Resend");
  });

  it("lists Sentry as a processor", () => {
    expect(privacyHtml).toContain("Sentry");
  });

  it("lists Cloudflare as a processor", () => {
    expect(privacyHtml).toContain("Cloudflare");
  });
});

describe("Privacy Policy — GDPR webhooks", () => {
  it("mentions shop/redact webhook", () => {
    expect(privacyHtml).toContain("shop/redact");
  });

  it("mentions customers/data_request webhook", () => {
    expect(privacyHtml).toContain("customers/data_request");
  });

  it("mentions customers/redact webhook", () => {
    expect(privacyHtml).toContain("customers/redact");
  });
});

describe("Privacy Policy — navigation links", () => {
  it("links to terms of service page", () => {
    expect(privacyHtml).toContain("terms-of-service.html");
  });

  it("has a contact email address", () => {
    expect(privacyHtml).toContain("privacy@");
  });
});

// ---------------------------------------------------------------------------
// Terms of Service
// ---------------------------------------------------------------------------

describe("Terms of Service — acceptable use policy", () => {
  it("includes acceptable use section", () => {
    expect(tosHtml.toLowerCase()).toMatch(/acceptable use/i);
  });

  it("prohibits illegal content", () => {
    expect(tosHtml.toLowerCase()).toContain("illegal");
  });

  it("prohibits IP infringement", () => {
    expect(tosHtml.toLowerCase()).toMatch(/intellectual property|copyright/i);
  });
});

describe("Terms of Service — prohibited categories", () => {
  it("includes prohibited categories section", () => {
    expect(tosHtml.toLowerCase()).toMatch(/prohibited categor/i);
  });

  it("lists firearms as prohibited", () => {
    expect(tosHtml.toLowerCase()).toContain("firearm");
  });

  it("lists controlled substances as prohibited", () => {
    expect(tosHtml.toLowerCase()).toMatch(/controlled substance|pharmaceutical/i);
  });

  it("lists adult content as prohibited", () => {
    expect(tosHtml.toLowerCase()).toMatch(/adult|sexually explicit/i);
  });

  it("lists counterfeit goods as prohibited", () => {
    expect(tosHtml.toLowerCase()).toContain("counterfeit");
  });
});

describe("Terms of Service — DMCA process", () => {
  it("includes DMCA section", () => {
    expect(tosHtml).toContain("DMCA");
  });

  it("provides DMCA contact email", () => {
    expect(tosHtml).toContain("dmca@");
  });

  it("lists required DMCA notice elements", () => {
    expect(tosHtml.toLowerCase()).toContain("copyrighted work");
    expect(tosHtml.toLowerCase()).toContain("good-faith belief");
  });
});

describe("Terms of Service — termination conditions", () => {
  it("has a termination section", () => {
    expect(tosHtml.toLowerCase()).toContain("termination");
  });

  it("describes termination by merchant (uninstall)", () => {
    expect(tosHtml.toLowerCase()).toContain("uninstall");
  });

  it("describes termination by us for AUP violations", () => {
    expect(tosHtml.toLowerCase()).toMatch(/suspend|terminate.{0,50}violat/i);
  });
});

describe("Terms of Service — billing terms", () => {
  it("lists Hobby plan", () => {
    expect(tosHtml).toContain("Hobby");
  });

  it("lists Pro plan", () => {
    expect(tosHtml).toContain("Pro");
  });

  it("lists Business plan", () => {
    expect(tosHtml).toContain("Business");
  });

  it("specifies image limits", () => {
    expect(tosHtml).toContain("100");   // Hobby
    expect(tosHtml).toContain("1,000"); // Pro
    expect(tosHtml).toContain("10,000"); // Business
  });
});

describe("Terms of Service — navigation links", () => {
  it("links to privacy policy page", () => {
    expect(tosHtml).toContain("privacy-policy.html");
  });

  it("has a legal contact email", () => {
    expect(tosHtml).toContain("legal@");
  });
});

// ---------------------------------------------------------------------------
// Index page
// ---------------------------------------------------------------------------

describe("Legal index page", () => {
  it("exists and links to both pages", () => {
    const indexHtml = readFileSync(join(LEGAL_DIR, "index.html"), "utf-8");
    expect(indexHtml).toContain("privacy-policy.html");
    expect(indexHtml).toContain("terms-of-service.html");
  });
});
