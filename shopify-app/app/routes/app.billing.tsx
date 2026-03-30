/**
 * PR-024: Billing and plan management UI
 *
 * - Current plan card: plan name, images used, images remaining, reset date
 * - Plan comparison table: Hobby / Pro / Business with limits, price, feature list
 * - Upgrade/downgrade flow via Shopify billing API (redirect to hosted confirmation)
 * - Usage progress bar with warning (≥80%) and critical (≥95%) states
 * - Overage explanation copy when capped usage charges apply
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, useNavigation, Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  ProgressBar,
  Button,
  Banner,
  DataTable,
  Divider,
  Icon,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";
import { PLANS, createSubscription } from "../../src/billing.server.js";
import type { PlanName } from "../../src/billing.server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BillingData {
  shop: string;
  plan: PlanName;
  billingStatus: string;
  monthlyLimit: number;
  usedThisMonth: number;
  resetDate: string;
}

interface ActionData {
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO string for the first of next month (UTC). */
function nextResetDate(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (
    context as {
      cloudflare: { env: ShopifyEnv & { DB: D1Database; SHOPIFY_KV: KVNamespace } };
    }
  ).cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) {
    return json<BillingData>({
      shop: "",
      plan: "hobby",
      billingStatus: "active",
      monthlyLimit: PLANS.hobby.monthlyLimit,
      usedThisMonth: 0,
      resetDate: nextResetDate(),
    });
  }

  let plan: PlanName = "hobby";
  let billingStatus = "active";
  let monthlyLimit = PLANS.hobby.monthlyLimit;

  try {
    const row = await env.DB.prepare(
      "SELECT plan, billing_status, monthly_limit FROM merchants WHERE shop = ?"
    )
      .bind(auth.shop)
      .first<{ plan: string; billing_status: string; monthly_limit: number }>();
    if (row) {
      plan = (row.plan as PlanName) ?? "hobby";
      billingStatus = row.billing_status ?? "active";
      monthlyLimit = row.monthly_limit ?? PLANS.hobby.monthlyLimit;
    }
  } catch {
    // DB unavailable in local dev
  }

  let usedThisMonth = 0;
  try {
    const ym = new Date().toISOString().slice(0, 7);
    const val = await env.SHOPIFY_KV.get(`usage:${auth.shop}:${ym}`);
    usedThisMonth = val ? parseInt(val, 10) : 0;
  } catch {
    // KV unavailable in local dev
  }

  return json<BillingData>({
    shop: auth.shop,
    plan,
    billingStatus,
    monthlyLimit,
    usedThisMonth,
    resetDate: nextResetDate(),
  });
}

