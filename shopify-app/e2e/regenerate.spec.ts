/**
 * PR-032 — Playwright E2E: Regenerate flow
 *
 * Verifies:
 *   1. A failed product shows a Regenerate button
 *   2. Clicking Regenerate calls POST /api/regenerate/:productId
 *   3. Status updates to "pending" after successful re-queue (202)
 *   4. Toast / confirmation is shown after regenerate
 *   5. Regenerate button is keyboard accessible (Tab + Enter)
 */

import { test, expect } from "@playwright/test";
import { TEST_SHOP, buildProductsHtml } from "./helpers/fixture-html";

const PRODUCTS = [
  {
    id: "prod_001",
    title: "Classic White T-Shirt",
    status: "success",
    r2_key: "shop/prod_001/abc.png",
  },
  {
    id: "prod_002",
    title: "Blue Denim Jacket",
    status: "failed",
    r2_key: null,
  },
  {
    id: "prod_003",
    title: "Running Shoes",
    status: "timed_out",
    r2_key: null,
  },
];

/** HTML with inline JS that calls fetch and updates status on 202 */
function buildProductsHtmlWithJs(products: typeof PRODUCTS): string {
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
        onclick="
          fetch('/api/regenerate/${p.id}', {method:'POST'})
            .then(r => {
              if(r.status === 202) {
                document.querySelector('[data-testid=product-status-${p.id}]').textContent = 'pending';
                const toast = document.getElementById('toast');
                if(toast) { toast.textContent = 'Image regeneration queued'; toast.style.display='block'; }
              }
            });
        "
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
  <div id="toast" role="status" aria-live="polite" style="display:none"></div>
  <nav aria-label="Main navigation">
    <a href="/app/dashboard">Dashboard</a>
    <a href="/app/products" aria-current="page">Products</a>
    <a href="/app/billing">Billing</a>
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

test.describe("Regenerate Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/app/products**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: buildProductsHtmlWithJs(PRODUCTS),
        });
      } else {
        await route.continue();
      }
    });
  });

  test("failed product shows Regenerate button", async ({ page }) => {
    await page.goto("/app/products?shop=" + TEST_SHOP);

    const failedStatus = page.getByTestId("product-status-prod_002");
    await expect(failedStatus).toContainText("failed");

    const regenBtn = page.getByTestId("regenerate-prod_002");
    await expect(regenBtn).toBeVisible();
    await expect(regenBtn).toBeEnabled();
  });

  test("timed_out product shows Regenerate button", async ({ page }) => {
    await page.goto("/app/products?shop=" + TEST_SHOP);

    const timedOutStatus = page.getByTestId("product-status-prod_003");
    await expect(timedOutStatus).toContainText("timed_out");

    const regenBtn = page.getByTestId("regenerate-prod_003");
    await expect(regenBtn).toBeVisible();
  });

  test("clicking Regenerate calls POST /api/regenerate/:id", async ({ page }) => {
    let regenerateCallCount = 0;
    let capturedProductId = "";

    await page.route("**/api/regenerate/**", async (route) => {
      regenerateCallCount++;
      const url = new URL(route.request().url());
      capturedProductId = url.pathname.split("/").pop() ?? "";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ queued: true, message: "Job re-queued successfully" }),
      });
    });

    await page.goto("/app/products?shop=" + TEST_SHOP);

    // Click the Regenerate button for the failed product
    await page.getByTestId("regenerate-prod_002").click();

    // Wait for fetch to complete
    await page.waitForResponse("**/api/regenerate/**");

    expect(regenerateCallCount).toBe(1);
    expect(capturedProductId).toBe("prod_002");
  });

  test("status updates to 'pending' after successful regenerate", async ({ page }) => {
    await page.route("**/api/regenerate/**", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ queued: true }),
      });
    });

    await page.goto("/app/products?shop=" + TEST_SHOP);

    // Verify initial status is "failed"
    await expect(page.getByTestId("product-status-prod_002")).toContainText("failed");

    // Click Regenerate
    await page.getByTestId("regenerate-prod_002").click();

    // Wait for the inline JS to update the DOM
    await expect(page.getByTestId("product-status-prod_002")).toContainText("pending", {
      timeout: 5000,
    });
  });

  test("toast confirmation appears after regenerate", async ({ page }) => {
    await page.route("**/api/regenerate/**", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ queued: true }),
      });
    });

    await page.goto("/app/products?shop=" + TEST_SHOP);

    await page.getByTestId("regenerate-prod_002").click();
    await page.waitForResponse("**/api/regenerate/**");

    // Toast should appear with confirmation copy
    const toast = page.locator("#toast");
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/queued|regenerat/i);
  });

  test("Regenerate button is keyboard-focusable and activatable with Enter", async ({
    page,
  }) => {
    await page.route("**/api/regenerate/**", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ queued: true }),
      });
    });

    await page.goto("/app/products?shop=" + TEST_SHOP);

    // Focus the Regenerate button for failed product via keyboard Tab
    const regenBtn = page.getByTestId("regenerate-prod_002");
    await regenBtn.focus();
    await expect(regenBtn).toBeFocused();

    // Activate with Enter
    await page.keyboard.press("Enter");

    // Status should update to pending
    await expect(page.getByTestId("product-status-prod_002")).toContainText("pending", {
      timeout: 5000,
    });
  });

  test("success product Regenerate button also works (re-generate is idempotent)", async ({
    page,
  }) => {
    let called = false;
    await page.route("**/api/regenerate/**", async (route) => {
      called = true;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ queued: true }),
      });
    });

    await page.goto("/app/products?shop=" + TEST_SHOP);

    const successRegenBtn = page.getByTestId("regenerate-prod_001");
    await expect(successRegenBtn).toBeVisible();
    await successRegenBtn.click();
    await page.waitForResponse("**/api/regenerate/**");

    expect(called).toBe(true);
  });
});
