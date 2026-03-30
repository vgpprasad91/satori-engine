# Shopify App — Production PR Roadmap

PRs are ordered strictly by dependency — each PR can be merged without breaking anything that came before it. No PR assumes code from a later PR exists. Observability is threaded in early so every subsequent PR is instrumented from the start.

---

## Dependency Graph (critical path)

```
001 → 002 → 003 → 004 → 005 → 007 → 008 → 006
                              ↓
                    009 → 011
                              ↓
                    012 → 010 → 013 → 014 → 015 → 016 → 017
                                                          ↓
                              018 → 019 → 020 → 021 → 022 → 023
                              ↓
          024 (logger — wire in after 003, instrument all above)
          025 (Sentry — wire in after 004)
          026 → 027 → 028 → 029 → 030
                              ↓
                    031 → 032
                              ↓
                    033 → 034 → 035 → 036 → 037 → 038
```

---

## Tier 1 — Foundation (nothing can be built without these)

### PR-001: Monorepo scaffold and environment configuration
**Depends on**: nothing
- Initialise `workers/shopify-app/` with `npm init @shopify/app@latest` using the Remix + Cloudflare adapter template
- Add `wrangler.toml` with three named environments: `[env.development]`, `[env.staging]`, `[env.production]`
- Configure isolated D1 databases, R2 buckets, KV namespaces, and Queue bindings per environment
- Add `.dev.vars.example` with all required secret keys (`SHOPIFY_API_SECRET`, `REMOVE_BG_API_KEY`, `SENTRY_DSN`, `RESEND_API_KEY`, `INTERNAL_API_KEY`)
- Add `.dev.vars` to `.gitignore`
- Document `wrangler secret put` commands for all environments in `README.md`

### PR-002: D1 schema and migration runner
**Depends on**: PR-001
- Create `migrations/` directory with versioned SQL files
- `0001_create_merchants.sql` — `merchants` table (shop, access_token, plan, billing_status, monthly_limit, locale, currency_format, created_at)
- `0002_create_products.sql` — `products` table (id, shop, shopify_product_id, title, image_url, last_synced)
- `0003_create_generated_images.sql` — `generated_images` table (id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at)
- `0004_create_webhook_log.sql` — `webhook_log` table (webhook_id, shop, type, processed_at)
- Wire `wrangler d1 migrations apply` into CI before every Worker deploy
- Add migration rollback documentation in `RUNBOOK.md`

### PR-003: CI/CD pipeline — GitHub Actions
**Depends on**: PR-001, PR-002
- `ci.yml` — runs on every PR: TypeScript type-check → Vitest unit tests → D1 migrations on staging → Worker deploy to staging → Playwright E2E tests against staging
- `deploy.yml` — runs on merge to main: same pipeline → Worker deploy to production
- `api-version-check.yml` — runs quarterly on cron: deploys staging with next Shopify API version, runs smoke tests, posts email alert if failures detected
- Cache `node_modules` and `wrangler` binary between runs
- Store all secrets in GitHub Actions secrets, never in workflow files

---

## Tier 2 — Structured Logger (wire in now so all subsequent PRs are instrumented from day one)

### PR-004: Structured logger and Cloudflare Logpush
**Depends on**: PR-003
- `logger.ts` wrapper: `log({ shop, productId, step, durationMs, status, error })` emitting JSON to `console.log` (captured by Cloudflare Logpush)
- Configure Cloudflare Logpush in `wrangler.toml` to stream to R2 (`logs/{YYYY}/{MM}/{DD}/`) with 90-day lifecycle rule
- Optional Logtail sink for searchable real-time queries (environment variable toggle)
- Sensitive fields (`access_token`) explicitly excluded from all log calls via TypeScript type constraint
- Unit tests: log shape validation, access_token never appears in output

---

## Tier 3 — Shopify Authentication (all business logic gates on this)

### PR-005: Shopify OAuth handshake and session storage
**Depends on**: PR-002, PR-004
- Implement OAuth install flow using Shopify's `@shopify/shopify-app-remix` package
- Store session tokens in D1 `merchants` table keyed by shop domain
- Handle token refresh and session expiry gracefully
- Add `shopifyAuth` middleware to all protected Remix routes
- Log auth events (install, token refresh, expiry) via PR-004 logger
- Unit tests: valid OAuth callback, invalid HMAC, expired token refresh

