/**
 * PR-020: Settings route — /app/settings (stub for navigation)
 *
 * Full settings in a later PR.  Provides route, loading state, a11y shell.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  FormLayout,
  TextField,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";

interface SettingsData {
  shop: string;
  locale: string;
  currencyFormat: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv & { DB: D1Database } } })
    .cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) return json<SettingsData>({ shop: "", locale: "en", currencyFormat: "${{amount}}" });

  let locale = "en";
  let currencyFormat = "${{amount}}";
  try {
    const row = await env.DB.prepare(
      "SELECT locale, currency_format FROM merchants WHERE shop = ?"
    )
      .bind(auth.shop)
      .first<{ locale: string; currency_format: string }>();
    if (row) {
      locale = row.locale ?? "en";
      currencyFormat = row.currency_format ?? "${{amount}}";
    }
  } catch {
    // DB unavailable in local dev
  }

  return json<SettingsData>({ shop: auth.shop, locale, currencyFormat });
}

export default function SettingsRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <Page title="Settings" subtitle="Configure your app preferences">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2" aria-label="Store settings">
                Store settings
              </Text>
              <FormLayout>
                <TextField
                  label="Store domain"
                  value={data.shop}
                  disabled
                  autoComplete="off"
                  aria-label="Store domain (read-only)"
                  role="textbox"
                />
                <TextField
                  label="Locale"
                  value={data.locale}
                  disabled
                  autoComplete="off"
                  aria-label="Store locale (read-only)"
                  helpText="Locale is set by your Shopify store."
                  role="textbox"
                />
                <TextField
                  label="Currency format"
                  value={data.currencyFormat}
                  disabled
                  autoComplete="off"
                  aria-label="Currency format (read-only)"
                  helpText="Currency format is set by your Shopify store."
                  role="textbox"
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function SettingsSkeleton() {
  return (
    <div role="status" aria-label="Loading settings" aria-live="polite">
      <Page title="Settings">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={6} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
