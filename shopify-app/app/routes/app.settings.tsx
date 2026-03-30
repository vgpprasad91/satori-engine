/**
 * PR-020: Settings route — /app/settings
 *
 * Provides store settings and auto-retry toggle for failed image generation jobs.
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, useNavigation, Form } from "@remix-run/react";
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
  Checkbox,
  Banner,
  Button,
} from "@shopify/polaris";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";
import { useState } from "react";

interface SettingsData {
  shop: string;
  locale: string;
  currencyFormat: string;
  autoRetryEnabled: boolean;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv & { DB: D1Database; KV_STORE: KVNamespace } } })
    .cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) return json<SettingsData>({ shop: "", locale: "en", currencyFormat: "${{amount}}", autoRetryEnabled: false });

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

  // Load auto-retry preference from KV
  let autoRetryEnabled = false;
  try {
    const val = await env.KV_STORE.get(`settings:${auth.shop}:auto_retry`);
    autoRetryEnabled = val === "true";
  } catch {
    // KV unavailable in local dev
  }

  return json<SettingsData>({ shop: auth.shop, locale, currencyFormat, autoRetryEnabled });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv & { DB: D1Database; KV_STORE: KVNamespace } } })
    .cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) return json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const autoRetry = formData.get("auto_retry") === "on";

  await env.KV_STORE.put(`settings:${auth.shop}:auto_retry`, String(autoRetry));

  return json({ saved: true });
}

export default function SettingsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { saved?: boolean; error?: string } | undefined;
  const nav = useNavigation();
  const isSaving = nav.state === "submitting";

  const [autoRetry, setAutoRetry] = useState(data.autoRetryEnabled);

  return (
    <Page title="Settings" subtitle="Configure your app preferences">
      {actionData?.saved && (
        <Banner tone="success" title="Settings saved" />
      )}
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

        <Layout.Section>
          <Card>
            <Form method="post">
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2" aria-label="Image generation settings">
                  Image Generation
                </Text>
                <Checkbox
                  label="Auto-retry failed jobs"
                  helpText="Automatically retry failed image generation jobs up to 3 times with exponential backoff (30s, 60s, 120s)."
                  checked={autoRetry}
                  onChange={(checked) => setAutoRetry(checked)}
                  name="auto_retry"
                />
                <Button
                  variant="primary"
                  submit
                  loading={isSaving}
                  accessibilityLabel="Save settings"
                >
                  Save
                </Button>
              </BlockStack>
            </Form>
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