---

## Tier 4 — Webhook Infrastructure (depends on auth; all product events flow through here)

### PR-006: Webhook ingestion and HMAC validation
**Depends on**: PR-005
- Register webhook handler routes for: `products/create`, `products/update`, `products/delete`, `app/uninstalled`
- Register mandatory GDPR handlers: `customers/data_request`, `customers/redact`, `shop/redact`
- Validate every incoming webhook via HMAC-SHA256 against `SHOPIFY_API_SECRET` — return 200 immediately, hand off via `ctx.waitUntil()`
- Log every webhook receipt with type and shop via PR-004 logger
- Unit tests: valid HMAC passes, tampered payload rejected, all 7 webhook types handled, 200 returned before processing

### PR-007: Webhook deduplication via KV idempotency keys
**Depends on**: PR-006
- On every incoming webhook, check `webhook:{webhook_id}` key in KV before queuing
- If key exists: return 200 immediately, skip queue, log as deduplicated
- If key absent: write key with 24-hour TTL, proceed to queue
- Unit tests: duplicate webhook skipped, first occurrence processed, TTL expiry allows reprocessing

### PR-008: Locale and currency extraction on install
**Depends on**: PR-005, PR-006
- On `app/installed`, call Shopify Admin API to fetch `shop.primaryLocale` and `shop.currencyFormats`
- Store locale code and currency format string in D1 `merchants` table
- Expose locale as RTL boolean (`isRTL`) — Arabic (`ar`), Hebrew (`he`), Persian (`fa`) map to RTL true
- Unit tests: RTL detection for ar/he/fa, LTR for all others, currency format stored correctly

### PR-009: Webhook registration lifecycle and daily audit cron
**Depends on**: PR-006, PR-007, PR-008
- Programmatically register all required webhooks via Shopify GraphQL Admin API on `app/installed`
- Pin Shopify API version to `2025-01` in all GraphQL client headers — document upgrade-by date in `wrangler.toml` comment
- Cloudflare Cron Trigger (`0 9 * * *`) — audits registered webhooks against expected set per active merchant, re-registers missing ones, logs `{ shop, missing, reregistered }` to D1
- Alert if re-registration fails for >3 shops in one audit run
- Unit tests: registration on install, re-registration when webhook missing, API version header present on all calls

---

## Tier 5 — Billing and Usage Metering (depends on auth + webhooks; gates the pipeline)

### PR-010: Shopify billing API — subscription creation and plan management
**Depends on**: PR-005, PR-006
- Implement three plans in `billing.server.ts`: Hobby (100 images/month, $0), Pro (1,000 images/month, $29/month), Business (10,000 images/month, $79/month)
- Create Shopify `AppSubscription` on plan selection via GraphQL billing API
- Handle subscription approval callback, store plan and billing status in D1
- Implement capped usage-based overage charges for merchants who exceed limits
- Unit tests: plan creation, approval callback, overage charge creation

### PR-011: app/uninstalled grace period and session cleanup
**Depends on**: PR-009, PR-010
- On `app/uninstalled` webhook: immediately invalidate session (set `access_token = NULL`, `billing_status = uninstalled`), cancel active Shopify subscription, halt all queued jobs for that shop
- Purge merchant KV keys (brand kit, usage counter, rate limiter state)
- Log uninstall event with timestamp for churn analytics
- Unit tests: token purged on uninstall, queued jobs halted, subscription cancelled

---

## Tier 6 — Sentry (wire in now — pipeline is about to get complex; capture all exceptions with context)

### PR-012: Sentry error tracking
**Depends on**: PR-005, PR-003
- Wire `@sentry/cloudflare` into Remix frontend Worker — captures unhandled route errors with shop context
- Wire Sentry into Queue consumer Worker — captures pipeline exceptions with `{ shop, productId, step }` context
- Source maps uploaded to Sentry on every production deploy in CI
- Alert rules: >5 errors/minute from same shop → Sentry alert; DLQ depth >50 → Sentry alert
- Unit tests: Sentry capture called on exception, access_token scrubbed from breadcrumbs

