import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for the Shopify embedded app.
 *
 * - Against staging: set STAGING_APP_URL env var.
 * - Against local dev: run `npm run dev` then `npm run test:e2e`.
 */
const baseURL =
  process.env.STAGING_APP_URL ??
  process.env.APP_BASE_URL ??
  "http://localhost:8788";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "playwright-results.xml" }],
    process.env.CI ? ["github"] : ["list"],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Embedded Shopify apps run in an iframe; allow cross-origin iframes.
    bypassCSP: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Timeout per test: 2 minutes (onboarding timer test needs up to 15 min
  // simulated, but page.clock compresses that to wall-clock milliseconds).
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
});
