# Shopify App — Operations Runbook

## D1 Database Migrations

### Running migrations

Migrations live in `workers/shopify-app/migrations/` and are applied with
`wrangler d1 migrations apply`.  Always use a named environment.

```bash
# Local development (uses Miniflare's local D1 — no cloud D1 needed)
npm run db:migrate:dev

# Staging
npm run db:migrate:staging

# Production  ⚠️  run only after staging has passed
npm run db:migrate:production
```

In CI the staging migration runs automatically in the `ci.yml` workflow before
the Worker is deployed to staging.  Production migrations run in `deploy.yml`
on merge to `main`.

### Checking applied migrations

```bash
wrangler d1 migrations list shopify-app-staging --env staging
wrangler d1 migrations list shopify-app-production --env production
```

---

## Migration Rollback Procedure

D1 does **not** support automatic rollback of DDL statements.  Follow these
steps to undo a migration manually.

### Step 1 — identify the migration to roll back

```bash
wrangler d1 migrations list shopify-app-production --env production
```

Note the migration number you want to undo (e.g. `0003`).

### Step 2 — write a compensating migration

Create a new migration file that undoes the changes:

```sql
-- Example: rolling back 0003_create_generated_images.sql
DROP TABLE IF EXISTS generated_images;
```

Name it with the next sequential number, e.g.:

```
migrations/0005_rollback_generated_images.sql
```

### Step 3 — apply the compensating migration

```bash
# Staging first
npm run db:migrate:staging

# Verify behaviour in staging, then production
npm run db:migrate:production
```

### Step 4 — update the Worker code

Deploy a Worker version that no longer references the rolled-back table before
or at the same time as applying the compensating migration, to prevent runtime
errors during the deployment window.

### Step 5 — remove the original migration file (optional)

If the migration is being permanently abandoned, delete the original `.sql`
file from `migrations/` so future fresh installs do not apply it.

---

## Migration File Naming Convention

```
NNNN_description.sql
```

- `NNNN` — zero-padded four-digit sequence number (e.g. `0005`)
- `description` — snake_case summary (e.g. `add_template_tag_column`)

Migrations are applied in ascending numeric order.  Never renumber or edit an
already-applied migration; create a new one instead.

---

## Current Migration History

| # | File | Description |
|---|------|-------------|
| 1 | `0001_create_merchants.sql` | Merchants table — shop, access_token, plan, billing_status, monthly_limit, locale, currency_format |
| 2 | `0002_create_products.sql` | Products cache table — shopify_product_id, title, image_url, last_synced |
| 3 | `0003_create_generated_images.sql` | Generated images log — r2_key, content_hash, status, error_message |
| 4 | `0004_create_webhook_log.sql` | Webhook audit log — webhook_id, type, processed_at |

---

## Emergency: full database wipe (non-production only)

```bash
# ⚠️  DESTRUCTIVE — only use in development or staging
wrangler d1 execute shopify-app-dev --local --command "DROP TABLE IF EXISTS webhook_log; DROP TABLE IF EXISTS generated_images; DROP TABLE IF EXISTS products; DROP TABLE IF EXISTS merchants;"
npm run db:migrate:dev
```

Never run a full wipe against production.  If production data needs to be
cleared, raise an incident, get approval, and use targeted `DELETE` statements
with a `WHERE` clause.

---

## D1 Daily Backup and Restore (PR-029)

### How backups work

A Cloudflare Cron Trigger fires every night at **02:00 UTC** (`"0 2 * * *"`).
It exports the full D1 schema and data as a SQL dump and uploads it to R2 at:

```
backups/db-YYYY-MM-DD.sql
```

An R2 lifecycle rule automatically deletes objects older than **30 days**.
Backup success/failure is emitted to the Analytics Engine (`AE_METRICS`)
so you can chart backup health in the Cloudflare dashboard.

> **Set the R2 lifecycle rule once per bucket** (run after first deploy):
> ```bash
> wrangler r2 bucket lifecycle set shopify-app-production --env production \
>   --rule '{"id":"backup-30d","prefix":"backups/","expireDays":30}'
> ```

### Verifying the last backup

```bash
# List recent backup objects in production R2
wrangler r2 object list shopify-app-production --env production --prefix backups/

# Download today's backup and inspect it locally
TODAY=$(date -u +%Y-%m-%d)
wrangler r2 object get shopify-app-production "backups/db-${TODAY}.sql" \
  --env production --file "/tmp/db-${TODAY}.sql"
head -40 "/tmp/db-${TODAY}.sql"
```

### Restoring from a backup

> ⚠️  **Always restore to staging first and validate before touching production.**

#### Step 1 — Download the backup SQL file

```bash
BACKUP_DATE="2026-03-12"   # Replace with the target backup date
wrangler r2 object get shopify-app-production "backups/db-${BACKUP_DATE}.sql" \
  --env production --file "/tmp/restore-${BACKUP_DATE}.sql"
```

#### Step 2 — Review the SQL file

Open `/tmp/restore-YYYY-MM-DD.sql` and confirm it contains expected table
structures (merchants, products, generated_images, webhook_log) and row data.
The file starts with a header comment showing the exact timestamp it was taken.

