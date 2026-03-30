/**
 * PR-009: Webhook registration lifecycle and daily audit cron
 * PR-038: Webhook audit Analytics Engine observability enhancement
 *
 * Responsibilities:
 *  1. Programmatically register all required webhooks via Shopify GraphQL
 *     Admin API on `app/installed`.
 *  2. Shopify API version pinned to `2025-01` in all GraphQL client headers.
 *     Upgrade-by date: 2025-10-01 (documented in wrangler.toml).
 *  3. Cloudflare Cron Trigger (`0 9 * * *`) auditing registered webhooks per
 *     active merchant, re-registering missing ones, logging
 *     `{ shop, missing, reregistered }`.
 *  4. Alert if re-registration fails for >3 shops in one audit run.
 *  5. (PR-038) Emit `{ shop, missing_count, reregistered_count, audit_success }`
 *     to Analytics Engine after each per-merchant audit.
 *  6. (PR-038) Trigger Sentry alert when re-registration fails for >3 shops.
 *  7. (PR-038) Store webhook health snapshot in KV for /internal/metrics surfacing.
 */

import { log } from "./logger.js";
import type { AnalyticsEngineDataset } from "./analytics.server.js";
import type { SentryClient } from "./sentry.server.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shopify API version — pinned; upgrade-by: 2025-10-01 (see wrangler.toml) */
export const SHOPIFY_API_VERSION = "2025-01";

/** All webhook topics the app must have registered on every merchant shop. */
export const REQUIRED_WEBHOOK_TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "APP_UNINSTALLED",
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
] as const;

