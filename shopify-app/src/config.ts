/**
 * Central configuration constants for the Shopify app.
 */

/**
 * Shopify API version — update this when upgrading.
 * Current: 2025-04 (stable). Upgrade-by date: 2026-01-01.
 *
 * To upgrade:
 *   1. Update this constant
 *   2. Review changelog: https://shopify.dev/docs/api/release-notes
 *   3. Run full test suite
 *   4. Update wrangler.toml comment
 *   5. See docs/api-version-upgrade.md for detailed steps
 */
export const SHOPIFY_API_VERSION = "2025-04";
