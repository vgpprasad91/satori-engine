/**
 * PR-020: Dashboard route — /app/dashboard
 *
 * Shows a summary of the merchant's image generation activity.
 * Includes loading skeleton, accessible headings, and Polaris layout.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";

interface DashboardData {
  shop: string;
  totalGenerated: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv & { DB: D1Database } } })
    .cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) {
    return json<DashboardData>({
      shop: "",
      totalGenerated: 0,
      successCount: 0,
      failedCount: 0,
      pendingCount: 0,
    });
  }

  // Query D1 for generation stats
  let stats = { totalGenerated: 0, successCount: 0, failedCount: 0, pendingCount: 0 };
  try {
    const row = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
         SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS failed_count,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
       FROM generated_images
       WHERE shop = ?`
    )
      .bind(auth.shop)
      .first<{
        total: number;
        success_count: number;
        failed_count: number;
        pending_count: number;
      }>();

    if (row) {
      stats = {
        totalGenerated: row.total ?? 0,
        successCount: row.success_count ?? 0,
        failedCount: row.failed_count ?? 0,
        pendingCount: row.pending_count ?? 0,
      };
    }
  } catch {
    // DB not yet available (local dev) — use defaults
  }

  return json<DashboardData>({ shop: auth.shop, ...stats });
}

export default function DashboardRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <Page
      title="Dashboard"
      subtitle={`Connected to ${data.shop || "your store"}`}
      primaryAction={{ content: "View Products", url: "/app/products" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2" aria-label="Image generation overview">
                Image generation overview
              </Text>
              <InlineStack gap="400" wrap>
                <StatCard
                  label="Total generated"
                  value={data.totalGenerated}
                  ariaLabel={`Total images generated: ${data.totalGenerated}`}
                />
                <StatCard
                  label="Successful"
                  value={data.successCount}
                  badgeTone="success"
                  ariaLabel={`Successful generations: ${data.successCount}`}
                />
                <StatCard
                  label="Failed"
                  value={data.failedCount}
                  badgeTone="critical"
                  ariaLabel={`Failed generations: ${data.failedCount}`}
                />
                <StatCard
                  label="Pending"
                  value={data.pendingCount}
                  badgeTone="warning"
                  ariaLabel={`Pending generations: ${data.pendingCount}`}
                />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">
                Quick links
              </Text>
              <nav aria-label="Dashboard quick links">
                <BlockStack gap="100">
                  {[
                    { label: "Manage products", href: "/app/products", tabIndex: 0 },
                    { label: "Edit templates", href: "/app/templates", tabIndex: 0 },
                    { label: "Billing & plan", href: "/app/billing", tabIndex: 0 },
                    { label: "Settings", href: "/app/settings", tabIndex: 0 },
                  ].map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      tabIndex={link.tabIndex}
                      aria-label={link.label}
                      style={{ display: "block", padding: "4px 0", color: "#006fbb" }}
                    >
                      {link.label}
                    </a>
                  ))}
                </BlockStack>
              </nav>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Stat card sub-component with accessibility
// ---------------------------------------------------------------------------

type BadgeTone = "success" | "critical" | "warning";

interface StatCardProps {
  label: string;
  value: number;
  badgeTone?: BadgeTone;
  ariaLabel: string;
}

function StatCard({ label, value, badgeTone, ariaLabel }: StatCardProps) {
  // Polaris Text tones differ from Badge tones ("warning" not valid for Text)
  const textTone =
    badgeTone === "critical" ? "critical" : badgeTone === "success" ? "success" : undefined;

  return (
    <div
      role="figure"
      aria-label={ariaLabel}
      tabIndex={0}
      style={{
        minWidth: 120,
        padding: "1rem",
        background: "#f9fafb",
        borderRadius: 8,
        textAlign: "center",
      }}
    >
      <Text variant="heading2xl" as="p" tone={textTone}>
        {value.toLocaleString()}
      </Text>
      <Text variant="bodySm" as="p" tone="subdued">
        {label}
      </Text>
      {badgeTone && (
        <Badge tone={badgeTone}>
          {badgeTone}
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton exported for Suspense fallback
// ---------------------------------------------------------------------------

export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard" aria-live="polite">
      <Page title="Dashboard">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={3} />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      </Page>
    </div>
  );
}