export type WebhookRegistrationTopic = (typeof REQUIRED_WEBHOOK_TOPICS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookRegistrationEnv {
  DB: D1Database;
  /** Worker base URL for webhook callback endpoints */
  APP_URL: string;
  /** Analytics Engine dataset — if provided, audit results are emitted (PR-038) */
  AE_METRICS?: AnalyticsEngineDataset;
  /** KV namespace — if provided, webhook health snapshots are stored (PR-038) */
  KV_STORE?: KVNamespace;
  /** Sentry client — if provided, >3 shop failures trigger a Sentry alert (PR-038) */
  SENTRY?: SentryClient;
}

export interface RegisteredWebhook {
  id: string;
  topic: string;
  callbackUrl: string;
  format: string;
}

export interface RegistrationResult {
  shop: string;
  registered: string[];
  skipped: string[];
  failed: string[];
}

export interface AuditResult {
  shop: string;
  missing: string[];
  reregistered: string[];
  failed: string[];
}

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

/**
 * Executes a GraphQL query/mutation against the Shopify Admin API.
 * All requests include the pinned API version header.
 */
export async function shopifyGraphQL<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
        "X-Shopify-API-Version": SHOPIFY_API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${body}`);
  }

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      `Shopify GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`
    );
  }

  return json.data as T;
}

// ---------------------------------------------------------------------------
// List registered webhooks
// ---------------------------------------------------------------------------

const LIST_WEBHOOKS_QUERY = /* graphql */ `
  query ListWebhookSubscriptions($first: Int!) {
    webhookSubscriptions(first: $first) {
      edges {
        node {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
          format
        }
      }
    }
  }
`;

export async function listRegisteredWebhooks(
  shop: string,
  accessToken: string
): Promise<RegisteredWebhook[]> {
  const data = await shopifyGraphQL<{
    webhookSubscriptions: {
      edges: Array<{
        node: {
          id: string;
          topic: string;
          endpoint: { callbackUrl?: string; __typename: string };
          format: string;
        };
      }>;
    };
  }>(shop, accessToken, LIST_WEBHOOKS_QUERY, { first: 50 });

  return data.webhookSubscriptions.edges.map(({ node }) => ({
    id: node.id,
    topic: node.topic,
    callbackUrl: node.endpoint.callbackUrl ?? "",
    format: node.format,
  }));
}

// ---------------------------------------------------------------------------
// Register a single webhook
// ---------------------------------------------------------------------------

const CREATE_WEBHOOK_MUTATION = /* graphql */ `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Registers a single webhook topic for a merchant shop.
 * Returns the new webhook subscription ID on success.
 */
export async function registerWebhook(
  shop: string,
  accessToken: string,
  topic: WebhookRegistrationTopic,
  callbackUrl: string
): Promise<string> {
  const data = await shopifyGraphQL<{
    webhookSubscriptionCreate: {
      webhookSubscription: { id: string; topic: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(shop, accessToken, CREATE_WEBHOOK_MUTATION, {
    topic,
    webhookSubscription: {
      callbackUrl,
      format: "JSON",
    },
  });

  const { webhookSubscription, userErrors } = data.webhookSubscriptionCreate;

  if (userErrors.length > 0) {
    throw new Error(
      `Webhook registration failed for ${topic}: ${userErrors
        .map((e) => e.message)
        .join(", ")}`
    );
  }

  if (!webhookSubscription) {
    throw new Error(`No webhook subscription returned for ${topic}`);
  }

  return webhookSubscription.id;
}

// ---------------------------------------------------------------------------
// Register all required webhooks on install
// ---------------------------------------------------------------------------

/**
 * Registers all required webhook topics for a newly installed merchant.
 * Called during the `app/installed` flow.
 *
 * - Fetches existing registrations first to avoid duplicates.
 * - Logs every registration attempt.
 * - Never throws — failures are captured in `result.failed`.
 */
export async function registerWebhooksOnInstall(
  shop: string,
  accessToken: string,
  appUrl: string
): Promise<RegistrationResult> {
  const start = Date.now();
  const result: RegistrationResult = {
    shop,
    registered: [],
    skipped: [],
    failed: [],
  };

  log({ shop, step: "webhook.register.start", status: "info" });

  // Fetch already-registered topics to avoid duplicates
  let existingTopics: Set<string>;
  try {
    const existing = await listRegisteredWebhooks(shop, accessToken);
    existingTopics = new Set(existing.map((w) => w.topic));
  } catch (err) {
    log({
      shop,
      step: "webhook.register.list_failed",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    existingTopics = new Set();
  }

  // Register each required topic
  for (const topic of REQUIRED_WEBHOOK_TOPICS) {
    // Shopify uses underscore-separated topic names in GraphQL enum
    // but returns them in the same format — check membership directly
    if (existingTopics.has(topic)) {
      result.skipped.push(topic);
      continue;
    }

    const callbackUrl = buildCallbackUrl(appUrl, topic);

    try {
      await registerWebhook(shop, accessToken, topic, callbackUrl);
      result.registered.push(topic);
      log({ shop, step: "webhook.register.ok", status: "ok", topic });
    } catch (err) {
      result.failed.push(topic);
      log({
        shop,
        step: "webhook.register.failed",
        status: "error",
        topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log({
    shop,
    step: "webhook.register.complete",
    status: "ok",
    durationMs: Date.now() - start,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Daily audit cron
// ---------------------------------------------------------------------------

/**
 * Audits webhook registrations for a single merchant.
 * Re-registers any missing topics.
 */
export async function auditMerchantWebhooks(
  shop: string,
  accessToken: string,
  appUrl: string
): Promise<AuditResult> {
  const result: AuditResult = {
    shop,
    missing: [],
    reregistered: [],
    failed: [],
  };

  let existing: RegisteredWebhook[];
  try {
    existing = await listRegisteredWebhooks(shop, accessToken);
  } catch (err) {
    log({
      shop,
      step: "webhook.audit.list_failed",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    // Cannot audit without list — treat all as missing for retry
    result.missing = [...REQUIRED_WEBHOOK_TOPICS];
    result.failed = [...REQUIRED_WEBHOOK_TOPICS];
    return result;
  }

  const registeredTopics = new Set(existing.map((w) => w.topic));

  for (const topic of REQUIRED_WEBHOOK_TOPICS) {
    if (!registeredTopics.has(topic)) {
      result.missing.push(topic);

      const callbackUrl = buildCallbackUrl(appUrl, topic);
      try {
        await registerWebhook(shop, accessToken, topic, callbackUrl);
        result.reregistered.push(topic);
        log({
          shop,
          step: "webhook.audit.reregistered",
          status: "ok",
          topic,
        });
      } catch (err) {
        result.failed.push(topic);
        log({
          shop,
          step: "webhook.audit.reregister_failed",
          status: "error",
          topic,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  log({
    shop,
    step: "webhook.audit.result",
    status: result.failed.length > 0 ? "warn" : "ok",
    missing: result.missing,
    reregistered: result.reregistered,
    failedTopics: result.failed,
  });

  return result;
}

// ---------------------------------------------------------------------------
// PR-038: Analytics Engine + KV observability helpers
// ---------------------------------------------------------------------------

/** Shape of the webhook health snapshot stored in KV. */
export interface WebhookHealthSnapshot {
  shop: string;
  missingCount: number;
  reregisteredCount: number;
  auditSuccess: boolean;
  /** ISO-8601 timestamp of the last audit run */
  lastAuditAt: string;
}

/**
 * Emits a per-merchant audit data point to Analytics Engine.
 *
 * Index:   shop
 * Blobs:   [shop, auditSuccess]
 * Doubles: [missingCount, reregisteredCount, auditSuccessNumeric]
 */
export function emitWebhookAuditMetric(
  ae: AnalyticsEngineDataset,
  shop: string,
  missingCount: number,
  reregisteredCount: number,
  auditSuccess: boolean
): void {
  try {
    ae.writeDataPoint({
      indexes: [shop],
      blobs: [shop, String(auditSuccess)],
      doubles: [missingCount, reregisteredCount, auditSuccess ? 1 : 0],
    });
  } catch {
    // Best-effort — never break the cron
  }
}

/**
 * Persists a webhook health snapshot to KV for later surfacing via
 * `/internal/metrics`.
 *
 * Key: `webhook-health:{shop}`
 * TTL: 48 hours (refreshed on every audit run)
 */
export async function storeWebhookHealthSnapshot(
  kv: KVNamespace,
  snapshot: WebhookHealthSnapshot
): Promise<void> {
  try {
    await kv.put(
      `webhook-health:${snapshot.shop}`,
      JSON.stringify(snapshot),
      { expirationTtl: 60 * 60 * 48 }
    );
  } catch {
    // Best-effort
  }
}

/**
 * Scheduled cron handler: `0 9 * * *`
 *
 * Fetches all active merchants from D1, audits each one's webhook
 * registrations, re-registers missing webhooks, and alerts if >3 shops
 * have re-registration failures.
 *
 * PR-038 enhancements:
 *  - Emits per-shop data points to Analytics Engine (AE_METRICS)
 *  - Stores webhook health snapshots in KV (KV_STORE)
 *  - Fires a Sentry alert when >3 shops have re-registration failures (SENTRY)
 */
export async function runWebhookAuditCron(
  env: WebhookRegistrationEnv
): Promise<void> {
  const start = Date.now();

  log({ shop: "system", step: "cron.webhook_audit.start", status: "info" });

  // Fetch all active merchants (those with a non-null access_token)
  let merchants: Array<{ shop: string; access_token: string }> = [];

  try {
    const result = await env.DB.prepare(
      `SELECT shop, access_token FROM merchants WHERE access_token IS NOT NULL`
    ).all<{ shop: string; access_token: string }>();
    merchants = result.results ?? [];
  } catch (err) {
    log({
      shop: "system",
      step: "cron.webhook_audit.db_error",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  let failedShops = 0;
  const auditResults: AuditResult[] = [];
  const auditedAt = new Date().toISOString();

  for (const merchant of merchants) {
    const auditResult = await auditMerchantWebhooks(
      merchant.shop,
      merchant.access_token,
      env.APP_URL
    );
    auditResults.push(auditResult);

    const auditSuccess = auditResult.failed.length === 0;
    if (!auditSuccess) {
      failedShops++;
    }

    // PR-038: emit per-shop data point to Analytics Engine
    if (env.AE_METRICS) {
      emitWebhookAuditMetric(
        env.AE_METRICS,
        merchant.shop,
        auditResult.missing.length,
        auditResult.reregistered.length,
        auditSuccess
      );
    }

    // PR-038: persist webhook health snapshot to KV
    if (env.KV_STORE) {
      await storeWebhookHealthSnapshot(env.KV_STORE, {
        shop: merchant.shop,
        missingCount: auditResult.missing.length,
        reregisteredCount: auditResult.reregistered.length,
        auditSuccess,
        lastAuditAt: auditedAt,
      });
    }
  }

  // Alert threshold: re-registration failed for >3 shops
  if (failedShops > 3) {
    const alertMessage = `Webhook re-registration failed for ${failedShops} shops — investigate immediately`;

    log({
      shop: "system",
      step: "cron.webhook_audit.alert",
      status: "error",
      failedShops,
      message: alertMessage,
    });

    // PR-038: fire Sentry alert when Sentry client is available
    if (env.SENTRY) {
      env.SENTRY.captureMessage(alertMessage, "error", {
        step: "cron.webhook_audit.alert",
        failedShops,
        merchantsAudited: merchants.length,
      } as Record<string, unknown>);
    }
  }

  log({
    shop: "system",
    step: "cron.webhook_audit.complete",
    status: "ok",
    merchantsAudited: merchants.length,
    failedShops,
    durationMs: Date.now() - start,
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Builds the webhook callback URL for a given topic.
 * Topic is converted from SCREAMING_SNAKE_CASE to kebab-case for the URL path.
 * e.g. PRODUCTS_CREATE → /webhooks/products/create
 */
export function buildCallbackUrl(
  appUrl: string,
  topic: WebhookRegistrationTopic
): string {
  // Remove trailing slash from appUrl
  const base = appUrl.replace(/\/$/, "");
  // Convert PRODUCTS_CREATE → products/create
  const path = topic.toLowerCase().replace(/_/g, "/");
  return `${base}/webhooks/${path}`;
}
