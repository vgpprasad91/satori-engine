/**
 * PR-022: Products dashboard — image status grid
 *
 * Polaris ResourceList with:
 *  - Generated image thumbnail
 *  - Status badge (success/failed/pending/quota_exceeded/timed_out/…)
 *  - generated_at timestamp
 *  - Per-product Regenerate button → POST /api/regenerate/:productId
 *  - Bulk regenerate selected products
 *  - Filter by status, sort by generated_at
 *  - KV-cached product list for sub-200ms loads
 *  - Full keyboard navigation (arrow keys, Enter to open, R to regenerate)
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  useLoaderData,
  useFetcher,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Badge,
  Thumbnail,
  BlockStack,
  InlineStack,
  Button,
  Select,
  Filters,
  Toast,
  Frame,
  EmptyState,
  Spinner,
  Box,
  SkeletonBodyText,
  SkeletonDisplayText,
  Pagination,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";
import {
  listProducts,
  bulkRequeue,
  invalidateProductsCache,
} from "../../src/products.server.js";
import type {
  ProductWithImage,
  StatusFilter,
  SortField,
  SortDir,
  ProductsEnv,
} from "../../src/products.server.js";
import { useCallback, useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoaderData {
  shop: string;
  products: ProductWithImage[];
  statusFilter: StatusFilter;
  sortField: SortField;
  sortDir: SortDir;
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv & ProductsEnv } })
    .cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) {
    return json<LoaderData>({
      shop: "",
      products: [],
      statusFilter: "all",
      sortField: "generated_at",
      sortDir: "desc",
      total: 0,
      page: 1,
      pageSize: PAGE_SIZE,
    });
  }

  const url = new URL(request.url);
  const statusFilter = (url.searchParams.get("status") ?? "all") as StatusFilter;
  const sortField = (url.searchParams.get("sort") ?? "generated_at") as SortField;
  const sortDir = (url.searchParams.get("dir") ?? "desc") as SortDir;
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));

  const all = await listProducts(auth.shop, env, {
    statusFilter,
    sortField,
    sortDir,
  });

  const total = all.length;
  const start = (page - 1) * PAGE_SIZE;
  const products = all.slice(start, start + PAGE_SIZE);

  return json<LoaderData>({
    shop: auth.shop,
    products,
    statusFilter,
    sortField,
    sortDir,
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}

// ---------------------------------------------------------------------------
// Action (bulk regenerate)
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv & ProductsEnv } })
    .cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.formData();
  const intent = body.get("intent") as string | null;

  // Retry a single failed job — resets status to pending and re-queues
  if (intent === "retry") {
    const imageId = body.get("imageId") as string;
    if (!imageId) return json({ error: "Missing imageId" }, { status: 400 });

    await env.DB.prepare(
      `UPDATE generated_images SET status = 'pending', error_message = NULL, generated_at = datetime('now')
       WHERE id = ?1 AND shop = ?2 AND status IN ('failed', 'bg_removal_failed', 'renderer_timeout', 'render_error', 'compositing_failed', 'timed_out', 'unknown_error')`
    ).bind(imageId, auth.shop).run();

    // Re-queue the render task
    const row = await env.DB.prepare(
      `SELECT product_id, template_id FROM generated_images WHERE id = ?1 AND shop = ?2`
    ).bind(imageId, auth.shop).first<{ product_id: string; template_id: string }>();

    if (row) {
      await (env as unknown as { IMAGE_QUEUE: Queue }).IMAGE_QUEUE.send({
        shop: auth.shop,
        productId: row.product_id,
        templateId: row.template_id,
        imageId,
      });
    }

    await invalidateProductsCache(auth.shop, env);
    return json({ retried: true });
  }

  // Default: bulk regenerate
  const productIds = body.getAll("productId").map(String);

  if (productIds.length === 0) {
    return json({ error: "No product IDs provided" }, { status: 400 });
  }

  const result = await bulkRequeue(auth.shop, productIds, env);
  await invalidateProductsCache(auth.shop, env);

  return json({ queued: result.queued, skipped: result.skipped });
}

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

type BadgeTone =
  | "success"
  | "critical"
  | "warning"
  | "attention"
  | "info"
  | undefined;

/** Statuses that represent a failed/retryable job */
const RETRYABLE_STATUSES = new Set([
  "failed",
  "bg_removal_failed",
  "renderer_timeout",
  "render_error",
  "compositing_failed",
  "timed_out",
  "unknown_error",
]);

function isRetryable(status: string | null): boolean {
  return status !== null && RETRYABLE_STATUSES.has(status);
}