// ---------------------------------------------------------------------------
// Action — upgrade / downgrade
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const env = (
    context as {
      cloudflare: { env: ShopifyEnv & { DB: D1Database; SHOPIFY_KV: KVNamespace } };
    }
  ).cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) {
    return json<ActionData>({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const targetPlan = formData.get("plan") as PlanName | null;

  if (!targetPlan || !PLANS[targetPlan]) {
    return json<ActionData>({ error: "Invalid plan selected" }, { status: 400 });
  }

  try {
    const returnUrl = new URL(request.url);
    returnUrl.pathname = "/app/billing";
    returnUrl.searchParams.set("plan", targetPlan);
    returnUrl.searchParams.set("shop", auth.shop);

    const result = await createSubscription(
      auth.shop,
      auth.session.access_token,
      targetPlan,
      returnUrl.toString(),
      { test: false }
    );

    // Free plan — confirm immediately, redirect back to billing
    if (result.confirmationUrl === returnUrl.toString()) {
      // Update D1 for free (hobby) plan
      try {
        await env.DB.prepare(
          "UPDATE merchants SET plan = ?, billing_status = ?, monthly_limit = ? WHERE shop = ?"
        )
          .bind(targetPlan, "active", PLANS[targetPlan].monthlyLimit, auth.shop)
          .run();
      } catch {
        // DB unavailable in local dev
      }
      return redirect("/app/billing?upgraded=1");
    }

    // Paid plan — redirect to Shopify's hosted billing confirmation
    return redirect(result.confirmationUrl);
  } catch (err) {
    return json<ActionData>(
      { error: err instanceof Error ? err.message : "Failed to create subscription" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Plan features for comparison table
// ---------------------------------------------------------------------------

const PLAN_FEATURES: Record<PlanName, string[]> = {
  hobby: [
    "100 images / month",
    "1 brand kit",
    "8 templates",
    "Standard background removal",
    "Community support",
  ],
  pro: [
    "1,000 images / month",
    "3 brand kits",
    "All templates",
    "Priority background removal",
    "Overage: $0.05 / image (capped at $50)",
    "Email support",
  ],
  business: [
    "10,000 images / month",
    "Unlimited brand kits",
    "All templates + custom",
    "Priority background removal",
    "Overage: $0.01 / image (capped at $100)",
    "Priority support",
    "Analytics dashboard",
  ],
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BillingRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const imagesRemaining = Math.max(0, data.monthlyLimit - data.usedThisMonth);
  const usagePercent =
    data.monthlyLimit > 0
      ? Math.min(100, Math.round((data.usedThisMonth / data.monthlyLimit) * 100))
      : 0;

  const isWarning = usagePercent >= 80 && usagePercent < 95;
  const isCritical = usagePercent >= 95;

  const planLabel: Record<PlanName, string> = {
    hobby: "Hobby",
    pro: "Pro",
    business: "Business",
  };

  const currentPlan = PLANS[data.plan];
  const hasOverage =
    currentPlan.cappedAmount !== null && currentPlan.overagePerImage !== null;

  return (
    <Page
      title="Billing"
      subtitle="Manage your subscription and usage"
    >
      <Layout>
        {/* Error banner */}
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Subscription error">
              <Text as="p">{actionData.error}</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Current plan card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  Current plan
                </Text>
                <Badge
                  tone={data.billingStatus === "active" ? "success" : "attention"}
                  aria-label={`Billing status: ${data.billingStatus}`}
                >
                  {data.billingStatus}
                </Badge>
              </InlineStack>

              <InlineStack gap="300" blockAlign="baseline">
                <Text variant="headingXl" as="p" aria-label={`Plan: ${planLabel[data.plan]}`}>
                  {planLabel[data.plan]}
                </Text>
                <Text as="p" tone="subdued">
                  {currentPlan.price === 0
                    ? "Free"
                    : `$${currentPlan.price} / month`}
                </Text>
              </InlineStack>

              <Divider />

              {/* Usage stats row */}
              <InlineStack gap="600" wrap={false}>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Used this month
                  </Text>
                  <Text as="p" variant="headingMd" aria-label={`${data.usedThisMonth} images used`}>
                    {data.usedThisMonth.toLocaleString()}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Remaining
                  </Text>
                  <Text
                    as="p"
                    variant="headingMd"
                    tone={isCritical ? "critical" : isWarning ? "caution" : undefined}
                    aria-label={`${imagesRemaining} images remaining`}
                  >
                    {imagesRemaining.toLocaleString()}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Resets on
                  </Text>
                  <Text as="p" variant="headingMd">
                    {data.resetDate}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Monthly limit
                  </Text>
                  <Text as="p" variant="headingMd">
                    {data.monthlyLimit.toLocaleString()}
                  </Text>
                </BlockStack>
              </InlineStack>

              {/* Usage progress bar */}
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodySm">
                    Usage
                  </Text>
                  <Text as="p" variant="bodySm" tone={isCritical ? "critical" : isWarning ? "caution" : undefined}>
                    {usagePercent}%
                  </Text>
                </InlineStack>
                <div
                  role="progressbar"
                  aria-valuenow={usagePercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Monthly usage: ${usagePercent}% of ${data.monthlyLimit.toLocaleString()} images`}
                >
                  <ProgressBar
                    progress={usagePercent}
                    tone={isCritical ? "critical" : isWarning ? "highlight" : "success"}
                    size="medium"
                  />
                </div>
              </BlockStack>

              {/* Warning banners */}
              {isCritical && (
                <Banner tone="critical" title="Image generation limit reached">
                  <Text as="p">
                    You&apos;ve used {data.usedThisMonth.toLocaleString()} of{" "}
                    {data.monthlyLimit.toLocaleString()} images this month. New
                    image generations are paused. Upgrade your plan to resume.
                  </Text>
                </Banner>
              )}
              {isWarning && !isCritical && (
                <Banner tone="warning" title="Approaching monthly limit">
                  <Text as="p">
                    You&apos;ve used {usagePercent}% of your {data.monthlyLimit.toLocaleString()}{" "}
                    monthly images. Upgrade to avoid interruption when you reach
                    your limit.
                  </Text>
                </Banner>
              )}

              {/* Overage explanation */}
              {hasOverage && (
                <Banner tone="info" title="Overage charges">
                  <Text as="p">
                    If you exceed your {data.monthlyLimit.toLocaleString()} monthly image limit,
                    additional images are charged at{" "}
                    <strong>${currentPlan.overagePerImage}</strong> per image, capped at{" "}
                    <strong>${currentPlan.cappedAmount}</strong> per month. Overage charges
                    appear on your next Shopify invoice.
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Plan comparison table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Compare plans
              </Text>

              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={["", "Hobby", "Pro", "Business"]}
                rows={[
                  [
                    "Price",
                    "Free",
                    "$29 / month",
                    "$79 / month",
                  ],
                  [
                    "Images / month",
                    "100",
                    "1,000",
                    "10,000",
                  ],
                  [
                    "Overage",
                    "—",
                    "$0.05 / image (cap $50)",
                    "$0.01 / image (cap $100)",
                  ],
                  [
                    "Brand kits",
                    "1",
                    "3",
                    "Unlimited",
                  ],
                  [
                    "Templates",
                    "8",
                    "All templates",
                    "All templates + custom",
                  ],
                  [
                    "Background removal",
                    "Standard",
                    "Priority",
                    "Priority",
                  ],
                  [
                    "Support",
                    "Community",
                    "Email",
                    "Priority",
                  ],
                  [
                    "Analytics",
                    "—",
                    "—",
                    "✓",
                  ],
                ]}
                aria-label="Plan comparison table"
              />

              {/* Plan action cards */}
              <InlineStack gap="400" wrap={false} align="start">
                {(["hobby", "pro", "business"] as PlanName[]).map((planName) => {
                  const planInfo = PLANS[planName];
                  const isCurrent = data.plan === planName;
                  const isUpgrade =
                    (data.plan === "hobby" && (planName === "pro" || planName === "business")) ||
                    (data.plan === "pro" && planName === "business");
                  const isDowngrade =
                    (data.plan === "business" && (planName === "pro" || planName === "hobby")) ||
                    (data.plan === "pro" && planName === "hobby");

                  return (
                    <div
                      key={planName}
                      style={{ flex: 1, minWidth: 0 }}
                      aria-label={`${planLabel[planName]} plan card`}
                    >
                      <Card background={isCurrent ? "bg-surface-selected" : "bg-surface"}>
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text variant="headingSm" as="h3">
                              {planLabel[planName]}
                            </Text>
                            {isCurrent && (
                              <Badge tone="success" aria-label="Current plan">
                                Current
                              </Badge>
                            )}
                          </InlineStack>

                          <Text variant="headingLg" as="p">
                            {planInfo.price === 0
                              ? "Free"
                              : `$${planInfo.price}/mo`}
                          </Text>

                          <Text as="p" tone="subdued" variant="bodySm">
                            {planInfo.monthlyLimit.toLocaleString()} images / month
                          </Text>

                          <BlockStack gap="200">
                            {PLAN_FEATURES[planName].map((feature) => (
                              <InlineStack key={feature} gap="200" blockAlign="start">
                                <Icon source={CheckIcon} tone="success" />
                                <Text as="p" variant="bodySm">
                                  {feature}
                                </Text>
                              </InlineStack>
                            ))}
                          </BlockStack>

                          {!isCurrent && (
                            <Form method="post">
                              <input type="hidden" name="plan" value={planName} />
                              <Button
                                submit
                                variant={isUpgrade ? "primary" : "secondary"}
                                disabled={isSubmitting}
                                accessibilityLabel={
                                  isUpgrade
                                    ? `Upgrade to ${planLabel[planName]}`
                                    : `Downgrade to ${planLabel[planName]}`
                                }
                                aria-label={
                                  isUpgrade
                                    ? `Upgrade to ${planLabel[planName]} plan`
                                    : `Downgrade to ${planLabel[planName]} plan`
                                }
                              >
                                {isSubmitting
                                  ? "Processing…"
                                  : isUpgrade
                                  ? `Upgrade to ${planLabel[planName]}`
                                  : isDowngrade
                                  ? `Downgrade to ${planLabel[planName]}`
                                  : `Select ${planLabel[planName]}`}
                              </Button>
                            </Form>
                          )}

                          {isCurrent && (
                            <Text as="p" tone="subdued" variant="bodySm">
                              Your current plan
                            </Text>
                          )}
                        </BlockStack>
                      </Card>
                    </div>
                  );
                })}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Billing notes */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" as="h3">
                Billing notes
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Upgrades take effect immediately. Downgrades take effect at the
                start of your next billing cycle. All charges are processed by
                Shopify and appear on your Shopify invoice.
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Image counts reset on the first of each calendar month (UTC).
                Unused images do not roll over.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Skeleton (used by route-level Suspense / loading state in app shell)
// ---------------------------------------------------------------------------

export function BillingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading billing information"
      aria-live="polite"
    >
      <Page title="Billing">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={6} />
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={10} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
