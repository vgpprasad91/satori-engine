/**
 * Shared Playwright helpers for mocking Shopify embedded-app context.
 *
 * Shopify embedded apps rely on:
 *   1. OAuth session cookies (or URL tokens in dev mode)
 *   2. App Bridge postMessage handshake
 *   3. Various API calls (billing, products, webhooks)
 *
 * In E2E tests we:
 *   - Intercept Remix loader/action routes and return fixture data
 *   - Set a mock session cookie so auth middleware is satisfied
 *   - Stub App Bridge so the iframe handshake completes immediately
 */

import type { Page, Route } from "@playwright/test";

/** Default test shop domain */
export const TEST_SHOP = "mailcraft-e2e-test.myshopify.com";

/** Mock session cookie that auth middleware accepts in test mode */
export const SESSION_COOKIE = {
  name: "__shopify_session",
  value: "e2e-test-session-token",
  domain: "localhost",
  path: "/",
  httpOnly: true,
  secure: false,
};

/** Fixture: a merchant with no usage (fresh install) */
export const MERCHANT_FIXTURE = {
  shop: TEST_SHOP,
  plan: "hobby",
  monthly_limit: 100,
  images_used: 0,
  locale: "en",
  currency_format: "${{amount}}",
  billing_status: "active",
};

/** Fixture: products list */
export const PRODUCTS_FIXTURE = [
  {
    id: "prod_001",
    shop: TEST_SHOP,
    shopify_product_id: "gid://shopify/Product/1001",
    title: "Classic White T-Shirt",
    image_url: "https://cdn.shopify.com/s/files/1/0000/0001/products/tshirt.jpg",
    status: "success",
    r2_key: `${TEST_SHOP}/prod_001/abc123.png`,
    generated_at: new Date("2026-03-01T10:00:00Z").toISOString(),
  },
  {
    id: "prod_002",
    shop: TEST_SHOP,
    shopify_product_id: "gid://shopify/Product/1002",
    title: "Blue Denim Jacket",
    image_url: "https://cdn.shopify.com/s/files/1/0000/0001/products/jacket.jpg",
    status: "failed",
    r2_key: null,
    generated_at: new Date("2026-03-01T11:00:00Z").toISOString(),
  },
  {
    id: "prod_003",
    shop: TEST_SHOP,
    shopify_product_id: "gid://shopify/Product/1003",
    title: "Running Shoes",
    image_url: "https://cdn.shopify.com/s/files/1/0000/0001/products/shoes.jpg",
    status: "pending",
    r2_key: null,
    generated_at: null,
  },
];

/** Fixture: quota exceeded merchant (100/100 used) */
export const QUOTA_EXCEEDED_MERCHANT = {
  ...MERCHANT_FIXTURE,
  images_used: 100,
  monthly_limit: 100,
};

/** Inject App Bridge stub so the Shopify postMessage handshake resolves */
export async function injectAppBridgeStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Minimal App Bridge stub: satisfies Provider initialisation
    (window as unknown as Record<string, unknown>).__APP_BRIDGE_STUB__ = true;
    // Intercept createApp calls
    const origPostMessage = window.parent.postMessage.bind(window.parent);
    window.parent.postMessage = (msg: unknown, ...args: unknown[]) => {
      // Acknowledge all App Bridge dispatch messages immediately
      if (typeof msg === "string") {
        try {
          const parsed = JSON.parse(msg) as { type?: string; id?: string };
          if (parsed.type && parsed.id) {
            window.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ type: `${parsed.type}_Success`, id: parsed.id }),
                origin: window.location.origin,
              })
            );
          }
        } catch {
          // not JSON — pass through
        }
      }
      return origPostMessage(msg, ...args as [string]);
    };
  });
}

/** Set mock auth cookie so protected routes don't redirect to OAuth */
export async function setMockSession(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      ...SESSION_COOKIE,
      domain: new URL(page.url() || "http://localhost").hostname,
    },
  ]);
}

/**
 * Intercept all loader data fetches for the onboarding route
 * and return step-specific fixture data.
 */
