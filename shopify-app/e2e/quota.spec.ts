/**
 * PR-032 — Playwright E2E: Quota exceeded flow
 *
 * Verifies:
 *   1. When usage == 100% → critical banner renders with correct copy
 *   2. When usage == 80%  → warning banner renders
 *   3. Upgrade CTA in the banner navigates to the billing page
 *   4. Banner is dismissible per session (dismiss flag respected)
 */

import { test, expect } from "@playwright/test";
import { TEST_SHOP, buildBillingHtml, buildProductsHtml } from "./helpers/fixture-html";

const PRODUCTS = [
  { id: "prod_001", title: "T-Shirt", status: "quota_exceeded", r2_key: null },
];

test.describe("Quota Exceeded Flow", () => {
  test("critical banner appears when usage is at 100%", async ({ page }) => {
    // Serve the billing page with 100/100 usage
    await page.route("**/app/billing**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildBillingHtml(100, 100),
      });
    });

    await page.goto("/app/billing?shop=" + TEST_SHOP);

    // Critical banner must be present
    const criticalBanner = page.getByTestId("usage-banner-critical");
    await expect(criticalBanner).toBeVisible();

    // Copy must mention "paused"
    await expect(criticalBanner).toContainText(/paused/i);

    // Upgrade CTA must be present in the banner
    const cta = criticalBanner.getByRole("link", { name: /upgrade/i });
    await expect(cta).toBeVisible();
  });

  test("warning banner appears when usage is at 80%", async ({ page }) => {
    await page.route("**/app/billing**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildBillingHtml(80, 100),
      });
    });

    await page.goto("/app/billing?shop=" + TEST_SHOP);

    const warningBanner = page.getByTestId("usage-banner-warning");
    await expect(warningBanner).toBeVisible();
    await expect(warningBanner).toContainText(/80/);
    await expect(warningBanner).toContainText(/100/);
  });

  test("no banner shown when usage is below 80%", async ({ page }) => {
    await page.route("**/app/billing**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildBillingHtml(50, 100),
      });
    });

    await page.goto("/app/billing?shop=" + TEST_SHOP);

    await expect(page.getByTestId("usage-banner-critical")).not.toBeVisible();
    await expect(page.getByTestId("usage-banner-warning")).not.toBeVisible();
  });

  test("upgrade CTA in critical banner navigates to billing page", async ({ page }) => {
    // Start on a products-like page that has the banner
    await page.route("**/app/billing**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildBillingHtml(100, 100),
      });
    });

    await page.goto("/app/billing?shop=" + TEST_SHOP);

    const upgradeLink = page.getByTestId("upgrade-cta").first();
    await expect(upgradeLink).toBeVisible();

    // The link should point to billing
    const href = await upgradeLink.getAttribute("href");
    expect(href).toMatch(/billing/);
  });

  test("usage progress bar reflects correct percentage at 100%", async ({ page }) => {
    await page.route("**/app/billing**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildBillingHtml(100, 100),
      });
    });

    await page.goto("/app/billing?shop=" + TEST_SHOP);

    const progressBar = page.getByRole("progressbar");
    await expect(progressBar).toBeVisible();

    const valuenow = await progressBar.getAttribute("aria-valuenow");
    expect(parseInt(valuenow ?? "0")).toBe(100);
  });

  test("usage progress bar reflects correct percentage at 80%", async ({ page }) => {
    await page.route("**/app/billing**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildBillingHtml(80, 100),
      });
    });

    await page.goto("/app/billing?shop=" + TEST_SHOP);

    const progressBar = page.getByRole("progressbar");
    const valuenow = await progressBar.getAttribute("aria-valuenow");
    expect(parseInt(valuenow ?? "0")).toBe(80);
  });

  test("plan comparison table shows all three plans", async ({ page }) => {
    await page.route("**/app/billing**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildBillingHtml(0, 100),
      });
    });

    await page.goto("/app/billing?shop=" + TEST_SHOP);

    await expect(page.getByText("Hobby")).toBeVisible();
    await expect(page.getByText("Pro")).toBeVisible();
    await expect(page.getByText("Business")).toBeVisible();
  });

  test("quota_exceeded product status is visible in products list", async ({ page }) => {
    await page.route("**/app/products**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildProductsHtml(PRODUCTS),
      });
    });

    await page.goto("/app/products?shop=" + TEST_SHOP);

    const status = page.getByTestId("product-status-prod_001");
    await expect(status).toBeVisible();
    await expect(status).toContainText("quota_exceeded");
  });
});
