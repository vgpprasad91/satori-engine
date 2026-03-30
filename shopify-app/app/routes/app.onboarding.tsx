/**
 * PR-021: Merchant onboarding flow — first-run setup wizard
 *
 * Route: /app/onboarding
 *
 * Three-step wizard:
 *   Step 1 — Brand kit (logo, color, font)
 *   Step 2 — Template selection grid
 *   Step 3 — Confirmation (product count + estimated time)
 */

import {
  json,
  redirect,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/cloudflare";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  Button,
  TextField,
  Select,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  ProgressBar,
  Thumbnail,
  Grid,
  Badge,
} from "@shopify/polaris";
import {
  saveBrandKit,
  saveTemplatePreference,
  completeOnboarding,
  getOnboardingState,
  uploadLogoToR2,
  validateHexColor,
  ONBOARDING_TEMPLATES,
  SUPPORTED_FONTS,
  type BrandKit,
  type OnboardingEnv,
} from "../../src/onboarding.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";

type FullEnv = ShopifyEnv & OnboardingEnv & { KV_STORE: KVNamespace; DB: D1Database };

// ---------------------------------------------------------------------------
// Loader — read current onboarding state
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: FullEnv } }).cloudflare.env;

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "test.myshopify.com";

  const state = await getOnboardingState(shop, env.KV_STORE);

  if (state?.step === "complete") {
    return redirect("/app/dashboard");
  }

  const currentStep = state?.step ?? 1;
  const brandKit = state?.brandKit ?? null;
  const selectedTemplateId = state?.selectedTemplateId ?? null;

  return json({
    shop,
    currentStep,
    brandKit,
    selectedTemplateId,
    templates: ONBOARDING_TEMPLATES,
    fonts: [...SUPPORTED_FONTS] as string[],
  });
}