export async function mockOnboardingLoaders(
  page: Page,
  step: 1 | 2 | 3 = 1
): Promise<void> {
  await page.route("**/app/onboarding**", async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: buildOnboardingHtml(step),
    });
  });
}

/** Mock the products dashboard loader */
export async function mockProductsLoader(
  page: Page,
  products = PRODUCTS_FIXTURE
): Promise<void> {
  await page.route("**/app/products**", async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: buildProductsHtml(products),
    });
  });
}

/** Mock the usage banner API endpoint */
export async function mockBannerApi(
  page: Page,
  imagesUsed: number,
  monthlyLimit: number
): Promise<void> {
  await page.route("**/api/banner**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ imagesUsed, monthlyLimit }),
    });
  });

  await page.route("**/app/billing**", async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: buildBillingHtml(imagesUsed, monthlyLimit),
    });
  });
}

/** Mock regenerate endpoint */
export async function mockRegenerateApi(page: Page): Promise<void> {
  await page.route("**/api/regenerate/**", async (route: Route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ queued: true, message: "Job re-queued successfully" }),
    });
  });
}

// ---------------------------------------------------------------------------
// Minimal HTML fixtures (render enough DOM for Playwright to interact with)
// These simulate what the Remix SSR would return for the route.
// ---------------------------------------------------------------------------

function buildOnboardingHtml(step: 1 | 2 | 3): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>MailCraft Onboarding</title></head>
<body>
  <div data-testid="onboarding-page">
    <h1>Welcome to MailCraft</h1>
    <p>Step ${step} of 3</p>
    <div role="progressbar" aria-valuenow="${((step - 1) / 3) * 100}" aria-valuemin="0" aria-valuemax="100">
      Progress: Step ${step}
    </div>

    ${step === 1 ? `
    <form data-testid="brand-kit-form" method="post" enctype="multipart/form-data">
      <input type="hidden" name="step" value="1" />
      <input type="hidden" name="shop" value="${TEST_SHOP}" />
      <label for="logo-upload">Brand Logo (optional, PNG/JPG, max 5MB)</label>
      <input id="logo-upload" type="file" name="logo" accept="image/png,image/jpeg"
             aria-label="Upload your brand logo" />
      <label for="primary-color">Primary Brand Color</label>
      <input id="primary-color" type="text" name="primaryColor" value="#0052CC"
             placeholder="#0052CC" />
      <label for="font-family">Font Family</label>
      <select id="font-family" name="fontFamily">
        <option value="Inter" selected>Inter</option>
        <option value="Playfair Display">Playfair Display</option>
        <option value="Roboto">Roboto</option>
      </select>
      <button type="submit" aria-label="Save brand kit and continue to template selection">
        Save and Continue →
      </button>
    </form>
    ` : ""}

    ${step === 2 ? `
    <form data-testid="template-form" method="post">
      <input type="hidden" name="step" value="2" />
      <input type="hidden" name="shop" value="${TEST_SHOP}" />
      <fieldset>
        <legend>Choose your default template</legend>
        <label>
          <input type="radio" name="templateId" value="product-card"
                 aria-label="Select Product Card template" required />
          Product Card
        </label>
        <label>
          <input type="radio" name="templateId" value="sale-announcement"
                 aria-label="Select Sale Announcement template" />
          Sale Announcement
        </label>
        <label>
          <input type="radio" name="templateId" value="new-arrival"
                 aria-label="Select New Arrival template" />
          New Arrival
        </label>
      </fieldset>
      <a href="/app/onboarding?shop=${TEST_SHOP}" aria-label="Go back to step 1">← Back</a>
      <button type="submit" aria-label="Save template selection and continue to confirmation">
        Continue →
      </button>
    </form>
    ` : ""}

    ${step === 3 ? `
    <div data-testid="confirmation-step">
      <div role="status" aria-label="Setup complete">
        Your brand kit and template have been saved successfully.
      </div>
      <dl>
        <dt>Brand Color</dt>
        <dd data-testid="brand-color">#0052CC</dd>
        <dt>Font</dt>
        <dd data-testid="brand-font">Inter</dd>
        <dt>Template</dt>
        <dd data-testid="selected-template">Product Card</dd>
      </dl>
      <form method="post">
        <input type="hidden" name="step" value="3" />
        <input type="hidden" name="shop" value="${TEST_SHOP}" />
        <input type="hidden" name="productCount" value="20" />
        <button type="submit" aria-label="Complete onboarding and go to dashboard">
          Go to Dashboard →
        </button>
      </form>
    </div>
    ` : ""}
  </div>