---

## Tier 7 — Image Generation Pipeline (depends on billing + webhooks + auth)

### PR-013: Cloudflare Queue setup and job schema
**Depends on**: PR-007, PR-010, PR-011, PR-012
- Configure `shopify-image-queue` in `wrangler.toml` with `max_retries = 4`, `retry_delay = exponential`, dead letter queue binding
- Define job schema: `{ shop, productId, productTitle, imageUrl, templateId, locale, currencyFormat, brandKit }`
- Implement Queue producer in webhook handler — drops job after deduplication check passes and quota is not exceeded
- Implement Queue consumer Worker skeleton with 30-second timeout guard writing `timed_out` to D1 on breach
- Unit tests: job schema validation, timeout guard fires at 30s, DLQ receives after 4 retries

### PR-014: Usage metering — KV counters and quota enforcement
**Depends on**: PR-010, PR-013
- Per-merchant monthly usage counter in KV: `usage:{shop}:{YYYY-MM}` incrementing on every successful image generation
- Quota check at Queue consumer entry point before any pipeline work — `quota_exceeded` status written to D1, job rejected without consuming Remove.bg credits
- Cloudflare Cron Trigger (`0 0 1 * *`) — resets all usage counters on first of month, logs reset to D1 for billing reconciliation
- Unit tests: counter increment, quota exceeded rejection at consumer, monthly reset

### PR-015: Pre-flight product image quality gate
**Depends on**: PR-013, PR-014
- Fetch product image from Shopify CDN
- Call Cloudflare AI vision (`@cf/llava-1.5-7b-hf`) to score four dimensions: face/model presence, background clutter, resolution floor (min 400×400), aspect ratio fitness
- If face/model detected: skip compositing, use original image in branded frame (fallback path A)
- If clutter score high and resolution low: skip compositing, use text-dominant layout (fallback path B)
- If quality passes: proceed to background removal
- Surface quality gate result in `generated_images` status field
- Unit tests: face detection triggers fallback A, low-res triggers fallback B, clean product proceeds

### PR-016: Background removal — Remove.bg and Cloudflare AI rembg
**Depends on**: PR-015
- Primary: call Remove.bg API, check returned confidence score
- If confidence < 0.75: fall back to `@cf/inspyrenet/rembg` Cloudflare AI model (free within included units)
- If both fail or return poor mask: fall back to neutral studio background composite (marble/linen/slate preset)
- Token bucket rate limiter in KV (`ratelimit:removebg:{minute}`) caps Remove.bg calls to 10/minute
- Unit tests: confidence threshold fallback, rate limiter enforces cap, neutral background fallback renders

### PR-017: Satori renderer service binding integration
**Depends on**: PR-013, PR-008
- Call existing `mailcraft-satori` Worker via Cloudflare service binding from Queue consumer
- Pass merchant brand kit, template ID, product title, price (currency-formatted), and locale (`lta` RTL token)
- Receive PNG layout layer as `ArrayBuffer`
- Handle service binding timeout (10s) with graceful `renderer_timeout` status written to D1
- Unit tests: RTL locale passed correctly, currency string formatted, timeout handled

### PR-018: Image compositing and R2 storage
**Depends on**: PR-016, PR-017
- Composite background-removed product cutout onto Satori layout PNG using Cloudflare Workers Canvas API
- Generate content-addressed R2 key: `{shop}/{product_id}/{sha256(templateId+brandKitHash)}.png`
- Upload to R2 with `Cache-Control: public, max-age=31536000, immutable` headers
- Write R2 key, content hash, and `success` status to D1 `generated_images`
- If existing R2 key matches content hash: skip upload, return cached key (no regeneration if nothing changed)
- Increment merchant monthly usage counter in KV on success
- Unit tests: content-addressed key generation, cache hit skips upload, R2 metadata headers correct, usage counter incremented

### PR-019: Dead letter queue handler and failure surfacing
**Depends on**: PR-013, PR-018
- DLQ consumer Worker: reads failed jobs, writes `failed` status with full error context to D1
- Surfaces failed jobs in merchant dashboard with error category (quota_exceeded, timed_out, quality_gate, bg_removal_failed, renderer_timeout, compositing_failed)
- Manual regenerate endpoint: `POST /api/regenerate/:productId` — validates merchant session, re-queues job with fresh idempotency key, returns 202
- Unit tests: DLQ writes correct status per error category, regenerate re-queues correctly