// ---------------------------------------------------------------------------
// Action — handle each step submission
// ---------------------------------------------------------------------------

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

  const step = formData.get("step") as string;
  const shop = (formData.get("shop") as string) ?? "test.myshopify.com";

  // ---------- Step 1: Brand Kit ----------
  if (step === "1") {
    const primaryColor = (formData.get("primaryColor") as string) ?? "#000000";
    const fontFamily = (formData.get("fontFamily") as string) ?? "Inter";

    let hexColor: string;
    try {
      hexColor = validateHexColor(primaryColor);
    } catch {
      return json({ error: "Invalid color format. Please enter a valid hex color (e.g. #FF5733)." });
    }

    let logoR2Key: string | null = null;
    let logoUrl: string | null = null;

    const logoFile = formData.get("logo") as File | null;
    if (logoFile && logoFile.size > 0) {
      const buffer = await logoFile.arrayBuffer();
      const ct = logoFile.type || "image/png";
      logoR2Key = await uploadLogoToR2(shop, buffer, ct, env.R2_BUCKET);
      logoUrl = `${env.SHOPIFY_APP_URL}/r2/${logoR2Key}`;
    }

    const brandKit: BrandKit = {
      primaryColor: hexColor,
      fontFamily,
      logoR2Key,
      logoUrl,
    };

    await saveBrandKit(shop, brandKit, env.KV_STORE);

    const { saveOnboardingState } = await import("../../src/onboarding.server.js");
    await saveOnboardingState(
      shop,
      { shop, step: 2, brandKit, selectedTemplateId: null, completedAt: null },
      env.KV_STORE
    );

    return redirect(`/app/onboarding?shop=${shop}`);
  }

  // ---------- Step 2: Template Selection ----------
  if (step === "2") {
    const templateId = formData.get("templateId") as string;

    try {
      await saveTemplatePreference(shop, templateId, env.DB);
    } catch (e) {
      return json({ error: String(e) });
    }

    const { getOnboardingState: getState, saveOnboardingState } = await import(
      "../../src/onboarding.server.js"
    );
    const state = await getState(shop, env.KV_STORE);
    await saveOnboardingState(
      shop,
      {
        shop,
        step: 3,
        brandKit: state?.brandKit ?? null,
        selectedTemplateId: templateId,
        completedAt: null,
      },
      env.KV_STORE
    );

    return redirect(`/app/onboarding?shop=${shop}`);
  }

  // ---------- Step 3: Complete ----------
  if (step === "3") {
    const productCount = parseInt((formData.get("productCount") as string) ?? "0", 10);

    const { getOnboardingState: getState } = await import("../../src/onboarding.server.js");
    const state = await getState(shop, env.KV_STORE);

    if (!state?.brandKit || !state?.selectedTemplateId) {
      return json({ error: "Onboarding state missing. Please start from Step 1." });
    }

    await completeOnboarding(
      shop,
      state.brandKit,
      state.selectedTemplateId,
      productCount,
      env
    );

    return redirect("/app/dashboard");
  }

  return json({ error: "Unknown step." });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const { shop, currentStep, brandKit, selectedTemplateId, templates, fonts } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const stepProgress = ((Number(currentStep) - 1) / 3) * 100;

  return (
    <Page
      title="Welcome to MailCraft"
      subtitle="Let's set up your account in 3 quick steps"
    >
      <BlockStack gap="500">
        {/* Progress bar */}
        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text as="span" variant="bodyMd">
                Step {currentStep} of 3
              </Text>
              <Text as="span" variant="bodyMd" tone="subdued">
                {currentStep === 1
                  ? "Brand Kit"
                  : currentStep === 2
                  ? "Template Selection"
                  : "Confirmation"}
              </Text>
            </InlineStack>
            <ProgressBar progress={stepProgress} size="small" />
          </BlockStack>
        </Card>

        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {/* Step 1 — Brand Kit */}
        {currentStep === 1 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Step 1: Set up your brand kit
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Your brand kit is used across all generated images to maintain a
                consistent look and feel.
              </Text>

              <Form method="post" encType="multipart/form-data">
                <input type="hidden" name="step" value="1" />
                <input type="hidden" name="shop" value={shop} />
                <BlockStack gap="300">
                  <div>
                    <Text as="p" variant="bodyMd">
                      Brand Logo (optional, PNG/JPG, max 5MB)
                    </Text>
                    <input
                      type="file"
                      name="logo"
                      accept="image/png,image/jpeg"
                      aria-label="Upload your brand logo"
                      style={{ marginTop: "8px", display: "block" }}
                    />
                  </div>

                  <TextField
                    label="Primary Brand Color"
                    name="primaryColor"
                    value={brandKit?.primaryColor ?? "#0052CC"}
                    placeholder="#0052CC"
                    helpText="Enter a hex color code (e.g. #0052CC)"
                    autoComplete="off"
                    onChange={() => {}}
                  />

                  <Select
                    label="Font Family"
                    name="fontFamily"
                    options={fonts.map((f) => ({ label: f, value: f }))}
                    value={brandKit?.fontFamily ?? "Inter"}
                    onChange={() => {}}
                    helpText="Choose the primary font for your generated images"
                  />

                  <Button
                    submit
                    variant="primary"
                    loading={isSubmitting}
                    accessibilityLabel="Save brand kit and continue to template selection"
                  >
                    Save and Continue →
                  </Button>
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>
        )}

        {/* Step 2 — Template Selection */}
        {currentStep === 2 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Step 2: Choose your default template
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Select a template to use for your product images. You can change
                this later.
              </Text>

              <Form method="post">
                <input type="hidden" name="step" value="2" />
                <input type="hidden" name="shop" value={shop} />
                <BlockStack gap="400">
                  <Grid>
                    {templates.map((template) => {
                      const isSelected = selectedTemplateId === template.id;
                      return (
                        <Grid.Cell
                          key={template.id}
                          columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}
                        >
                          <label
                            htmlFor={`template-${template.id}`}
                            style={{ cursor: "pointer" }}
                          >
                            <Card>
                              <BlockStack gap="200">
                                <Thumbnail
                                  source={template.thumbnail}
                                  alt={template.name}
                                  size="large"
                                />
                                <InlineStack align="space-between" blockAlign="center">
                                  <Text as="span" variant="bodySm">
                                    {template.name}
                                  </Text>
                                  {isSelected && (
                                    <Badge tone="success">Selected</Badge>
                                  )}
                                </InlineStack>
                                <input
                                  type="radio"
                                  id={`template-${template.id}`}
                                  name="templateId"
                                  value={template.id}
                                  defaultChecked={isSelected}
                                  aria-label={`Select ${template.name} template`}
                                  required
                                />
                              </BlockStack>
                            </Card>
                          </label>
                        </Grid.Cell>
                      );
                    })}
                  </Grid>

                  <InlineStack gap="300">
                    <Button
                      url={`/app/onboarding?shop=${shop}`}
                      accessibilityLabel="Go back to step 1"
                    >
                      ← Back
                    </Button>
                    <Button
                      submit
                      variant="primary"
                      loading={isSubmitting}
                      accessibilityLabel="Save template selection and continue to confirmation"
                    >
                      Continue →
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>
        )}

        {/* Step 3 — Confirmation */}
        {currentStep === 3 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Step 3: You&apos;re all set!
              </Text>

              <Banner tone="success">
                <p>Your brand kit and template have been saved successfully.</p>
              </Banner>

              <BlockStack gap="200">
                {brandKit && (
                  <>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" tone="subdued">
                        Brand Color:
                      </Text>
                      <span
                        style={{
                          display: "inline-block",
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          backgroundColor: brandKit.primaryColor,
                          border: "1px solid #ccc",
                        }}
                        aria-label={`Brand color: ${brandKit.primaryColor}`}
                      />
                      <Text as="span" variant="bodyMd">
                        {brandKit.primaryColor}
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Text as="span" variant="bodyMd" tone="subdued">
                        Font:
                      </Text>
                      <Text as="span" variant="bodyMd">
                        {brandKit.fontFamily}
                      </Text>
                    </InlineStack>
                    {brandKit.logoUrl && (
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodyMd" tone="subdued">
                          Logo:
                        </Text>
                        <Thumbnail source={brandKit.logoUrl} alt="Brand logo" size="small" />
                      </InlineStack>
                    )}
                  </>
                )}

                {selectedTemplateId && (
                  <InlineStack gap="200">
                    <Text as="span" variant="bodyMd" tone="subdued">
                      Template:
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {ONBOARDING_TEMPLATES.find((t) => t.id === selectedTemplateId)?.name ??
                        selectedTemplateId}
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>

              <Form method="post">
                <input type="hidden" name="step" value="3" />
                <input type="hidden" name="shop" value={shop} />
                <input type="hidden" name="productCount" value="0" />

                <InlineStack gap="300">
                  <Button
                    url={`/app/onboarding?shop=${shop}`}
                    accessibilityLabel="Go back to step 2"
                  >
                    ← Back
                  </Button>
                  <Button
                    submit
                    variant="primary"
                    loading={isSubmitting}
                    accessibilityLabel="Complete onboarding and go to dashboard"
                  >
                    Go to Dashboard →
                  </Button>
                </InlineStack>
              </Form>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
