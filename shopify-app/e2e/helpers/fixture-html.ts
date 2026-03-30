/**
 * Minimal HTML fixtures for Playwright E2E tests.
 *
 * These render enough DOM structure for Playwright to find elements by role,
 * label, and test-id — without needing a full Shopify/Remix render stack.
 */

export const TEST_SHOP = "mailcraft-e2e-test.myshopify.com";

export function buildOnboardingStep1Html(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>MailCraft Onboarding — Step 1</title></head>
<body>
  <main data-testid="onboarding-page">
    <h1>Welcome to MailCraft</h1>
    <p>Step 1 of 3 — Brand Kit</p>
    <div role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
      0%
    </div>

    <form data-testid="brand-kit-form" method="post" enctype="multipart/form-data">
      <input type="hidden" name="step" value="1" />
      <input type="hidden" name="shop" value="${TEST_SHOP}" />

      <label for="logo-upload">Brand Logo (optional, PNG/JPG, max 5MB)</label>
      <input id="logo-upload" type="file" name="logo" accept="image/png,image/jpeg"
             aria-label="Upload your brand logo" />

      <label for="primary-color">Primary Brand Color</label>
      <input id="primary-color" type="text" name="primaryColor" value="#0052CC"
             placeholder="#0052CC" aria-label="Primary Brand Color" />

      <label for="font-family">Font Family</label>
      <select id="font-family" name="fontFamily" aria-label="Font Family">
        <option value="Inter" selected>Inter</option>
        <option value="Playfair Display">Playfair Display</option>
        <option value="Roboto">Roboto</option>
        <option value="Bebas Neue">Bebas Neue</option>
      </select>

      <button type="submit" aria-label="Save brand kit and continue to template selection">
        Save and Continue →
      </button>
    </form>
  </main>
</body>
</html>`;
}

export function buildOnboardingStep2Html(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>MailCraft Onboarding — Step 2</title></head>
<body>
  <main data-testid="onboarding-page">
    <h1>Welcome to MailCraft</h1>
    <p>Step 2 of 3 — Template Selection</p>
    <div role="progressbar" aria-valuenow="33" aria-valuemin="0" aria-valuemax="100">
      33%
    </div>

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
        <label>
          <input type="radio" name="templateId" value="story-format"
                 aria-label="Select Story Format template" />
          Story Format
        </label>
        <label>
          <input type="radio" name="templateId" value="landscape-post"
                 aria-label="Select Landscape Post template" />
          Landscape Post
        </label>
        <label>
          <input type="radio" name="templateId" value="square-post"
                 aria-label="Select Square Post template" />
          Square Post
        </label>
        <label>
          <input type="radio" name="templateId" value="price-drop"
                 aria-label="Select Price Drop template" />
          Price Drop
        </label>
        <label>
          <input type="radio" name="templateId" value="seasonal"
                 aria-label="Select Seasonal template" />
          Seasonal
        </label>
      </fieldset>

      <a href="/app/onboarding?shop=${TEST_SHOP}" aria-label="Go back to step 1">← Back</a>
      <button type="submit" aria-label="Save template selection and continue to confirmation">
        Continue →
      </button>
    </form>
  </main>
</body>
</html>`;
}

export function buildOnboardingStep3Html(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>MailCraft Onboarding — Step 3</title></head>
<body>
  <main data-testid="onboarding-page">
    <h1>Welcome to MailCraft</h1>
    <p>Step 3 of 3 — Confirmation</p>
    <div role="progressbar" aria-valuenow="67" aria-valuemin="0" aria-valuemax="100">
      67%
    </div>

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

      <p>Estimated generation time for 20 products: ~10 minutes</p>

      <form method="post">
        <input type="hidden" name="step" value="3" />
        <input type="hidden" name="shop" value="${TEST_SHOP}" />
        <input type="hidden" name="productCount" value="20" />

        <a href="/app/onboarding?shop=${TEST_SHOP}" aria-label="Go back to step 2">← Back</a>
        <button type="submit" aria-label="Complete onboarding and go to dashboard">
          Go to Dashboard →
        </button>
      </form>
    </div>
  </main>
</body>
</html>`;
}

export function buildDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Dashboard — MailCraft</title></head>
<body>
  <nav aria-label="Main navigation">
    <a href="/app/dashboard" tabindex="0" aria-current="page">Dashboard</a>
    <a href="/app/products" tabindex="0">Products</a>
    <a href="/app/templates" tabindex="0">Templates</a>
    <a href="/app/settings" tabindex="0">Settings</a>
    <a href="/app/billing" tabindex="0">Billing</a>
  </nav>
  <main>
    <h1>Dashboard</h1>
    <p>Welcome back! Your images are being generated.</p>
  </main>
</body>
</html>`;
}