---

## Tier 8 — Merchant UI (depends on full pipeline being in place so screens have real data)

### PR-020: Embedded app shell — Polaris layout and App Bridge
**Depends on**: PR-005, PR-012
- Polaris `AppProvider` wrapping all routes with Shopify theme tokens
- App Bridge `Provider` with `apiKey` and `host` from URL params on every embedded route
- Top-level navigation: Dashboard, Products, Templates, Settings, Billing
- Loading skeleton states for all data-fetching routes using route-level code splitting for <3 second first paint
- Error boundary with Polaris `Banner` showing user-friendly error messages
- All custom components include `aria-label`, `role`, `tabIndex` — axe-core accessibility linter added to CI

### PR-021: Merchant onboarding flow — first-run setup wizard
**Depends on**: PR-020, PR-018, PR-008
- Step 1: Brand kit setup — logo upload (R2), primary color picker, font selection
- Step 2: Template selection — grid of available templates with live preview thumbnails
- Step 3: Connection confirmation — shows count of products to be processed and estimated generation time
- Onboarding completion triggers Resend transactional email: setup confirmed, first images generating, support contact
- Usability target: full setup completes in under 15 minutes — enforced by Playwright timer assertion in E2E suite
- Unit tests: brand kit saved to KV, template preference saved to D1, email triggered on completion

### PR-022: Products dashboard — image status grid
**Depends on**: PR-020, PR-019, PR-014
- Polaris `ResourceList` of all synced products with generated image thumbnail, status badge (success/failed/pending/quota_exceeded/timed_out), and generated_at timestamp
- "Regenerate" button per product — calls `POST /api/regenerate/:productId`, shows toast confirmation
- Bulk regenerate selected products
- Filter by status, sort by generated_at
- Pagination with KV-cached product list for sub-200ms load
- Full keyboard navigation: arrow keys to navigate list, Enter to open detail, R to regenerate focused item

### PR-023: Template editor — brand kit customisation
**Depends on**: PR-020, PR-017
- Polaris-wrapped template editor built on existing playground editor component
- Template picker grid: 8 initial templates (product card, sale announcement, new arrival, story format, landscape post, square post, price drop, seasonal)
- Brand color picker with live preview re-rendering via debounced Satori renderer call
- Logo upload with R2 storage and preview
- Font family selector (limited to fonts already loaded in Satori renderer)
- Keyboard shortcuts: `Cmd+S` save, `Cmd+Z` undo, `Cmd+P` preview, `Esc` cancel
- `aria-label` on all canvas interaction zones, `role="application"` on editor container

### PR-024: Billing and plan management UI
**Depends on**: PR-020, PR-010, PR-014
- Current plan card showing plan name, images used this month, images remaining, reset date
- Plan comparison table: Hobby / Pro / Business with image limits, price, feature list
- Upgrade/downgrade flow via Shopify billing API — redirects to Shopify's hosted billing confirmation page
- Usage progress bar with warning state at 80% and critical state at 95% of monthly limit
- Overage explanation copy when capped usage charges apply

### PR-025: In-app usage limit banner and upgrade prompt
**Depends on**: PR-024, PR-014
- `Banner` component renders at top of every embedded page when usage > 80% of monthly limit
- Warning (80%): "You've used X of Y images this month — upgrade to avoid interruption"
- Critical (100%): "Image generation paused — upgrade your plan to resume"
- Banner dismissible per session via KV flag, reappears on next login
- Direct link to billing page from banner CTA

---

## Tier 9 — Analytics, Health, and Crons (depends on pipeline being instrumented)

### PR-026: Cloudflare Workers Analytics Engine metrics
**Depends on**: PR-018, PR-013
- Emit data points from Queue consumer: `{ shop, template_id, duration_ms, status, bg_removal_cost_credits }`
- Emit from webhook handler: `{ shop, webhook_type, deduplicated: bool }`
- Internal admin route `/internal/metrics` for per-shop generation counts and Remove.bg credit burn rate

