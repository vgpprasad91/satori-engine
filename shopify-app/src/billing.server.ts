/**
 * PR-010: Shopify billing API — subscription creation and plan management
 *
 * Implements three plans:
 *  - Hobby:   100 images/month,  $0   (free)
 *  - Pro:     1,000 images/month, $29/month
 *  - Business: 10,000 images/month, $79/month
 *
 * Creates Shopify AppSubscription via GraphQL billing API.
 * Handles subscription approval callback.
 * Stores plan and billing_status in D1.
 * Implements capped usage-based overage charges.
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

export type PlanName = "hobby" | "pro" | "business";

export interface Plan {
  name: PlanName;
  monthlyLimit: number;
  /** Monthly price in USD. 0 = free. */
  price: number;
  /** Max overage charge cap per month in USD. null = no overage. */
  cappedAmount: number | null;
  /** Price per overage image in USD. null = no overage. */
  overagePerImage: number | null;
}

export const PLANS: Record<PlanName, Plan> = {
  hobby: {
    name: "hobby",
    monthlyLimit: 100,
    price: 0,
    cappedAmount: null,
    overagePerImage: null,
  },
  pro: {
    name: "pro",
    monthlyLimit: 1_000,
    price: 29,
    cappedAmount: 50,
    overagePerImage: 0.05,
  },
  business: {
    name: "business",
    monthlyLimit: 10_000,
    price: 79,
    cappedAmount: 100,
    overagePerImage: 0.01,
  },
};

export const SHOPIFY_API_VERSION = "2025-01";

// ---------------------------------------------------------------------------
// GraphQL mutations
// ---------------------------------------------------------------------------

