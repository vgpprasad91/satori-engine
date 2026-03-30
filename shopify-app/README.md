# Shopify App — Cloudflare Workers

A Shopify embedded app built with Remix and deployed on Cloudflare Workers.

## Stack

- **Runtime**: Cloudflare Workers (Node.js compat mode)
- **Framework**: Remix (Cloudflare adapter)
- **Shopify SDK**: `@shopify/shopify-app-remix`
- **UI**: Shopify Polaris + App Bridge React
- **Database**: Cloudflare D1 (per environment)
- **Object Storage**: Cloudflare R2 (per environment)
- **Cache / Sessions**: Cloudflare KV (per environment)
- **Background Jobs**: Cloudflare Queues (per environment)

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy secrets file and fill in values
cp .dev.vars.example .dev.vars

# 3. Start local dev server (uses [env.development] bindings)
npm run dev
```

---

## Secrets Management

Secrets must be pushed to each Cloudflare environment separately using `wrangler secret put`.
Run each command and paste the secret value when prompted.

### Development environment

```bash
wrangler secret put SHOPIFY_API_KEY --env development
wrangler secret put SHOPIFY_API_SECRET --env development
wrangler secret put SHOPIFY_APP_URL --env development
wrangler secret put SHOPIFY_SCOPES --env development
wrangler secret put REMOVE_BG_API_KEY --env development
wrangler secret put RESEND_API_KEY --env development
wrangler secret put SENTRY_DSN --env development
wrangler secret put INTERNAL_API_KEY --env development
wrangler secret put GITHUB_WEBHOOK_SECRET --env development
```

### Staging environment

```bash
wrangler secret put SHOPIFY_API_KEY --env staging
wrangler secret put SHOPIFY_API_SECRET --env staging
wrangler secret put SHOPIFY_APP_URL --env staging
wrangler secret put SHOPIFY_SCOPES --env staging
wrangler secret put REMOVE_BG_API_KEY --env staging
wrangler secret put RESEND_API_KEY --env staging
wrangler secret put SENTRY_DSN --env staging
wrangler secret put INTERNAL_API_KEY --env staging
wrangler secret put GITHUB_WEBHOOK_SECRET --env staging
```

### Production environment

```bash
wrangler secret put SHOPIFY_API_KEY --env production
wrangler secret put SHOPIFY_API_SECRET --env production
wrangler secret put SHOPIFY_APP_URL --env production
wrangler secret put SHOPIFY_SCOPES --env production
wrangler secret put REMOVE_BG_API_KEY --env production
wrangler secret put RESEND_API_KEY --env production
wrangler secret put SENTRY_DSN --env production
wrangler secret put INTERNAL_API_KEY --env production
wrangler secret put GITHUB_WEBHOOK_SECRET --env production
```

---

## Cloudflare Resource Provisioning

Before deploying to a new environment, create the backing resources:

```bash
# D1 databases
wrangler d1 create shopify-app-dev
wrangler d1 create shopify-app-staging
wrangler d1 create shopify-app-production

# R2 buckets
wrangler r2 bucket create shopify-app-dev-assets
wrangler r2 bucket create shopify-app-staging-assets
wrangler r2 bucket create shopify-app-production-assets

# KV namespaces
wrangler kv namespace create shopify-app-dev-kv
wrangler kv namespace create shopify-app-staging-kv
wrangler kv namespace create shopify-app-production-kv

# Queues
wrangler queues create shopify-image-queue-dev
wrangler queues create shopify-image-queue-dev-dlq
wrangler queues create shopify-image-queue-staging
wrangler queues create shopify-image-queue-staging-dlq
wrangler queues create shopify-image-queue-production
wrangler queues create shopify-image-queue-production-dlq
```

After creating each resource, update the corresponding IDs in `wrangler.toml`.

---

## Deployment

```bash
# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:production
```

---

## Cron Triggers

The worker registers three scheduled tasks (UTC times):

| Schedule      | Description                  |
|---------------|------------------------------|
| `0 9 * * *`   | Webhook audit — daily 09:00  |
| `0 2 * * *`   | D1 backup — nightly 02:00    |
| `0 0 1 * *`   | Usage reset — 1st of month   |

---

## Shopify API Version

**Pinned to `2025-01`** — upgrade-by date: **2025-10-01**.

To upgrade: update `apiVersion` in `app/shopify.server.ts` and test all GraphQL queries against the new version's changelog.

---

## Testing

```bash
npm test          # Run Vitest suite
npm run typecheck # TypeScript strict check
```
