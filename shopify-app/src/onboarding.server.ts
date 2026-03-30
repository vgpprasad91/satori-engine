/**
 * PR-021: Merchant onboarding flow — first-run setup wizard
 *
 * Step 1: brand kit setup (logo upload to R2, primary color picker, font selection)
 * Step 2: template selection grid with live preview thumbnails
 * Step 3: connection confirmation showing product count and estimated generation time
 *
 * Trigger Resend transactional email on completion.
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrandKit {
  primaryColor: string; // hex e.g. "#FF5733"
  fontFamily: string; // e.g. "Inter", "Playfair Display"
  logoR2Key: string | null; // R2 object key for uploaded logo
  logoUrl: string | null; // Public URL for logo (from R2)
}

export interface OnboardingState {
  shop: string;
  step: 1 | 2 | 3 | "complete";
  brandKit: BrandKit | null;
  selectedTemplateId: string | null;
  completedAt: string | null;
}

export interface OnboardingEnv {
  KV_STORE: KVNamespace;
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  RESEND_API_KEY: string;
  SHOPIFY_APP_URL: string;
}

export const SUPPORTED_FONTS = [
  "Inter",
  "Playfair Display",
  "Cormorant Garamond",
  "Dancing Script",
  "Bebas Neue",
] as const;

export type SupportedFont = (typeof SUPPORTED_FONTS)[number];

// Default templates available for selection during onboarding
export const ONBOARDING_TEMPLATES = [
  { id: "product-card", name: "Product Card", thumbnail: "/templates/product-card.png" },
  { id: "sale-announcement", name: "Sale Announcement", thumbnail: "/templates/sale-announcement.png" },
  { id: "new-arrival", name: "New Arrival", thumbnail: "/templates/new-arrival.png" },
  { id: "story-format", name: "Story Format", thumbnail: "/templates/story-format.png" },
  { id: "landscape-post", name: "Landscape Post", thumbnail: "/templates/landscape-post.png" },
  { id: "square-post", name: "Square Post", thumbnail: "/templates/square-post.png" },
  { id: "price-drop", name: "Price Drop", thumbnail: "/templates/price-drop.png" },
  { id: "seasonal", name: "Seasonal", thumbnail: "/templates/seasonal.png" },
] as const;

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

export function onboardingStateKey(shop: string): string {
  return `onboarding:${shop}`;
}

export function brandKitKey(shop: string): string {
  return `brandkit:${shop}`;
}

export async function getOnboardingState(
  shop: string,
  kv: KVNamespace
): Promise<OnboardingState | null> {
  const raw = await kv.get(onboardingStateKey(shop));
  if (!raw) return null;
  return JSON.parse(raw) as OnboardingState;
}

export async function saveOnboardingState(
  shop: string,
  state: OnboardingState,
  kv: KVNamespace
): Promise<void> {
  await kv.put(onboardingStateKey(shop), JSON.stringify(state), {
    expirationTtl: 30 * 24 * 60 * 60, // 30 days
  });
}

// ---------------------------------------------------------------------------
// Step 1 — Brand kit
// ---------------------------------------------------------------------------

/**
 * Validate and sanitise the hex color string.
 * Returns the normalized hex or throws if invalid.
 */
export function validateHexColor(color: string): string {
  const trimmed = color.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(trimmed)) {
    // Expand 3-digit to 6-digit
    const [, r, g, b] = trimmed.match(/^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/)!;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  throw new Error(`Invalid hex color: ${color}`);
}

/**
 * Upload merchant logo to R2.
 * Returns the R2 key.
 */
export async function uploadLogoToR2(
  shop: string,
  fileBuffer: ArrayBuffer,
  contentType: string,
  r2: R2Bucket
): Promise<string> {
  const ext = contentType.includes("png") ? "png" : "jpg";
  const key = `logos/${shop}/logo.${ext}`;

  await r2.put(key, fileBuffer, {
    httpMetadata: { contentType },
  });

  log({ shop, step: "onboarding.logo.uploaded", status: "ok", r2Key: key });

  return key;
}

/**
 * Save brand kit to KV.
 */
export async function saveBrandKit(
  shop: string,
  brandKit: BrandKit,
  kv: KVNamespace
): Promise<void> {
  await kv.put(brandKitKey(shop), JSON.stringify(brandKit), {
    expirationTtl: 365 * 24 * 60 * 60, // 1 year
  });

  log({ shop, step: "onboarding.brand_kit.saved", status: "ok" });
}

/**
 * Get brand kit from KV.
 */
