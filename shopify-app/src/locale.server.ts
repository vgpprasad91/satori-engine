/**
 * PR-008: Locale and currency extraction on install
 *
 * On `app/installed`:
 *  - Calls Shopify Admin API (GraphQL 2025-01) to fetch shop.primaryLocale
 *    and shop.currencyFormats
 *  - Stores locale code and currency format string in D1 merchants table
 *  - Exposes isRTL boolean: Arabic (ar), Hebrew (he), Persian (fa) → true
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// RTL locale detection
// ---------------------------------------------------------------------------

/** Locale codes that use right-to-left script direction. */
const RTL_LOCALES = new Set(["ar", "he", "fa"]);

/**
 * Returns true if the given locale code is right-to-left.
 *
 * Handles both bare codes ("ar") and BCP 47 subtags ("ar-SA", "he-IL").
 */
export function isRTL(locale: string): boolean {
  if (!locale) return false;
  // Extract the primary language subtag (e.g. "ar" from "ar-SA")
  const primary = (locale.split("-")[0] ?? "").toLowerCase();
  return RTL_LOCALES.has(primary);
}

// ---------------------------------------------------------------------------
// Shopify GraphQL query
// ---------------------------------------------------------------------------

const SHOP_LOCALE_QUERY = /* graphql */ `
  query ShopLocaleAndCurrency {
    shop {
      primaryLocale
      currencyFormats {
        moneyFormat
        moneyWithCurrencyFormat
      }
    }
  }
`;

export interface ShopLocaleData {
  primaryLocale: string;
  currencyFormat: string;
  moneyWithCurrencyFormat: string;
  isRTL: boolean;
}

// ---------------------------------------------------------------------------
// Fetch locale + currency from Shopify Admin API
// ---------------------------------------------------------------------------

/**
 * Fetches shop.primaryLocale and shop.currencyFormats from the Shopify
 * Admin GraphQL API using the provided access token.
 *
 * API version is pinned to 2025-01 (upgrade-by: 2025-04-01 per wrangler.toml).
 */
export async function fetchShopLocale(
  shop: string,
  accessToken: string
): Promise<ShopLocaleData> {
  const res = await fetch(
    `https://${shop}/admin/api/2025-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
        "X-Shopify-API-Version": "2025-01",
      },
      body: JSON.stringify({ query: SHOP_LOCALE_QUERY }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify locale fetch failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    data?: {
      shop?: {
        primaryLocale?: string;
        currencyFormats?: {
          moneyFormat?: string;
          moneyWithCurrencyFormat?: string;
        };
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${json.errors[0]?.message ?? "Unknown error"}`);
  }

  const shopData = json.data?.shop;
  if (!shopData) {
    throw new Error("Empty shop data in Shopify locale response");
  }

  const primaryLocale = shopData.primaryLocale ?? "en";
  const currencyFormat = shopData.currencyFormats?.moneyFormat ?? "{{amount}}";
  const moneyWithCurrencyFormat =
    shopData.currencyFormats?.moneyWithCurrencyFormat ?? "{{amount}} USD";

  return {
    primaryLocale,
    currencyFormat,
    moneyWithCurrencyFormat,
    isRTL: isRTL(primaryLocale),
  };
}

// ---------------------------------------------------------------------------
// D1 persistence
// ---------------------------------------------------------------------------

/**
 * Saves the locale code and currency format string to the D1 merchants table.
 *
 * Uses INSERT OR REPLACE so subsequent installs (reinstalls) overwrite.
 */
export async function saveLocaleToD1(
  db: D1Database,
  shop: string,
  localeData: ShopLocaleData
): Promise<void> {
  await db
    .prepare(
      `UPDATE merchants
         SET locale = ?, currency_format = ?
       WHERE shop = ?`
    )
    .bind(localeData.primaryLocale, localeData.currencyFormat, shop)
    .run();
}

// ---------------------------------------------------------------------------
// Orchestrator: call on app/installed
// ---------------------------------------------------------------------------

export interface LocaleEnv {
  DB: D1Database;
}

/**
 * Top-level handler called during the app/installed webhook.
 *
 * 1. Fetches locale + currency from Shopify Admin API
 * 2. Stores in D1 merchants table
 * 3. Logs the result (no tokens in log output)
 *
 * Returns the extracted locale data so callers can act on isRTL immediately.
 */
export async function handleInstallLocale(
  shop: string,
  accessToken: string,
  env: LocaleEnv
): Promise<ShopLocaleData> {
  const start = Date.now();

  try {
    const localeData = await fetchShopLocale(shop, accessToken);
    await saveLocaleToD1(env.DB, shop, localeData);

    log({
      shop,
      step: "locale.install",
      status: "ok",
      durationMs: Date.now() - start,
    });

    return localeData;
  } catch (err) {
    log({
      shop,
      step: "locale.install",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    });
    throw err;
  }
}
