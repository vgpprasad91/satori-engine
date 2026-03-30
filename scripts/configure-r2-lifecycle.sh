#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Configure R2 lifecycle rules for Shopify app buckets.
#
# Sets 90-day object expiration on asset and log buckets.
# R2 lifecycle rules cannot be set via wrangler.toml — they must be
# configured via the Cloudflare API or dashboard.
#
# Prerequisites:
#   - CLOUDFLARE_API_TOKEN env var (needs R2 Admin permissions)
#   - CLOUDFLARE_ACCOUNT_ID env var
#
# Usage:
#   export CLOUDFLARE_API_TOKEN="your-token"
#   export CLOUDFLARE_ACCOUNT_ID="your-account-id"
#   bash scripts/configure-r2-lifecycle.sh [environment]
#
# Environments: development, staging, production (default: production)
# ---------------------------------------------------------------------------

set -euo pipefail

ENV="${1:-production}"
API_BASE="https://api.cloudflare.com/client/v4"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set" >&2
  exit 1
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "ERROR: CLOUDFLARE_ACCOUNT_ID is not set" >&2
  exit 1
fi

BUCKETS=(
  "shopify-app-${ENV}-assets"
  "shopify-app-${ENV}-logs"
)

LIFECYCLE_RULE='{
  "rules": [
    {
      "id": "expire-after-90-days",
      "enabled": true,
      "conditions": {
        "prefix": ""
      },
      "actions": {
        "deleteAfterDays": 90
      }
    }
  ]
}'

for BUCKET in "${BUCKETS[@]}"; do
  echo "Setting 90-day lifecycle rule on bucket: ${BUCKET}"

  RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT \
    "${API_BASE}/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${BUCKET}/lifecycle" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${LIFECYCLE_RULE}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | head -n -1)

  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "  ✓ Lifecycle rule set successfully on ${BUCKET}"
  else
    echo "  ✗ Failed to set lifecycle rule on ${BUCKET} (HTTP ${HTTP_CODE})" >&2
    echo "  Response: ${BODY}" >&2
  fi
done

echo ""
echo "Done. Verify in Cloudflare Dashboard → R2 → [bucket] → Settings → Lifecycle Rules."