export async function getBrandKit(
  shop: string,
  kv: KVNamespace
): Promise<BrandKit | null> {
  const raw = await kv.get(brandKitKey(shop));
  if (!raw) return null;
  return JSON.parse(raw) as BrandKit;
}

// ---------------------------------------------------------------------------
// Step 2 — Template selection
// ---------------------------------------------------------------------------

/**
 * Save the merchant's selected template preference to D1.
 */
export async function saveTemplatePreference(
  shop: string,
  templateId: string,
  db: D1Database
): Promise<void> {
  // Validate template ID is one of the known templates
  const validIds = ONBOARDING_TEMPLATES.map((t) => t.id);
  if (!validIds.includes(templateId as (typeof validIds)[number])) {
    throw new Error(`Unknown template ID: ${templateId}`);
  }

  await db
    .prepare(
      `INSERT INTO webhook_log (webhook_id, shop, type, processed_at)
       VALUES (lower(hex(randomblob(16))), ?, 'template_preference_saved:' || ?, datetime('now'))`
    )
    .bind(shop, templateId)
    .run();

  log({ shop, step: "onboarding.template.selected", status: "ok", templateId });
}

// ---------------------------------------------------------------------------
// Step 3 — Completion email via Resend
// ---------------------------------------------------------------------------

export interface CompletionEmailOpts {
  shop: string;
  productCount: number;
  estimatedMinutes: number;
  resendApiKey: string;
  appUrl: string;
}

/**
 * Send the onboarding completion transactional email via Resend.
 */
export async function sendOnboardingCompletionEmail(
  opts: CompletionEmailOpts
): Promise<void> {
  const { shop, productCount, estimatedMinutes, resendApiKey, appUrl } = opts;

  const body = {
    from: "MailCraft <onboarding@mailcraft.io>",
    to: [`store-notifications@${shop}`],
    subject: "Your MailCraft setup is complete!",
    html: `
      <h1>Welcome to MailCraft!</h1>
      <p>Your store <strong>${shop}</strong> is now connected.</p>
      <p>We found <strong>${productCount} product${productCount !== 1 ? "s" : ""}</strong> ready for image generation.</p>
      <p>Estimated time to generate all images: <strong>~${estimatedMinutes} minutes</strong>.</p>
      <p><a href="${appUrl}/app/products">View your products →</a></p>
    `,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    log({
      shop,
      step: "onboarding.email.failed",
      status: "error",
      error: `Resend ${res.status}: ${text}`,
    });
    throw new Error(`Resend email failed: ${res.status}`);
  }

  log({ shop, step: "onboarding.email.sent", status: "ok" });
}

/**
 * Estimate generation time in minutes based on product count.
 * Assumes ~15 seconds per product on average.
 */
export function estimateGenerationMinutes(productCount: number): number {
  return Math.ceil((productCount * 15) / 60);
}

// ---------------------------------------------------------------------------
// Complete onboarding
// ---------------------------------------------------------------------------

/**
 * Mark onboarding as complete: save state to KV, write to D1 log, send email.
 */
export async function completeOnboarding(
  shop: string,
  brandKit: BrandKit,
  templateId: string,
  productCount: number,
  env: OnboardingEnv
): Promise<void> {
  const completedAt = new Date().toISOString();

  // 1. Mark onboarding complete in KV
  const state: OnboardingState = {
    shop,
    step: "complete",
    brandKit,
    selectedTemplateId: templateId,
    completedAt,
  };
  await saveOnboardingState(shop, state, env.KV_STORE);

  // 2. Write completion log to D1
  await env.DB.prepare(
    `INSERT INTO webhook_log (webhook_id, shop, type, processed_at)
     VALUES (lower(hex(randomblob(16))), ?, 'onboarding_complete', datetime('now'))`
  )
    .bind(shop)
    .run();

  // 3. Send Resend completion email
  const estimatedMinutes = estimateGenerationMinutes(productCount);
  await sendOnboardingCompletionEmail({
    shop,
    productCount,
    estimatedMinutes,
    resendApiKey: env.RESEND_API_KEY,
    appUrl: env.SHOPIFY_APP_URL,
  });

  log({
    shop,
    step: "onboarding.complete",
    status: "ok",
    templateId,
    productCount,
  });
}

/**
 * Check if onboarding has been completed for a shop.
 */
export async function isOnboardingComplete(
  shop: string,
  kv: KVNamespace
): Promise<boolean> {
  const state = await getOnboardingState(shop, kv);
  return state?.step === "complete";
}
