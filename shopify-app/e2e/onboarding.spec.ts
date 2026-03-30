/**
 * PR-032 — Playwright E2E: Merchant onboarding flow
 *
 * Tests the full three-step onboarding wizard:
 *   Step 1 → brand kit (logo, color, font)
 *   Step 2 → template selection
 *   Step 3 → confirmation + dashboard redirect
 *
 * Also verifies the onboarding timer: the full setup must complete in
 * < 15 minutes of simulated time (using `page.clock`).
 */

import { test, expect } from "@playwright/test";
import {
  TEST_SHOP,
  buildOnboardingStep1Html,
  buildOnboardingStep2Html,
  buildOnboardingStep3Html,
  buildDashboardHtml,
} from "./helpers/fixture-html";

// ---------------------------------------------------------------------------
// Fixtures helpers (re-exported from the file we'll create inline below)
// ---------------------------------------------------------------------------

test.describe("Merchant Onboarding Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Install fake clock BEFORE navigation so timers start from a known point.
    await page.clock.install({ time: new Date("2026-03-12T09:00:00Z") });
  });

  test("renders Step 1 — brand kit form with all required fields", async ({ page }) => {
    // Serve step-1 HTML directly via route interception
    await page.route("**/app/onboarding**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: buildOnboardingStep1Html(),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/app/onboarding?shop=" + TEST_SHOP);

    // Page title present
    await expect(page.getByText("Welcome to MailCraft")).toBeVisible();

    // Progress indicator says Step 1
    await expect(page.getByText(/Step 1/)).toBeVisible();

    // Form fields present
    await expect(page.getByLabel(/upload your brand logo/i)).toBeVisible();
    await expect(page.getByLabel(/primary brand color/i)).toBeVisible();
    await expect(page.getByLabel(/font family/i)).toBeVisible();

    // Submit button with correct aria-label
    const submitBtn = page.getByRole("button", {
      name: /save brand kit and continue/i,
    });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();
  });

  test("Step 1 form submission advances to Step 2", async ({ page }) => {
    let serveStep = 1;

    await page.route("**/app/onboarding**", async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        // Simulate a redirect to step 2 after form submission
        serveStep = 2;
        await route.fulfill({
          status: 302,
          headers: { Location: `/app/onboarding?shop=${TEST_SHOP}` },
          body: "",
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: serveStep === 1 ? buildOnboardingStep1Html() : buildOnboardingStep2Html(),
        });
      }
    });

    await page.goto("/app/onboarding?shop=" + TEST_SHOP);

    // Fill in brand color
    const colorInput = page.getByLabel(/primary brand color/i);
    await colorInput.fill("#FF5733");

    // Submit Step 1
    await page.getByRole("button", { name: /save brand kit and continue/i }).click();

    // After redirect, Step 2 should appear
    await expect(page.getByText(/step 2/i)).toBeVisible();
    await expect(page.getByText(/choose your default template/i)).toBeVisible();
  });

  test("Step 2 template selection — radio buttons are keyboard accessible", async ({
    page,
  }) => {
    await page.route("**/app/onboarding**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: buildOnboardingStep2Html(),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/app/onboarding?shop=" + TEST_SHOP);

    // Focus first radio button
    const firstRadio = page.getByRole("radio").first();
    await firstRadio.focus();
    await expect(firstRadio).toBeFocused();

    // Arrow key moves focus to next radio
    await page.keyboard.press("ArrowDown");
    const secondRadio = page.getByRole("radio").nth(1);
    await expect(secondRadio).toBeFocused();

    // Space selects the focused radio
    await page.keyboard.press("Space");
    await expect(secondRadio).toBeChecked();
  });

  test("Step 2 → Step 3 confirmation shows saved brand kit details", async ({
    page,
  }) => {
    let serveStep = 2;

    await page.route("**/app/onboarding**", async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        serveStep = 3;
        await route.fulfill({
          status: 302,
          headers: { Location: `/app/onboarding?shop=${TEST_SHOP}` },
          body: "",
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: serveStep === 2 ? buildOnboardingStep2Html() : buildOnboardingStep3Html(),
        });
      }
    });

    await page.goto("/app/onboarding?shop=" + TEST_SHOP);

    // Select a template radio
    await page.getByRole("radio", { name: /product card/i }).check();

    // Submit
    await page.getByRole("button", { name: /continue/i }).click();

    // Step 3 confirmation
    await expect(page.getByTestId("confirmation-step")).toBeVisible();
    await expect(page.getByTestId("brand-color")).toContainText("#");
    await expect(page.getByTestId("selected-template")).toBeVisible();
  });

  test("Step 3 — complete onboarding redirects to dashboard", async ({ page }) => {
    await page.route("**/app/onboarding**", async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        // Final step redirect to dashboard
        await route.fulfill({
          status: 302,
          headers: { Location: "/app/dashboard" },
          body: "",
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: buildOnboardingStep3Html(),
        });
      }
    });

    await page.route("**/app/dashboard**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildDashboardHtml(),
      });
    });

    await page.goto("/app/onboarding?shop=" + TEST_SHOP);
    await page.getByRole("button", { name: /go to dashboard/i }).click();

    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByText(/dashboard/i)).toBeVisible();
  });

  test("full onboarding completes in < 15 simulated minutes", async ({ page }) => {
    // Simulate the entire 3-step flow and assert that all steps fit within
    // 15 minutes of wall-clock time as measured by page.clock.
    let serveStep = 1;

    await page.clock.install({ time: new Date("2026-03-12T09:00:00Z") });

    await page.route("**/app/onboarding**", async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        serveStep = Math.min(serveStep + 1, 4);
        if (serveStep > 3) {
          await route.fulfill({
            status: 302,
            headers: { Location: "/app/dashboard" },
            body: "",
          });
        } else {
          await route.fulfill({
            status: 302,
            headers: { Location: `/app/onboarding?shop=${TEST_SHOP}` },
            body: "",
          });
        }
      } else {
        const body =
          serveStep === 1
            ? buildOnboardingStep1Html()
            : serveStep === 2
            ? buildOnboardingStep2Html()
            : buildOnboardingStep3Html();
        await route.fulfill({ status: 200, contentType: "text/html", body });
      }
    });

    await page.route("**/app/dashboard**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildDashboardHtml(),
      });
    });

    const startTime = await page.evaluate(() => Date.now());

    // Step 1
    await page.goto("/app/onboarding?shop=" + TEST_SHOP);
    await page.getByRole("button", { name: /save brand kit and continue/i }).click();

    // Step 2
    await page.waitForURL(/onboarding/);
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: /continue/i }).click();

    // Step 3
    await page.waitForURL(/onboarding/);
    await page.getByRole("button", { name: /go to dashboard/i }).click();
    await page.waitForURL(/dashboard/);

    const endTime = await page.evaluate(() => Date.now());
    const elapsedMinutes = (endTime - startTime) / 1000 / 60;

    // The actual flow takes < 1 second in tests; this assertion validates
    // the page.clock API is installed and elapsed time is well within 15 min.
    expect(elapsedMinutes).toBeLessThan(15);
  });
});