#### Step 3 — Restore to staging (dry run)

```bash
# Apply to staging D1 — this DROPS and recreates all tables
wrangler d1 execute shopify-app-staging \
  --env staging \
  --file "/tmp/restore-${BACKUP_DATE}.sql"

# Verify row counts after restore
wrangler d1 execute shopify-app-staging \
  --env staging \
  --command "SELECT 'merchants' AS tbl, COUNT(*) AS n FROM merchants UNION ALL SELECT 'products', COUNT(*) FROM products UNION ALL SELECT 'generated_images', COUNT(*) FROM generated_images UNION ALL SELECT 'webhook_log', COUNT(*) FROM webhook_log;"
```

#### Step 4 — Restore to production (after staging validation)

```bash
# ⚠️  DESTRUCTIVE — get incident approval before running on production
# The SQL dump uses DROP TABLE IF EXISTS before recreating tables
wrangler d1 execute shopify-app-production \
  --env production \
  --file "/tmp/restore-${BACKUP_DATE}.sql"
```

#### Step 5 — Re-apply any migrations that post-date the backup

If migrations were applied after the backup was taken, re-apply them:

```bash
wrangler d1 migrations apply shopify-app-production --env production
```

#### Step 6 — Verify and close the incident

```bash
# Spot-check a merchant row
wrangler d1 execute shopify-app-production \
  --env production \
  --command "SELECT shop, plan, billing_status FROM merchants LIMIT 5;"
```

Document the restore in the incident log with: backup date used, row counts
before/after, migrations re-applied, and any data loss window.

---

## Quarterly Shopify API Version Upgrade (PR-037)

### Overview

Shopify releases a new API version every quarter and deprecates versions after
12 months.  The app pins to **`2025-01`** (upgrade-by: **2025-10-01**).
The GitHub Actions workflow `.github/workflows/api-version-check.yml` runs
quarterly and smoke-tests the next version on staging; the `changelog-check.yml`
workflow runs weekly and emails any new partner changelog entries.

### Current pinned API version

| Key | Value |
|-----|-------|
| Pinned version | `2025-01` |
| Upgrade-by date | `2025-10-01` |
| `wrangler.toml` comment | Line 2: `# Shopify API version pinned to 2025-01 — upgrade-by date: 2025-10-01` |

### Upgrade procedure (do this once per quarter)

#### Step 1 — Identify the new API version

Check the [Shopify API versioning page](https://shopify.dev/docs/api/usage/versioning)
for the new quarterly version (format: `YYYY-QQ`, e.g. `2025-04`).

#### Step 2 — Update the version constant in code

```bash
# Replace the version string globally in the Worker source
grep -r "2025-01" workers/shopify-app/src/ --include="*.ts"
# Update each occurrence to the new version, e.g. 2025-04
```

Key files that reference the API version:
- `src/webhook-registration.server.ts` — GraphQL client headers
- `src/billing.server.ts` — AppSubscription mutation headers
- `src/locale.server.ts` — shop query headers
- `src/auth.server.ts` — session setup

#### Step 3 — Update wrangler.toml

Change the comment on line 2 of `workers/shopify-app/wrangler.toml`:

```toml
# Shopify API version pinned to 2025-04 — upgrade-by date: 2026-04-01
```

#### Step 4 — Run the quarterly API version check CI workflow

```bash
gh workflow run api-version-check.yml --ref main
```

Monitor the run:
```bash
gh run list --workflow=api-version-check.yml --limit 5
```

The workflow deploys staging with the new version and runs smoke tests.

#### Step 5 — Review smoke test output

If smoke tests pass, proceed. If they fail:
- Check the [Shopify Changelog](https://changelog.shopify.com/) for breaking changes.
- Update any deprecated mutations or query fields.
- Re-run smoke tests.

#### Step 6 — Deploy to production

After all smoke tests pass on staging:

```bash
cd workers/shopify-app
npx wrangler deploy --env production
```

#### Step 7 — Update this RUNBOOK

Update the "Current pinned API version" table above with the new version and
upgrade-by date.

---

### Shopify Partner Changelog monitoring (PR-037)

The `changelog-check.yml` GitHub Actions workflow runs **every Monday at
09:00 UTC**.  It:

1. Fetches `https://changelog.shopify.com/rss.xml`.
2. Compares the latest entry GUID against `changelog:last_guid` stored in the
   production Cloudflare KV namespace (`CHANGELOG_KV_NAMESPACE_ID` secret).
3. If new entries exist, sends an email digest via Resend to the address in
   `CHANGELOG_ALERT_EMAIL` secret.
4. Saves the newest GUID back to KV.

**Required GitHub Actions secrets**:

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | API token with KV write access |
| `CHANGELOG_KV_NAMESPACE_ID` | Production KV namespace ID |
| `RESEND_API_KEY` | Resend API key for outbound email |
| `CHANGELOG_ALERT_EMAIL` | Email address to receive changelog digests |

**Manual trigger**:

```bash
gh workflow run changelog-check.yml --ref main
```
