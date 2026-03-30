/**
 * PR-042: Format variants picker for a single product
 *
 * Route: /app/products/:productId/formats
 *
 * Displays the 5 format variants (square, story, landscape, og_image, banner)
 * for a product with:
 *  - Status badge per format
 *  - Preview thumbnail (when generated)
 *  - Download button (when generated)
 *  - Copy link button (when generated)
 *  - Per-format Regenerate button
 *  - "Generate all" button to enqueue all 5 formats simultaneously
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Grid,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Button,
  Thumbnail,
  Banner,
  Toast,
  Frame,
  Box,
  Divider,
  SkeletonBodyText,
  SkeletonDisplayText,
  Spinner,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";
import {
  getFormatVariants,
  enqueueFormatVariants,
  buildDownloadUrl,
  buildCopyLinkUrl,
  computeFormatVariantStats,
  FORMAT_VARIANTS,
  ALL_FORMAT_VARIANTS,
} from "../../src/format-variants.server.js";
import type {
  FormatVariantRow,
  FormatVariant,
  FormatVariantsEnv,
} from "../../src/format-variants.server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoaderData {
  shop: string;
  productId: string;
  productTitle: string;
  baseTemplateId: string;
  variants: FormatVariantRow[];
  stats: {
    total: number;
    generated: number;
    pending: number;
    failed: number;
    not_generated: number;
  };
}

interface ActionData {
  success: boolean;
  enqueued?: FormatVariant[];
  skipped?: FormatVariant[];
  errors?: { format: FormatVariant; error: string }[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv & FormatVariantsEnv } })
    .cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) {
    return json<LoaderData>({
      shop: "",
      productId: params.productId ?? "",
      productTitle: "",
      baseTemplateId: "",
      variants: [],
      stats: { total: 0, generated: 0, pending: 0, failed: 0, not_generated: 0 },
    });
  }

  const productId = params.productId ?? "";
  const url = new URL(request.url);
  const baseTemplateId = url.searchParams.get("templateId") ?? "product-card";

  // Fetch product title from D1
  const product = await env.DB.prepare(
    `SELECT title FROM products WHERE shop = ? AND id = ? LIMIT 1`
  )
    .bind(auth.shop, productId)
    .first<{ title: string }>();

  const variants = await getFormatVariants(auth.shop, productId, baseTemplateId, env);
  const stats = computeFormatVariantStats(variants);

  return json<LoaderData>({
    shop: auth.shop,
    productId,
    productTitle: product?.title ?? productId,
    baseTemplateId,
    variants,
    stats,
  });
}

// ---------------------------------------------------------------------------
// Action (enqueue selected or all formats)
// ---------------------------------------------------------------------------

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv & FormatVariantsEnv } })
    .cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) return json<ActionData>({ success: false, error: "Unauthorized" }, { status: 401 });

  const productId = params.productId ?? "";
  const body = await request.formData();

  const baseTemplateId = body.get("baseTemplateId")?.toString() ?? "product-card";
  const rawFormats = body.getAll("format").map(String) as FormatVariant[];
  const formats: FormatVariant[] =
    rawFormats.length > 0
      ? rawFormats.filter((f) => ALL_FORMAT_VARIANTS.includes(f))
      : ALL_FORMAT_VARIANTS;

  // Fetch product details from D1
  const product = await env.DB.prepare(
    `SELECT p.title, p.image_url, m.locale, m.currency_format
     FROM products p
     JOIN merchants m ON m.shop = p.shop
     WHERE p.shop = ? AND p.id = ?
     LIMIT 1`
  )
    .bind(auth.shop, productId)
    .first<{ title: string; image_url: string | null; locale: string | null; currency_format: string | null }>();

  if (!product) {
    return json<ActionData>({ success: false, error: "Product not found" }, { status: 404 });
  }

  // Fetch brand kit from KV
  const brandKitRaw = await env.KV_STORE.get(`brandkit:${auth.shop}`, "json") as {
    primaryColor?: string;
    logoR2Key?: string;
    fontFamily?: string;
  } | null;

  const brandKit = {
    primaryColor: brandKitRaw?.primaryColor ?? "#1a73e8",
    logoR2Key: brandKitRaw?.logoR2Key ?? null,
    fontFamily: brandKitRaw?.fontFamily ?? null,
  };

  const result = await enqueueFormatVariants(
    {
      shop: auth.shop,
      productId,
      productTitle: product.title,
      imageUrl: product.image_url ?? "",
      baseTemplateId,
      locale: product.locale ?? "en",
      currencyFormat: product.currency_format ?? "${{amount}}",
      brandKit,
    },
    formats,
    env
  );

  return json<ActionData>({
    success: true,
    enqueued: result.enqueued,
    skipped: result.skipped,
    errors: result.errors,
  });
}

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

type BadgeTone = "success" | "critical" | "warning" | "attention" | "info" | undefined;

function variantStatusBadge(status: string): { tone: BadgeTone; label: string } {
  switch (status) {
    case "success":
      return { tone: "success", label: "Generated" };
    case "pending":
      return { tone: "attention", label: "Pending" };
    case "failed":
    case "bg_removal_failed":
    case "compositing_failed":
    case "renderer_timeout":
    case "timed_out":
    case "unknown_error":
      return { tone: "critical", label: "Failed" };
    case "quota_exceeded":
      return { tone: "warning", label: "Quota exceeded" };
    case "not_generated":
    default:
      return { tone: undefined, label: "Not generated" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FormatVariantsRoute() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const navigate = useNavigate();

  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isSubmitting = fetcher.state === "submitting";

  function generateAll() {
    const form = new FormData();
    form.append("baseTemplateId", data.baseTemplateId);
    fetcher.submit(form, { method: "post" });
    setToastMessage("Generating all 5 format variants…");
    setToastActive(true);
  }

  function generateFormat(format: FormatVariant) {
    const form = new FormData();
    form.append("baseTemplateId", data.baseTemplateId);
    form.append("format", format);
    fetcher.submit(form, { method: "post" });
    setToastMessage(`Generating ${FORMAT_VARIANTS[format].label} variant…`);
    setToastActive(true);
  }

  async function copyLink(url: string, key: string) {
    try {
      const origin =
        typeof globalThis !== "undefined" &&
        "location" in globalThis &&
        (globalThis as unknown as { location: { origin: string } }).location?.origin
          ? (globalThis as unknown as { location: { origin: string } }).location.origin
          : "";
      await navigator.clipboard.writeText(`${origin}${url}`);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setToastMessage("Failed to copy link");
      setToastActive(true);
    }
  }

  const actionResult = fetcher.data;
  const hasErrors =
    actionResult?.errors && actionResult.errors.length > 0;

  const toastMarkup = toastActive ? (
    <Toast
      content={toastMessage}
      onDismiss={() => setToastActive(false)}
      duration={3000}
    />
  ) : null;

  return (
    <Frame>
      {toastMarkup}
      <Page
        title="Format variants"
        subtitle={`${data.productTitle} — ${data.stats.generated} of ${data.stats.total} generated`}
        backAction={{
          content: "Products",
          onAction: () => navigate("/app/products"),
          accessibilityLabel: "Back to Products",
        }}
        primaryAction={{
          content: isSubmitting ? "Generating…" : "Generate all formats",
          onAction: generateAll,
          loading: isSubmitting,
          disabled: isSubmitting,
          accessibilityLabel: "Generate all 5 format variants simultaneously",
        }}
      >
        <Layout>
          {/* Summary banner */}
          <Layout.Section>
            <Banner
              title={`${data.stats.generated} of ${data.stats.total} variants generated`}
              tone={
                data.stats.generated === data.stats.total
                  ? "success"
                  : data.stats.pending > 0
                  ? "info"
                  : "warning"
              }
            >
              <Text as="p">
                {data.stats.pending > 0 && `${data.stats.pending} pending. `}
                {data.stats.failed > 0 && `${data.stats.failed} failed. `}
                {data.stats.not_generated > 0 &&
                  `${data.stats.not_generated} not yet generated. `}
              </Text>
            </Banner>
          </Layout.Section>

          {/* Error feedback from last action */}
          {hasErrors && (
            <Layout.Section>
              <Banner title="Some variants failed to queue" tone="critical">
                {actionResult!.errors!.map((e) => (
                  <Text as="p" key={e.format}>
                    {FORMAT_VARIANTS[e.format]?.label ?? e.format}: {e.error}
                  </Text>
                ))}
              </Banner>
            </Layout.Section>
          )}

          {/* Format variant grid */}
          <Layout.Section>
            <Grid>
              {data.variants.map((variant) => {
                const meta = FORMAT_VARIANTS[variant.format];
                const { tone, label } = variantStatusBadge(variant.status);
                const downloadUrl = buildDownloadUrl(variant.r2_key, variant.format);
                const copyLinkUrl = buildCopyLinkUrl(variant.r2_key, variant.format);
                const isThisFormatSubmitting =
                  isSubmitting &&
                  (fetcher.formData?.get("format") === variant.format ||
                    !fetcher.formData?.get("format")); // "generate all"

                return (
                  <Grid.Cell
                    key={variant.format}
                    columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}
                  >
                    <Card>
                      <BlockStack gap="300">
                        {/* Header */}
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text variant="headingMd" as="h3">
                              {meta.label}
                            </Text>
                            <Text variant="bodySm" as="p" tone="subdued">
                              {meta.width}×{meta.height} · {meta.aspectRatio}
                            </Text>
                            <Text variant="bodySm" as="p" tone="subdued">
                              {meta.description}
                            </Text>
                          </BlockStack>
                          <Badge tone={tone}>{label}</Badge>
                        </InlineStack>

                        <Divider />

                        {/* Thumbnail / placeholder */}
                        <Box
                          minHeight="120px"
                          background="bg-surface-secondary"
                          borderRadius="200"
                          padding="200"
                        >
                          <InlineStack align="center" blockAlign="center">
                            {variant.status === "success" && variant.r2_key ? (
                              <Thumbnail
                                source={`/api/image/${encodeURIComponent(variant.r2_key)}`}
                                alt={`${meta.label} variant for ${data.productTitle}`}
                                size="large"
                              />
                            ) : variant.status === "pending" || isThisFormatSubmitting ? (
                              <BlockStack gap="200" inlineAlign="center">
                                <Spinner
                                  size="small"
                                  accessibilityLabel={`Generating ${meta.label} variant`}
                                />
                                <Text variant="bodySm" as="p" tone="subdued">
                                  Generating…
                                </Text>
                              </BlockStack>
                            ) : (
                              <BlockStack gap="200" inlineAlign="center">
                                <Thumbnail
                                  source={ImageIcon}
                                  alt={`No image for ${meta.label}`}
                                  size="medium"
                                />
                                <Text variant="bodySm" as="p" tone="subdued">
                                  Not generated
                                </Text>
                              </BlockStack>
                            )}
                          </InlineStack>
                        </Box>

                        {/* Error message */}
                        {variant.error_message && (
                          <Text variant="bodySm" as="p" tone="critical">
                            {variant.error_message.slice(0, 100)}
                          </Text>
                        )}

                        {/* Generated timestamp */}
                        {variant.generated_at && (
                          <Text variant="bodySm" as="p" tone="subdued">
                            Generated:{" "}
                            {new Intl.DateTimeFormat("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(variant.generated_at))}
                          </Text>
                        )}

                        {/* Actions */}
                        <BlockStack gap="200">
                          {/* Download button */}
                          {downloadUrl && (
                            <Button
                              url={downloadUrl}
                              download
                              fullWidth
                              accessibilityLabel={`Download ${meta.label} variant for ${data.productTitle}`}
                              aria-label={`Download ${meta.label} variant`}
                            >
                              Download {meta.label}
                            </Button>
                          )}

                          {/* Copy link button */}
                          {copyLinkUrl && (
                            <Button
                              fullWidth
                              onClick={() =>
                                copyLink(copyLinkUrl, `${variant.product_id}-${variant.format}`)
                              }
                              accessibilityLabel={`Copy link for ${meta.label} variant`}
                              aria-label={`Copy link for ${meta.label} variant`}
                            >
                              {copiedKey === `${variant.product_id}-${variant.format}`
                                ? "Copied!"
                                : "Copy link"}
                            </Button>
                          )}

                          {/* Regenerate / Generate button */}
                          <Button
                            size="slim"
                            variant="plain"
                            onClick={() => generateFormat(variant.format)}
                            loading={isThisFormatSubmitting}
                            disabled={isSubmitting}
                            accessibilityLabel={`${
                              variant.status === "not_generated" ? "Generate" : "Regenerate"
                            } ${meta.label} variant for ${data.productTitle}`}
                            aria-label={`${
                              variant.status === "not_generated" ? "Generate" : "Regenerate"
                            } ${meta.label}`}
                          >
                            {variant.status === "not_generated" ? "Generate" : "Regenerate"}
                          </Button>
                        </BlockStack>
                      </BlockStack>
                    </Card>
                  </Grid.Cell>
                );
              })}
            </Grid>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}

export function FormatVariantsSkeleton() {
  return (
    <div role="status" aria-label="Loading format variants" aria-live="polite">
      <Page title="Format variants">
        <Layout>
          <Layout.Section>
            <Grid>
              {Array.from({ length: 5 }).map((_, i) => (
                <Grid.Cell
                  key={i}
                  columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}
                >
                  <Card>
                    <BlockStack gap="300">
                      <SkeletonDisplayText size="small" />
                      <SkeletonBodyText lines={4} />
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              ))}
            </Grid>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