### PR-027: Public /status page
**Depends on**: PR-026
- Standalone Cloudflare Worker at `/status` subdomain
- Displays: current queue depth, average generation time (p50/p95 from Analytics Engine), 30-day uptime, last incident
- Auto-refreshes every 30 seconds via polling
- No authentication required — linked from app listing description

### PR-028: App performance monitoring and SLA alerts
**Depends on**: PR-026, PR-027, PR-012
- Analytics Engine alert: average generation time p95 > 25 seconds → Sentry alert + email
- Analytics Engine alert: success rate < 95% over 1 hour → Sentry alert
- Analytics Engine alert: DLQ depth > 50 → Sentry alert
- External uptime monitor (Better Uptime free tier) pinging `/status` every 5 minutes

### PR-029: Daily D1 backup cron
**Depends on**: PR-002, PR-026
- Cloudflare Cron Trigger (`0 2 * * *`) — exports full D1 to R2 as `backups/db-{YYYY-MM-DD}.sql`
- R2 lifecycle rule: delete backups older than 30 days automatically
- Backup success/failure emitted to Analytics Engine
- Restore procedure documented in `RUNBOOK.md`

### PR-030: Monthly usage counter reset cron
**Depends on**: PR-014, PR-026
- Cloudflare Cron Trigger (`0 0 1 * *`) — scans all `usage:{shop}:*` KV keys
- Zeroes counters, writes reset log to D1 `webhook_log` for billing reconciliation
- Sends Resend email to internal address with monthly generation totals per shop before reset

---

## Tier 10 — Testing (formalises tests that have been written incrementally; now consolidated and CI-gated)

### PR-031: Vitest unit test suite consolidation
**Depends on**: PR-019 (all pipeline PRs complete)
- Consolidate and fill coverage gaps across all pipeline logic: compositing step sequencing, timeout guard, DLQ status writing, idempotency key lifecycle, rate limiter token bucket math, usage metering, RTL locale detection, currency formatting
- Accessibility: aria-label presence on all custom components (static render + attribute assertion)
- Target: >90% coverage on all `src/` files in `workers/shopify-app/`
- Block PRs with coverage regressions below threshold in CI

### PR-032: Playwright end-to-end test suite
**Depends on**: PR-025 (all UI PRs complete), PR-031
- Full merchant onboarding: install in Shopify development store → OAuth → brand kit → template → confirm → first image generated
- Keyboard navigation: full tab order through products list, Enter opens detail, R triggers regenerate, no mouse required
- Quota exceeded flow: mock usage counter at 100% → banner renders → upgrade CTA navigates to billing
- Regenerate flow: mock failed job in D1 → click regenerate → job re-queued → status updates to pending
- Onboarding timer: full setup completes in <15 minutes (`page.clock` assertion)
- Run against staging on every PR in CI

---

## Tier 11 — Legal, Support, and Submission (all features complete; now prepare for review)

### PR-033: Privacy policy and terms of service pages
**Depends on**: PR-030 (full feature set finalised — data handling scope is now known)
- Static Cloudflare Pages deploy at `legal.{yourdomain}.com`
- Privacy policy: lists data stored (product images, titles, access tokens), retention periods (access tokens deleted on uninstall, generated images 90 days, logs 90 days), third-party processors (Remove.bg, Resend, Sentry, Cloudflare)
- Terms of service: acceptable use policy, prohibited categories (adult content, weapons, counterfeit goods), DMCA process, termination conditions
- Both pages linked from Shopify app listing and embedded app footer

### PR-034: Support infrastructure setup
**Depends on**: PR-021 (onboarding email triggers need Intercom contact creation)
- Intercom free tier workspace — `app/installed` webhook auto-creates merchant contact
- Canned response library for 5 issues: images not generating, background removal looks wrong, template colors don't match brand, quota exceeded, billing question
- First-response SLA target: 24 hours documented in listing description
- Support email alias forwarding to Intercom inbox