function statusBadge(status: string | null): { tone: BadgeTone; label: string } {
  switch (status) {
    case "success":
      return { tone: "success", label: "Success" };
    case "failed":
    case "bg_removal_failed":
    case "compositing_failed":
    case "render_error":
    case "unknown_error":
      return { tone: "critical", label: status === "failed" ? "Failed" : status.replace(/_/g, " ") };
    case "pending":
      return { tone: "attention", label: "Pending" };
    case "quota_exceeded":
      return { tone: "warning", label: "Quota exceeded" };
    case "timed_out":
    case "renderer_timeout":
      return { tone: "warning", label: status === "timed_out" ? "Timed out" : "Renderer timeout" };
    case "quality_gate":
      return { tone: "info", label: "Quality gate" };
    default:
      return { tone: undefined, label: "No image" };
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProductsRoute() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const fetcher = useFetcher();

  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const statusOptions: { label: string; value: string }[] = [
    { label: "All statuses", value: "all" },
    { label: "Success", value: "success" },
    { label: "Failed", value: "failed" },
    { label: "Pending", value: "pending" },
    { label: "Quota exceeded", value: "quota_exceeded" },
    { label: "Timed out", value: "timed_out" },
    { label: "No image", value: "no_image" },
  ];

  const sortOptions: { label: string; value: string }[] = [
    { label: "Newest first", value: "generated_at:desc" },
    { label: "Oldest first", value: "generated_at:asc" },
    { label: "Title A–Z", value: "title:asc" },
    { label: "Title Z–A", value: "title:desc" },
  ];

  const currentSort = `${data.sortField}:${data.sortDir}`;

  function navigate(params: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(params)) {
      next.set(k, v);
    }
    next.set("page", "1");
    setSearchParams(next);
  }

  // Regenerate a single product
  function regenerate(productId: string) {
    const form = new FormData();
    form.append("productId", productId);
    fetcher.submit(form, { method: "post" });
    setToastMessage("Regeneration queued");
    setToastActive(true);
  }

  // Retry a failed job
  function retryJob(imageId: string) {
    const form = new FormData();
    form.append("intent", "retry");
    form.append("imageId", imageId);
    fetcher.submit(form, { method: "post" });
    setToastMessage("Retrying image generation...");
    setToastActive(true);
  }

  // Bulk regenerate selected
  function bulkRegenerate() {
    if (selectedItems.length === 0) return;
    const form = new FormData();
    for (const id of selectedItems) form.append("productId", id);
    fetcher.submit(form, { method: "post" });
    setToastMessage(`${selectedItems.length} product(s) queued for regeneration`);
    setToastActive(true);
    setSelectedItems([]);
  }

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLUListElement>) => {
      const items = data.products;
      if (items.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        const product = items[focusedIndex];
        if (product) {
          // eslint-disable-next-line no-restricted-globals
          (globalThis as unknown as { open?: (url: string, target: string) => void }).open?.(
            `https://admin.shopify.com/products/${product.shopify_product_id}`,
            "_blank"
          );
        }
      } else if (e.key === "r" || e.key === "R") {
        if (focusedIndex >= 0) {
          e.preventDefault();
          const product = items[focusedIndex];
          if (product) regenerate(product.id);
        }
      }
    },
    [data.products, focusedIndex]
  );

  // Focus item when focusedIndex changes
  useEffect(() => {
    if (!listRef.current || focusedIndex < 0) return;
    const root = listRef.current as unknown as {
      querySelectorAll: (sel: string) => Array<{ focus: () => void }>;
    };
    const items = root.querySelectorAll("[data-product-item]");
    items[focusedIndex]?.focus();
  }, [focusedIndex]);

  const bulkActions = [
    {
      content: "Regenerate selected",
      onAction: bulkRegenerate,
    },
  ];

  const filterControl = (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <Select
        label="Status"
        labelHidden
        options={statusOptions}
        value={data.statusFilter}
        onChange={(v) => navigate({ status: v })}
        aria-label="Filter by status"
      />
      <Select
        label="Sort"
        labelHidden
        options={sortOptions}
        value={currentSort}
        onChange={(v) => {
          const parts = v.split(":");
          navigate({ sort: parts[0] ?? "generated_at", dir: parts[1] ?? "desc" });
        }}
        aria-label="Sort products"
      />
      {selectedItems.length > 0 && (
        <Button
          onClick={bulkRegenerate}
          loading={fetcher.state === "submitting"}
          aria-label={`Bulk regenerate ${selectedItems.length} selected products`}
        >
          {`Regenerate ${selectedItems.length} selected`}
        </Button>
      )}
    </InlineStack>
  );

  const toastMarkup = toastActive ? (
    <Toast
      content={toastMessage}
      onDismiss={() => setToastActive(false)}
      duration={3000}
    />
  ) : null;

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <Frame>
      {toastMarkup}
      <Page
        title="Products"
        subtitle={`${data.total} product${data.total !== 1 ? "s" : ""} synced`}
        primaryAction={{
          content: "Sync products",
          url: "/app/products?sync=1",
          accessibilityLabel: "Sync products from Shopify",
        }}
      >
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">{filterControl}</Box>

              {data.products.length === 0 ? (
                <EmptyState
                  heading="No products match your filter"
                  image=""
                  aria-label="No products found"
                >
                  <Text as="p">Try changing the status filter or sync more products.</Text>
                </EmptyState>
              ) : (
                <>
                  <ul
                    ref={listRef}
                    role="listbox"
                    aria-label="Products list"
                    onKeyDown={handleKeyDown}
                    style={{ listStyle: "none", margin: 0, padding: 0 }}
                  >
                    <ResourceList
                      resourceName={{ singular: "product", plural: "products" }}
                      items={data.products}
                      selectedItems={selectedItems}
                      onSelectionChange={(s) =>
                        setSelectedItems(
                          s === "All"
                            ? data.products.map((p) => p.id)
                            : (s as string[])
                        )
                      }
                      bulkActions={bulkActions}
                      renderItem={(product: ProductWithImage, _id, index) => {
                        const { tone, label } = statusBadge(product.generated_image_status);
                        const isFocused = focusedIndex === (index ?? -1);

                        return (
                          <ResourceItem
                            id={product.id}
                            media={
                              product.generated_image_status === "success" &&
                              product.generated_image_r2_key ? (
                                <Thumbnail
                                  source={`/api/image/${encodeURIComponent(product.generated_image_r2_key)}`}
                                  alt={`Generated image for ${product.title}`}
                                  size="medium"
                                />
                              ) : (
                                <Thumbnail
                                  source={product.image_url ?? ImageIcon}
                                  alt={`Product image for ${product.title}`}
                                  size="medium"
                                />
                              )
                            }
                            accessibilityLabel={`Product: ${product.title}, status: ${label}`}
                            onClick={() => {}}
                          >
                            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
                            <li
                              data-product-item
                              tabIndex={0}
                              role="option"
                              aria-selected={selectedItems.includes(product.id)}
                              aria-label={`${product.title} — ${label}`}
                              style={{ outline: isFocused ? "2px solid #005bd3" : "none" }}
                              onFocus={() => setFocusedIndex(index ?? -1)}
                            >
                              <BlockStack gap="100">
                                <InlineStack gap="200" blockAlign="center" wrap={false}>
                                  <Text variant="bodyMd" fontWeight="semibold" as="span">
                                    {product.title}
                                  </Text>
                                  <Badge tone={tone}>{label}</Badge>
                                </InlineStack>

                                <InlineStack gap="400" blockAlign="center" wrap={false}>
                                  <Text variant="bodySm" as="span" tone="subdued">
                                    Generated: {formatDate(product.generated_at)}
                                  </Text>
                                  {product.error_message && (
                                    <Text variant="bodySm" as="span" tone="critical">
                                      {product.error_message.slice(0, 80)}
                                    </Text>
                                  )}
                                </InlineStack>

                                <InlineStack gap="200" blockAlign="center">
                                  {isRetryable(product.generated_image_status) && (
                                    <Button
                                      size="slim"
                                      tone="critical"
                                      onClick={() => {
                                        retryJob(product.generated_image_id ?? product.id);
                                      }}
                                      loading={
                                        fetcher.state === "submitting" &&
                                        fetcher.formData?.get("intent") === "retry" &&
                                        fetcher.formData?.get("imageId") === (product.generated_image_id ?? product.id)
                                      }
                                      aria-label={`Retry failed image generation for ${product.title}`}
                                      accessibilityLabel={`Retry failed image generation for ${product.title}`}
                                    >
                                      Retry
                                    </Button>
                                  )}
                                  <Button
                                    size="slim"
                                    onClick={() => {
                                      regenerate(product.id);
                                    }}
                                    loading={
                                      fetcher.state === "submitting" &&
                                      fetcher.formData?.get("productId") === product.id
                                    }
                                    aria-label={`Regenerate image for ${product.title}`}
                                    accessibilityLabel={`Regenerate image for ${product.title} (keyboard: R)`}
                                  >
                                    Regenerate
                                  </Button>
                                  <Button
                                    size="slim"
                                    variant="plain"
                                    url={`/app/products/${product.id}/formats`}
                                    aria-label={`View format variants for ${product.title}`}
                                    accessibilityLabel={`View format variants for ${product.title}`}
                                  >
                                    Format variants
                                  </Button>
                                  <Text variant="bodySm" as="span" tone="subdued">
                                    Press R to regenerate
                                  </Text>
                                </InlineStack>
                              </BlockStack>
                            </li>
                          </ResourceItem>
                        );
                      }}
                    />
                  </ul>

                  {totalPages > 1 && (
                    <Box padding="400">
                      <InlineStack align="center">
                        <Pagination
                          hasPrevious={data.page > 1}
                          onPrevious={() => {
                            const next = new URLSearchParams(searchParams);
                            next.set("page", String(data.page - 1));
                            setSearchParams(next);
                          }}
                          hasNext={data.page < totalPages}
                          onNext={() => {
                            const next = new URLSearchParams(searchParams);
                            next.set("page", String(data.page + 1));
                            setSearchParams(next);
                          }}
                          label={`Page ${data.page} of ${totalPages}`}
                        />
                      </InlineStack>
                    </Box>
                  )}
                </>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}

export function ProductsSkeleton() {
  return (
    <div role="status" aria-label="Loading products" aria-live="polite">
      <Page title="Products">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={8} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
