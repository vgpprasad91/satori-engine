# Shopify API Version Upgrade Guide

## Current Version

- **API Version**: `2025-04` (set in `shopify-app/src/config.ts`)
- **Upgrade-by date**: `2026-01-01` (Shopify deprecates versions ~12 months after release)

## Upgrade Process

1. **Check the changelog**: Review breaking changes at https://shopify.dev/docs/api/release-notes

2. **Update the version constant**:
   ```ts
   // shopify-app/src/config.ts
   export const SHOPIFY_API_VERSION = "YYYY-MM";
   ```

3. **Update shopify.app.toml** (if `api_version` is specified)

4. **Update wrangler.toml** comment with the new upgrade-by date

5. **Search for any hardcoded API versions**:
   ```bash
   grep -r "2025-04" shopify-app/
   ```

6. **Run the test suite**:
   ```bash
   cd shopify-app && npm run typecheck && npm test
   ```

7. **Test locally**: Run `shopify app dev` and verify all GraphQL queries work

8. **Deploy to staging first**: `npm run deploy:staging`

9. **Monitor for errors**: Check Sentry and Logpush for API deprecation warnings

## Version Lifecycle

Shopify API versions follow the format `YYYY-MM` and are released quarterly:
- `YYYY-01` (January)
- `YYYY-04` (April)
- `YYYY-07` (July)
- `YYYY-10` (October)

Each version is supported for ~12 months after release. Set a calendar reminder for the upgrade-by date.