### PR-035: App store listing assets
**Depends on**: PR-032, PR-033
- Demo store: Shopify development store with 20 real products across 3 categories (apparel, home goods, food), all with app-generated images
- App screenshots: 6 at 1600×900px — dashboard, template editor, products grid, billing page, onboarding wizard, status page
- Demo video: 45-second screen recording — install → brand kit → first image generated → download
- App icon: 512×512px generated via existing Satori renderer
- Short description (≤100 chars): "Auto-generate on-brand product images for social — set up once, works forever"
- Long description: pain point → how it works → 3 differentiators vs Outfy/Canva → pricing summary

### PR-036: App listing submission and review checklist
**Depends on**: PR-034, PR-035
- Verify all 7 webhook handlers return 200 within 5 seconds (Shopify requirement)
- Verify GDPR webhooks respond correctly to Shopify's test payloads
- Verify billing API creates and cancels subscriptions in Shopify Partners test environment
- Verify embedded app loads <3 seconds on throttled 3G in Chrome DevTools
- Verify all custom UI components pass axe-core accessibility audit with zero violations
- Submit for review with privacy policy URL, ToS URL, support email, demo store URL, and all listing assets

---

## Tier 12 — Launch Operations (post-submission; run while review is in progress)

### PR-037: Shopify partner changelog monitoring
**Depends on**: PR-003
- GitHub Actions workflow (`changelog-check.yml`) running weekly: fetches Shopify partner changelog RSS feed, diffs against last known version stored in KV, emails new entries
- Quarterly API version upgrade procedure in `RUNBOOK.md`: update version constant → deploy staging → full E2E → monitor 48h → deploy production
- Current pinned API version noted in `wrangler.toml` comment with upgrade-by date

### PR-038: Webhook audit Analytics Engine observability enhancement
**Depends on**: PR-009, PR-026
- Enhance existing PR-009 daily audit cron to emit results to Analytics Engine: `{ shop, missing_count, reregistered_count, audit_success }`
- Alert via Sentry if re-registration fails for >3 shops in one audit run
- Surface webhook health per merchant in `/internal/metrics`

---

## Phase 2 — Post-Launch (out of scope for initial submission)

### PR-039: Instagram Graph API direct publishing
**Depends on**: PR-036 (app live and stable)
- OAuth flow for Instagram Business accounts
- Post generated image directly to Instagram feed and stories from merchant dashboard
- Schedule posts via Cloudflare Cron

### PR-040: Pinterest API direct publishing
**Depends on**: PR-036
- OAuth flow for Pinterest business accounts
- Create pins directly from generated images with board selection and product metadata

### PR-041: Bulk product import and per-category template assignment
**Depends on**: PR-022
- CSV upload for bulk product → template mapping
- Background job for bulk processing with progress indicator
- Per-category template assignment (all "Apparel" products use template X)

### PR-042: Multi-template per product — format variants
**Depends on**: PR-041
- Generate 3–5 format variants per product simultaneously (square, story, landscape, OG image, banner)
- Format picker in products dashboard
- Per-format download and copy-link buttons

---

## PR Summary Table

| Tier | PRs | What it unlocks |
|------|-----|-----------------|
| 1 — Foundation | 001, 002, 003 | Repo, schema, CI/CD |
| 2 — Logger | 004 | All subsequent PRs are instrumented |
| 3 — Auth | 005 | All business logic gated on session |
| 4 — Webhooks | 006, 007, 008, 009 | Product events flow in, deduped, locale stored |
| 5 — Billing | 010, 011 | Plans enforced, uninstall handled cleanly |
| 6 — Sentry | 012 | Exceptions captured before pipeline complexity |
| 7 — Pipeline | 013, 014, 015, 016, 017, 018, 019 | End-to-end image generation works |
| 8 — UI | 020, 021, 022, 023, 024, 025 | Merchants can self-serve |
| 9 — Analytics | 026, 027, 028, 029, 030 | Observability, backup, health, crons |
| 10 — Testing | 031, 032 | Coverage gated in CI |
| 11 — Legal/Listing | 033, 034, 035, 036 | App review submission ready |
| 12 — Launch Ops | 037, 038 | Ongoing monitoring post-launch |
| Post-launch | 039–042 | Social publishing, bulk, multi-format |

**Minimum viable submission path** (everything else improves quality but does not block review):
`001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014 → 015 → 016 → 017 → 018 → 019 → 020 → 021 → 022 → 031 → 032 → 033 → 035 → 036`