</body>
</html>`;
}

function buildProductsHtml(products: typeof PRODUCTS_FIXTURE): string {
  const rows = products
    .map(
      (p) => `
    <li data-testid="product-item" data-product-id="${p.id}" tabindex="0"
        role="listitem" aria-label="${p.title}, status: ${p.status}">
      <span data-testid="product-title">${p.title}</span>
      <span data-testid="product-status-${p.id}" aria-label="Status: ${p.status}">${p.status}</span>
      ${p.r2_key ? `<img src="/r2/${p.r2_key}" alt="Generated image for ${p.title}" />` : ""}
      <button data-testid="regenerate-${p.id}" aria-label="Regenerate image for ${p.title}"
              onclick="fetch('/api/regenerate/${p.id}', {method:'POST'}).then(() => { document.querySelector('[data-testid=product-status-${p.id}]').textContent = 'pending'; })">
        Regenerate
      </button>
    </li>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Products — MailCraft</title></head>
<body>
  <nav aria-label="Main navigation">
    <a href="/app/dashboard" tabindex="0">Dashboard</a>
    <a href="/app/products" tabindex="0" aria-current="page">Products</a>
    <a href="/app/templates" tabindex="0">Templates</a>
    <a href="/app/settings" tabindex="0">Settings</a>
    <a href="/app/billing" tabindex="0">Billing</a>
  </nav>
  <main>
    <h1>Products</h1>
    <ul data-testid="products-list" role="list" aria-label="Product image list">
      ${rows}
    </ul>
  </main>
</body>
</html>`;
}

function buildBillingHtml(imagesUsed: number, monthlyLimit: number): string {
  const pct = Math.round((imagesUsed / monthlyLimit) * 100);
  const isWarning = pct >= 80 && pct < 100;
  const isCritical = pct >= 100;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Billing — MailCraft</title></head>
<body>
  <main>
    <h1>Billing &amp; Plan</h1>
    ${isCritical ? `
    <div role="alert" data-testid="usage-banner-critical" aria-label="Image generation paused — upgrade your plan to resume">
      Image generation paused — upgrade your plan to resume.
      <a href="/app/billing" data-testid="upgrade-cta" aria-label="Upgrade your plan">Upgrade Plan</a>
    </div>` : ""}
    ${isWarning ? `
    <div role="status" data-testid="usage-banner-warning" aria-label="You've used ${imagesUsed} of ${monthlyLimit} images this month — upgrade to avoid interruption">
      You've used ${imagesUsed} of ${monthlyLimit} images this month — upgrade to avoid interruption.
      <a href="/app/billing" data-testid="upgrade-cta" aria-label="Upgrade your plan">Upgrade Plan</a>
    </div>` : ""}
    <section aria-label="Current plan">
      <h2>Hobby Plan</h2>
      <p>Images used: <span data-testid="images-used">${imagesUsed}</span> / ${monthlyLimit}</p>
      <div role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
           aria-label="Usage: ${pct}%">
        <div style="width:${pct}%"></div>
      </div>
    </section>
    <section aria-label="Plan comparison">
      <table>
        <thead>
          <tr><th>Plan</th><th>Images/month</th><th>Price</th><th>Action</th></tr>
        </thead>
        <tbody>
          <tr><td>Hobby</td><td>100</td><td>Free</td><td><span>Current</span></td></tr>
          <tr>
            <td>Pro</td><td>1,000</td><td>$29/mo</td>
            <td><a href="/billing/upgrade/pro" aria-label="Upgrade to Pro">Upgrade</a></td>
          </tr>
          <tr>
            <td>Business</td><td>10,000</td><td>$79/mo</td>
            <td><a href="/billing/upgrade/business" aria-label="Upgrade to Business">Upgrade</a></td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}