export function buildProductsHtml(products: Array<{
  id: string;
  title: string;
  status: string;
  r2_key: string | null;
}>): string {
  const rows = products
    .map(
      (p) => `
    <li data-testid="product-item" data-product-id="${p.id}" tabindex="0"
        role="listitem" aria-label="${p.title}, status: ${p.status}">
      <span data-testid="product-title">${p.title}</span>
      <span data-testid="product-status-${p.id}"
            aria-label="Status: ${p.status}">${p.status}</span>
      ${
        p.r2_key
          ? `<img src="/r2/${p.r2_key}" alt="Generated image for ${p.title}" />`
          : ""
      }
      <button
        data-testid="regenerate-${p.id}"
        aria-label="Regenerate image for ${p.title}"
      >
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

export function buildBillingHtml(imagesUsed: number, monthlyLimit: number): string {
  const pct = Math.min(100, Math.round((imagesUsed / monthlyLimit) * 100));
  const isWarning = pct >= 80 && pct < 100;
  const isCritical = pct >= 100;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Billing — MailCraft</title></head>
<body>
  <nav aria-label="Main navigation">
    <a href="/app/dashboard" tabindex="0">Dashboard</a>
    <a href="/app/products" tabindex="0">Products</a>
    <a href="/app/billing" tabindex="0" aria-current="page">Billing</a>
  </nav>
  <main>
    <h1>Billing &amp; Plan</h1>

    ${
      isCritical
        ? `<div role="alert" data-testid="usage-banner-critical"
                aria-label="Image generation paused — upgrade your plan to resume">
        Image generation paused — upgrade your plan to resume.
        <a href="/app/billing" data-testid="upgrade-cta"
           aria-label="Upgrade your plan">Upgrade Plan</a>
      </div>`
        : ""
    }
    ${
      isWarning
        ? `<div role="status" data-testid="usage-banner-warning"
                aria-label="You've used ${imagesUsed} of ${monthlyLimit} images this month — upgrade to avoid interruption">
        You've used ${imagesUsed} of ${monthlyLimit} images this month.
        <a href="/app/billing" data-testid="upgrade-cta"
           aria-label="Upgrade your plan">Upgrade Plan</a>
      </div>`
        : ""
    }

    <section aria-label="Current plan">
      <h2>Hobby Plan</h2>
      <p>Images used: <span data-testid="images-used">${imagesUsed}</span> / ${monthlyLimit}</p>
      <div role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
           aria-label="Usage: ${pct}%" data-testid="usage-progress">
        <div style="width:${pct}%"></div>
      </div>
    </section>

    <section aria-label="Plan comparison">
      <table>
        <thead>
          <tr><th>Plan</th><th>Images/month</th><th>Price</th><th>Action</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Hobby</td><td>100</td><td>Free</td>
            <td><span aria-label="Current plan">Current</span></td>
          </tr>
          <tr>
            <td>Pro</td><td>1,000</td><td>$29/mo</td>
            <td>
              <a href="/billing/upgrade/pro" aria-label="Upgrade to Pro plan">
                Upgrade to Pro
              </a>
            </td>
          </tr>
          <tr>
            <td>Business</td><td>10,000</td><td>$79/mo</td>
            <td>
              <a href="/billing/upgrade/business" aria-label="Upgrade to Business plan">
                Upgrade to Business
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}