const CREATE_SUBSCRIPTION_MUTATION = /* graphql */ `
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: String!
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      test: $test
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const CREATE_USAGE_RECORD_MUTATION = /* graphql */ `
  mutation AppUsageRecordCreate(
    $subscriptionLineItemId: ID!
    $price: MoneyInput!
    $description: String!
  ) {
    appUsageRecordCreate(
      subscriptionLineItemId: $subscriptionLineItemId
      price: $price
      description: $description
    ) {
      appUsageRecord {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = /* graphql */ `
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_ACTIVE_SUBSCRIPTION_QUERY = /* graphql */ `
  query GetActiveSubscription {
    appInstallation {
      activeSubscriptions {
        id
        status
        name
        lineItems {
          id
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
              }
              ... on AppUsagePricing {
                cappedAmount {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Shopify GraphQL client
// ---------------------------------------------------------------------------

export async function shopifyBillingGraphQL<T = unknown>(
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
    throw new Error(`Shopify billing GraphQL failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      `Shopify billing GraphQL error: ${json.errors[0]?.message ?? "Unknown"}`
    );
  }

  return json.data as T;
}

// ---------------------------------------------------------------------------
// Subscription creation
// ---------------------------------------------------------------------------

export interface CreateSubscriptionResult {
  subscriptionId: string;
  confirmationUrl: string;
  status: string;
}

/**
 * Creates a Shopify AppSubscription for the given plan.
 * Returns the confirmation URL the merchant must visit to approve.
 *
 * For free (Hobby) plan: stores plan directly without Shopify billing API call.
 */
export async function createSubscription(
  shop: string,
  accessToken: string,
  planName: PlanName,
  returnUrl: string,
  opts: { test?: boolean } = {}
): Promise<CreateSubscriptionResult> {
  const plan = PLANS[planName];

  // Free plan — no Shopify billing call needed
  if (plan.price === 0) {
    return {
      subscriptionId: "free",
      confirmationUrl: returnUrl,
      status: "ACTIVE",
    };
  }

  const lineItems: unknown[] = [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: plan.price, currencyCode: "USD" },
          interval: "EVERY_30_DAYS",
        },
      },
    },
  ];

  // Add usage-based pricing line item for overage if applicable
  if (plan.cappedAmount !== null) {
    lineItems.push({
      plan: {
        appUsagePricingDetails: {
          cappedAmount: { amount: plan.cappedAmount, currencyCode: "USD" },
          terms: `$${plan.overagePerImage} per image above ${plan.monthlyLimit} monthly limit`,
        },
      },
    });
  }

  type SubscriptionData = {
    appSubscriptionCreate: {
      appSubscription: { id: string; status: string } | null;
      confirmationUrl: string | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  };

  const data = await shopifyBillingGraphQL<SubscriptionData>(
    shop,
    accessToken,
    CREATE_SUBSCRIPTION_MUTATION,
    {
      name: `MailCraft ${plan.name.charAt(0).toUpperCase() + plan.name.slice(1)}`,
      lineItems,
      returnUrl,
      test: opts.test ?? false,
    }
  );

  const result = data.appSubscriptionCreate;

  if (result.userErrors.length > 0) {
    throw new Error(
      `Subscription creation error: ${result.userErrors[0]?.message ?? "Unknown"}`
    );
  }

  if (!result.appSubscription || !result.confirmationUrl) {
    throw new Error("Missing subscription data in Shopify response");
  }

  return {
    subscriptionId: result.appSubscription.id,
    confirmationUrl: result.confirmationUrl,
    status: result.appSubscription.status,
  };
}

// ---------------------------------------------------------------------------
// Approval callback
// ---------------------------------------------------------------------------

export interface ApprovalCallbackResult {
  shop: string;
  plan: PlanName;
  subscriptionId: string;
  billingStatus: string;
}

/**
 * Called when Shopify redirects the merchant back after billing approval.
 *
 * Validates the charge_id query param, fetches active subscription from
 * Shopify, stores plan + billing_status in D1.
 */
export async function handleApprovalCallback(
  shop: string,
  accessToken: string,
  planName: PlanName,
  subscriptionId: string,
  db: D1Database
): Promise<ApprovalCallbackResult> {
  const start = Date.now();

  try {
    let billingStatus = "active";

    // For paid plans, verify via Shopify
    if (PLANS[planName].price > 0) {
      type ActiveSubData = {
        appInstallation: {
          activeSubscriptions: Array<{ id: string; status: string }>;
        };
      };

      const data = await shopifyBillingGraphQL<ActiveSubData>(
        shop,
        accessToken,
        GET_ACTIVE_SUBSCRIPTION_QUERY
      );

      const activeSubs = data.appInstallation.activeSubscriptions ?? [];
      const match = activeSubs.find((s) => s.id === subscriptionId);

      if (!match) {
        throw new Error(
          `Subscription ${subscriptionId} not found in active subscriptions`
        );
      }

      billingStatus =
        match.status === "ACTIVE" ? "active" : match.status.toLowerCase();
    }

    const plan = PLANS[planName];

    await db
      .prepare(
        `UPDATE merchants
           SET plan = ?, billing_status = ?, monthly_limit = ?
         WHERE shop = ?`
      )
      .bind(planName, billingStatus, plan.monthlyLimit, shop)
      .run();

    log({
      shop,
      step: "billing.approvalCallback",
      status: "ok",
      durationMs: Date.now() - start,
    });

    return {
      shop,
      plan: planName,
      subscriptionId,
      billingStatus,
    };
  } catch (err) {
    log({
      shop,
      step: "billing.approvalCallback",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Usage-based overage charge
// ---------------------------------------------------------------------------

export interface OverageChargeResult {
  usageRecordId: string;
  imagesCharged: number;
  amountCharged: number;
}

/**
 * Creates a usage-based charge record for overage images.
 *
 * Called when a merchant exceeds their monthly limit on a paid plan
 * with overage enabled (Pro, Business).
 *
 * @param subscriptionLineItemId - The usage line item ID from Shopify subscription
 * @param imagesOverLimit - Number of images above the monthly limit
 */
export async function chargeOverage(
  shop: string,
  accessToken: string,
  subscriptionLineItemId: string,
  planName: PlanName,
  imagesOverLimit: number
): Promise<OverageChargeResult> {
  const plan = PLANS[planName];

  if (plan.overagePerImage === null || plan.cappedAmount === null) {
    throw new Error(`Plan "${planName}" does not support overage charges`);
  }

  const amount = Math.min(
    imagesOverLimit * plan.overagePerImage,
    plan.cappedAmount
  );
  const roundedAmount = Math.round(amount * 100) / 100;

  type UsageRecordData = {
    appUsageRecordCreate: {
      appUsageRecord: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  };

  const data = await shopifyBillingGraphQL<UsageRecordData>(
    shop,
    accessToken,
    CREATE_USAGE_RECORD_MUTATION,
    {
      subscriptionLineItemId,
      price: { amount: roundedAmount, currencyCode: "USD" },
      description: `${imagesOverLimit} overage images at $${plan.overagePerImage}/image`,
    }
  );

  const result = data.appUsageRecordCreate;

  if (result.userErrors.length > 0) {
    throw new Error(
      `Overage charge error: ${result.userErrors[0]?.message ?? "Unknown"}`
    );
  }

  if (!result.appUsageRecord) {
    throw new Error("Missing usage record in Shopify response");
  }

  log({
    shop,
    step: "billing.overageCharge",
    status: "ok",
  });

  return {
    usageRecordId: result.appUsageRecord.id,
    imagesCharged: imagesOverLimit,
    amountCharged: roundedAmount,
  };
}

// ---------------------------------------------------------------------------
// Cancel subscription
// ---------------------------------------------------------------------------

/**
 * Cancels an active Shopify subscription. Called on app uninstall.
 */
export async function cancelSubscription(
  shop: string,
  accessToken: string,
  subscriptionId: string
): Promise<void> {
  if (subscriptionId === "free") return;

  type CancelData = {
    appSubscriptionCancel: {
      appSubscription: { id: string; status: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  };

  const data = await shopifyBillingGraphQL<CancelData>(
    shop,
    accessToken,
    CANCEL_SUBSCRIPTION_MUTATION,
    { id: subscriptionId }
  );

  const result = data.appSubscriptionCancel;

  if (result.userErrors.length > 0) {
    throw new Error(
      `Subscription cancel error: ${result.userErrors[0]?.message ?? "Unknown"}`
    );
  }

  log({
    shop,
    step: "billing.cancelSubscription",
    status: "ok",
  });
}

// ---------------------------------------------------------------------------
// Env interface
// ---------------------------------------------------------------------------

export interface BillingEnv {
  DB: D1Database;
}
