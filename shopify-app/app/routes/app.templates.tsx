/**
 * PR-023: Template editor — brand kit customisation
 *
 * Route: /app/templates
 *
 * Features:
 *  - Template picker grid (8 templates)
 *  - Brand color picker with live preview (debounced 500 ms → /api/preview)
 *  - Logo upload with R2 storage and preview
 *  - Font family selector
 *  - Keyboard shortcuts: Cmd+S save, Cmd+Z undo, Cmd+P preview, Esc cancel
 *  - role="application" on editor container
 *  - aria-label on all canvas interaction zones
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import {
  json,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Page,
  Layout,
  Card,
  Grid,
  Button,
  Select,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Thumbnail,
  Toast,
  Frame,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";
import {
  getTemplateBrandKit,
  saveTemplateBrandKit,
  uploadLogoToR2,
  EDITOR_TEMPLATES,
  TEMPLATE_FONTS,
  type TemplateBrandKit,
} from "../../src/templates.server.js";

// ---------------------------------------------------------------------------
// Env type
// ---------------------------------------------------------------------------

type FullEnv = ShopifyEnv & {
  KV_STORE: KVNamespace;
  R2_BUCKET: R2Bucket;
  SHOPIFY_APP_URL: string;
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

interface LoaderData {
  shop: string;
  brandKit: TemplateBrandKit;
  fonts: string[];
  templates: typeof EDITOR_TEMPLATES;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: FullEnv } }).cloudflare.env;
  const auth = await shopifyAuth(request, env);
  const shop = auth?.shop ?? "";

  const brandKit = shop ? await getTemplateBrandKit(shop, env.KV_STORE) : {
    primaryColor: "#0052CC",
    fontFamily: "Inter",
    logoR2Key: null,
    logoUrl: null,
  };

  return json<LoaderData>({
    shop,
    brandKit,
    fonts: [...TEMPLATE_FONTS] as string[],
    templates: EDITOR_TEMPLATES,
  });
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

interface ActionResult {
  success?: boolean;
  error?: string;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = (context as { cloudflare: { env: FullEnv } }).cloudflare.env;

  const contentType = request.headers.get("content-type") ?? "";

  let formData: FormData;
  if (contentType.includes("multipart/form-data")) {
    const handler = unstable_createMemoryUploadHandler({ maxPartSize: 5 * 1024 * 1024 });
    formData = await unstable_parseMultipartFormData(request, handler);
  } else {
    formData = await request.formData();
  }

  const shop = (formData.get("shop") as string) ?? "";
  const intent = formData.get("intent") as string;

  // ── Save brand kit ────────────────────────────────────────────────────────
  if (intent === "save-brand-kit") {
    const primaryColor = (formData.get("primaryColor") as string) ?? "#0052CC";
    const fontFamily = (formData.get("fontFamily") as string) ?? "Inter";

    // Hex validation
    if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) {
      return json<ActionResult>({ error: "Invalid hex color. Use format #RRGGBB." });
    }

    let logoR2Key: string | null = null;
    let logoUrl: string | null = null;

    const existingLogoKey = formData.get("existingLogoR2Key") as string | null;
    const existingLogoUrl = formData.get("existingLogoUrl") as string | null;

    const logoFile = formData.get("logo") as File | null;
    if (logoFile && logoFile.size > 0) {
      const buffer = await logoFile.arrayBuffer();
      const ct = logoFile.type || "image/png";
      logoR2Key = await uploadLogoToR2(shop, buffer, ct, env.R2_BUCKET);
      logoUrl = `${env.SHOPIFY_APP_URL}/r2/${logoR2Key}`;
    } else {
      logoR2Key = existingLogoKey;
      logoUrl = existingLogoUrl;
    }

    const brandKit: TemplateBrandKit = {
      primaryColor,
      fontFamily,
      logoR2Key,
      logoUrl,
    };

    await saveTemplateBrandKit(shop, brandKit, env.KV_STORE);

    return json<ActionResult>({ success: true });
  }

  return json<ActionResult>({ error: "Unknown intent." });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TemplatesRoute() {
  const { shop, brandKit: initialBrandKit, fonts, templates } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // ── Local state ────────────────────────────────────────────────────────────
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    templates[0]?.id ?? "product-card"
  );
  const [primaryColor, setPrimaryColor] = useState<string>(
    initialBrandKit.primaryColor
  );
  const [fontFamily, setFontFamily] = useState<string>(
    initialBrandKit.fontFamily
  );
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(
    initialBrandKit.logoUrl
  );
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [toastActive, setToastActive] = useState(false);
  const [undoStack, setUndoStack] = useState<
    Array<{ primaryColor: string; fontFamily: string; selectedTemplateId: string }>
  >([]);

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Debounced preview ─────────────────────────────────────────────────────
  const fetchPreview = useCallback(
    (color: string, font: string, templateId: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const params = new URLSearchParams({
            template: templateId,
            primaryColor: color,
            fontFamily: font,
          });
          const res = await fetch(`/api/preview?${params.toString()}`);
          if (res.ok) {
            const blob = await res.blob();
            // URL.createObjectURL is available in the browser environment
            const browserURL = URL as unknown as { createObjectURL: (b: Blob) => string };
            setPreviewImageUrl(browserURL.createObjectURL(blob));
          }
        } catch {
          // Preview fetch is best-effort — silently ignore
        }
      }, 500);
    },
    []
  );

  useEffect(() => {
    fetchPreview(primaryColor, fontFamily, selectedTemplateId);
  }, [primaryColor, fontFamily, selectedTemplateId, fetchPreview]);

  // ── Toast on save success ─────────────────────────────────────────────────
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      setToastActive(true);
    }
  }, [actionData]);

  // ── Undo helper ───────────────────────────────────────────────────────────
  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [
      ...prev,
      { primaryColor, fontFamily, selectedTemplateId },
    ]);
  }, [primaryColor, fontFamily, selectedTemplateId]);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last) {
        setPrimaryColor(last.primaryColor);
        setFontFamily(last.fontFamily);
        setSelectedTemplateId(last.selectedTemplateId);
      }
      return prev.slice(0, -1);
    });
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const formRef = useRef<HTMLFormElement | null>(null);

  // BrowserEvent: typed for browser KeyboardEvent properties not in Workers types
  type BrowserKeyboardEvent = {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    preventDefault(): void;
  };

  useEffect(() => {
    function handleKeyDown(raw: Event) {
      const e = raw as unknown as BrowserKeyboardEvent;
      const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform.toUpperCase().includes("MAC");
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (cmdOrCtrl && e.key === "s") {
        e.preventDefault();
        const form = formRef.current as unknown as { requestSubmit?: () => void } | null;
        form?.requestSubmit?.();
      } else if (cmdOrCtrl && e.key === "z") {
        e.preventDefault();
        handleUndo();
      } else if (cmdOrCtrl && e.key === "p") {
        e.preventDefault();
        fetchPreview(primaryColor, fontFamily, selectedTemplateId);
      } else if (e.key === "Escape") {
        // Cancel: reset to initial brand kit values
        setPrimaryColor(initialBrandKit.primaryColor);
        setFontFamily(initialBrandKit.fontFamily);
        setLogoPreviewUrl(initialBrandKit.logoUrl);
      }
    }

    // Use globalThis to avoid Workers-type `window` conflict
    const gw = globalThis as unknown as {
      addEventListener: (type: string, fn: (e: Event) => void) => void;
      removeEventListener: (type: string, fn: (e: Event) => void) => void;
    };
    gw.addEventListener("keydown", handleKeyDown);
    return () => gw.removeEventListener("keydown", handleKeyDown);
  }, [
    handleUndo,
    fetchPreview,
    primaryColor,
    fontFamily,
    selectedTemplateId,
    initialBrandKit,
  ]);

  // ── Logo file change ──────────────────────────────────────────────────────
  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Cast through unknown to access browser-only FileList / File / URL.createObjectURL
    type BrowserInput = { files?: ArrayLike<{ name: string }> };
    const input = e.target as unknown as BrowserInput;
    const file = input.files?.[0];
    if (file) {
      const browserURL = URL as unknown as { createObjectURL: (f: unknown) => string };
      setLogoPreviewUrl(browserURL.createObjectURL(file));
    }
  }

  const toastMarkup = toastActive ? (
    <Toast
      content="Brand kit saved successfully"
      onDismiss={() => setToastActive(false)}
    />
  ) : null;

  return (
    <Frame>
      {toastMarkup}
      <Page
        title="Template Editor"
        subtitle="Customise your brand kit and choose a template"
      >
        <Layout>
          {/* Error banner */}
          {actionData && "error" in actionData && actionData.error && (
            <Layout.Section>
              <Banner tone="critical">
                <p>{actionData.error}</p>
              </Banner>
            </Layout.Section>
          )}

          {/* Main editor — role="application" + aria-label */}
          <Layout.Section>
            <div
              role="application"
              aria-label="Template editor workspace"
            >
              <BlockStack gap="600">
                {/* ── Template picker ─────────────────────────────────────── */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Choose a template
                    </Text>
                    <div
                      role="radiogroup"
                      aria-label="Available templates"
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(160px, 1fr))",
                        gap: "1rem",
                      }}
                    >
                      {templates.map((template) => {
                        const isSelected = selectedTemplateId === template.id;
                        return (
                          <div
                            key={template.id}
                            role="radio"
                            aria-checked={isSelected}
                            aria-label={`Template: ${template.name}${isSelected ? " (selected)" : ""}`}
                            tabIndex={0}
                            onClick={() => {
                              pushUndo();
                              setSelectedTemplateId(template.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                pushUndo();
                                setSelectedTemplateId(template.id);
                              }
                            }}
                            style={{
                              border: isSelected
                                ? `2px solid ${primaryColor}`
                                : "2px solid #e1e3e5",
                              borderRadius: 8,
                              padding: "0.75rem",
                              textAlign: "center",
                              cursor: "pointer",
                              background: isSelected ? "#f0f4ff" : "#fafafa",
                              outline: "none",
                              transition: "border-color 0.15s, background 0.15s",
                            }}
                          >
                            {/* Thumbnail placeholder */}
                            <div
                              aria-label={`Preview thumbnail for ${template.name}`}
                              style={{
                                width: "100%",
                                aspectRatio: "1",
                                background: "#e9ecef",
                                borderRadius: 4,
                                marginBottom: "0.5rem",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                overflow: "hidden",
                              }}
                            >
                              <img
                                src={template.thumbnail}
                                alt={`${template.name} thumbnail`}
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                                onError={(e) => {
                                  const img = e.currentTarget as unknown as { style: { display: string } };
                                  img.style.display = "none";
                                }}
                              />
                            </div>
                            <InlineStack align="center" gap="100">
                              <Text variant="bodySm" as="p">
                                {template.name}
                              </Text>
                              {isSelected && (
                                <Badge tone="success">Selected</Badge>
                              )}
                            </InlineStack>
                          </div>
                        );
                      })}
                    </div>
                  </BlockStack>
                </Card>

                {/* ── Brand kit form ───────────────────────────────────────── */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Brand kit
                    </Text>
                    <Text variant="bodyMd" as="p" tone="subdued">
                      These settings are applied across all generated images.
                      Keyboard shortcuts: <kbd>Cmd+S</kbd> save,{" "}
                      <kbd>Cmd+Z</kbd> undo, <kbd>Cmd+P</kbd> preview,{" "}
                      <kbd>Esc</kbd> cancel.
                    </Text>

                    <Form
                      method="post"
                      encType="multipart/form-data"
                      ref={formRef}
                    >
                      <input type="hidden" name="shop" value={shop} />
                      <input type="hidden" name="intent" value="save-brand-kit" />
                      <input
                        type="hidden"
                        name="existingLogoR2Key"
                        value={initialBrandKit.logoR2Key ?? ""}
                      />
                      <input
                        type="hidden"
                        name="existingLogoUrl"
                        value={initialBrandKit.logoUrl ?? ""}
                      />

                      <BlockStack gap="400">
                        {/* Color picker */}
                        <div>
                          <Text as="p" variant="bodyMd">
                            Primary brand color
                          </Text>
                          <div
                            aria-label="Brand color picker"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.75rem",
                              marginTop: "0.5rem",
                            }}
                          >
                            <input
                              type="color"
                              name="primaryColor"
                              value={primaryColor}
                              onChange={(e) => {
                                pushUndo();
                                const input = e.target as unknown as { value: string };
                                setPrimaryColor(input.value);
                              }}
                              aria-label="Pick primary brand color"
                              style={{
                                width: 48,
                                height: 40,
                                border: "1px solid #ccc",
                                borderRadius: 4,
                                cursor: "pointer",
                                padding: 2,
                              }}
                            />
                            <input
                              type="text"
                              value={primaryColor}
                              onChange={(e) => {
                                pushUndo();
                                const input = e.target as unknown as { value: string };
                                setPrimaryColor(input.value);
                              }}
                              aria-label="Primary brand color hex value"
                              maxLength={7}
                              style={{
                                fontFamily: "monospace",
                                fontSize: 14,
                                border: "1px solid #ccc",
                                borderRadius: 4,
                                padding: "4px 8px",
                                width: 100,
                              }}
                            />
                            {/* Live color swatch */}
                            <div
                              aria-label={`Color preview: ${primaryColor}`}
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 4,
                                backgroundColor: primaryColor,
                                border: "1px solid #ccc",
                              }}
                            />
                          </div>
                        </div>

                        {/* Font selector */}
                        <Select
                          label="Font family"
                          name="fontFamily"
                          options={fonts.map((f) => ({ label: f, value: f }))}
                          value={fontFamily}
                          onChange={(val) => {
                            pushUndo();
                            setFontFamily(val);
                          }}
                          helpText="Primary font for generated images"
                        />

                        {/* Logo upload */}
                        <div>
                          <Text as="p" variant="bodyMd">
                            Brand logo (PNG or JPG, max 5 MB)
                          </Text>
                          {logoPreviewUrl && (
                            <div
                              aria-label="Uploaded brand logo preview"
                              style={{ margin: "0.5rem 0" }}
                            >
                              <Thumbnail
                                source={logoPreviewUrl}
                                alt="Brand logo preview"
                                size="medium"
                              />
                            </div>
                          )}
                          <input
                            type="file"
                            name="logo"
                            accept="image/png,image/jpeg"
                            aria-label="Upload brand logo"
                            onChange={handleLogoChange}
                            style={{ marginTop: "0.5rem", display: "block" }}
                          />
                        </div>

                        {/* Action buttons */}
                        <InlineStack gap="300">
                          <Button
                            submit
                            variant="primary"
                            loading={isSubmitting}
                            accessibilityLabel="Save brand kit (Cmd+S)"
                          >
                            Save brand kit
                          </Button>
                          <Button
                            onClick={handleUndo}
                            disabled={undoStack.length === 0}
                            accessibilityLabel="Undo last change (Cmd+Z)"
                          >
                            Undo
                          </Button>
                          <Button
                            onClick={() =>
                              fetchPreview(primaryColor, fontFamily, selectedTemplateId)
                            }
                            accessibilityLabel="Refresh preview (Cmd+P)"
                          >
                            Preview
                          </Button>
                          <Button
                            onClick={() => {
                              setPrimaryColor(initialBrandKit.primaryColor);
                              setFontFamily(initialBrandKit.fontFamily);
                              setLogoPreviewUrl(initialBrandKit.logoUrl);
                            }}
                            accessibilityLabel="Cancel and discard changes (Esc)"
                          >
                            Cancel
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Form>
                  </BlockStack>
                </Card>
              </BlockStack>
            </div>
          </Layout.Section>

          {/* Live preview panel */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Live preview
                </Text>
                <div
                  role="img"
                  aria-label={`Live preview of ${
                    templates.find((t) => t.id === selectedTemplateId)?.name ?? "selected"
                  } template with current brand kit`}
                  style={{
                    width: "100%",
                    aspectRatio: "1",
                    background: "#f4f6f8",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    border: "1px solid #e1e3e5",
                  }}
                >
                  {previewImageUrl ? (
                    <img
                      src={previewImageUrl}
                      alt="Template preview"
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  ) : (
                    <BlockStack gap="200" inlineAlign="center">
                      {/* Inline preview using CSS to show brand color */}
                      <div
                        style={{
                          width: 120,
                          height: 120,
                          borderRadius: 8,
                          background: primaryColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        aria-hidden="true"
                      >
                        {logoPreviewUrl ? (
                          <img
                            src={logoPreviewUrl}
                            alt=""
                            style={{ width: 80, height: 80, objectFit: "contain" }}
                          />
                        ) : (
                          <span
                            style={{
                              color: "#fff",
                              fontSize: 32,
                              fontFamily: fontFamily,
                            }}
                          >
                            Aa
                          </span>
                        )}
                      </div>
                      <Text variant="bodySm" as="p" tone="subdued">
                        Preview updates automatically
                      </Text>
                    </BlockStack>
                  )}
                </div>

                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Template:
                    </Text>
                    <Text as="span" variant="bodySm">
                      {templates.find((t) => t.id === selectedTemplateId)?.name ?? "—"}
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Color:
                    </Text>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        backgroundColor: primaryColor,
                        border: "1px solid #ccc",
                        display: "inline-block",
                      }}
                      aria-label={`Brand color: ${primaryColor}`}
                    />
                    <Text as="span" variant="bodySm">
                      {primaryColor}
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Font:
                    </Text>
                    <Text as="span" variant="bodySm">
                      {fontFamily}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton (exported for Remix route suspense)
// ---------------------------------------------------------------------------

export function TemplatesSkeleton() {
  return (
    <div role="status" aria-label="Loading template editor" aria-live="polite">
      <Page title="Template Editor">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={4} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
