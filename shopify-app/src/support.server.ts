/**
 * PR-034: Support infrastructure setup
 *
 * Intercom integration for merchant support:
 *   - Auto-creates Intercom contact on app/installed webhook
 *   - Canned response library for 5 common issues
 *   - First-response SLA: 24 hours
 *   - Support email alias forwarding configuration
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntercomContact {
  email: string;
  name?: string;
  shop: string;
  plan?: string;
  createdAt?: number;
  customAttributes?: Record<string, string | number | boolean>;
}

export interface IntercomEvent {
  userId: string;
  eventName: string;
  createdAt: number;
  metadata?: Record<string, string | number | boolean>;
}

export type CannedResponseKey =
  | "images_not_generating"
  | "background_removal_wrong"
  | "template_colors_mismatch"
  | "quota_exceeded"
  | "billing_question";

export interface CannedResponse {
  title: string;
  body: string;
  tags: string[];
}

export interface SupportEnv {
  INTERCOM_ACCESS_TOKEN: string;
  INTERCOM_ADMIN_ID?: string;
}

// ---------------------------------------------------------------------------
// Canned Response Library
// ---------------------------------------------------------------------------

export const CANNED_RESPONSES: Record<CannedResponseKey, CannedResponse> = {
  images_not_generating: {
    title: "Images Not Generating",
    body: `Hi there! Thanks for reaching out.

If your images aren't generating, here are the most common causes and fixes:

1. **Check your quota**: Visit the Billing page in your app dashboard to confirm you haven't hit your monthly limit.

2. **Product image requirements**: Your product images must be at least 400×400 pixels. Low-resolution images are automatically skipped.

3. **Queue delay**: During peak hours, image generation may take 2–5 minutes. Check the Products dashboard for status updates.

4. **Re-trigger generation**: Click the "Regenerate" button next to any product that shows a failed or pending status.

If none of these resolve the issue, please share your shop domain and the product IDs affected, and we'll investigate immediately.

We aim to respond within 24 hours — usually much faster!`,
    tags: ["generation", "technical", "triage"],
  },

  background_removal_wrong: {
    title: "Background Removal Looks Wrong",
    body: `Hi there! Thanks for flagging this.

Background removal quality depends on the source image. Here's what helps:

1. **Image clarity**: Sharp, well-lit product photos with clear edges produce the best results. Blurry or low-contrast images may leave artifacts.

2. **Complex backgrounds**: Highly detailed or pattern-heavy backgrounds (e.g., textured fabric) can be tricky. A plain or single-colour background in your source photo works best.

3. **Product type**: Products with transparent elements (glass, mesh, sheer fabric) are harder to isolate cleanly — this is a known limitation.

4. **Try regenerating**: Click "Regenerate" on the product. Our system will retry with alternative removal algorithms.

5. **Manual override**: If results are still unsatisfactory, you can upload a pre-cut PNG (transparent background) directly, and we'll use it as-is.

Share the product URL or ID and we'll take a closer look. We respond within 24 hours.`,
    tags: ["background-removal", "quality", "technical"],
  },

  template_colors_mismatch: {
    title: "Template Colors Don't Match Brand",
    body: `Hi there! Thanks for getting in touch.

If your template colors don't match your brand, here's how to fix it:

1. **Update your brand kit**: Go to Settings → Brand Kit and ensure your primary brand color is set correctly (use the exact hex code, e.g. #FF5733).

2. **Re-apply to templates**: After updating the brand color, click "Apply Brand Kit" in the Template Editor — this will refresh all templates with your new colors.

3. **Regenerate images**: Any previously generated images won't update automatically. Use the "Bulk Regenerate" button on the Products page to refresh all images with the new brand colors.

4. **Template limitations**: Some template sections use fixed accent colors for readability (e.g., white text on dark backgrounds). These are intentional and ensure your customers can read the text.

If you'd like a specific template adjusted, share the template name and the hex codes you'd expect, and we'll investigate. First response within 24 hours.`,
    tags: ["branding", "colors", "template"],
  },

  quota_exceeded: {
    title: "Quota Exceeded — Image Generation Paused",
    body: `Hi there! Thanks for reaching out.

Your account has reached its monthly image generation limit. Here's what you can do:

1. **Upgrade your plan**: Visit the Billing page to upgrade to Pro (1,000 images/month) or Business (10,000 images/month). Generation resumes immediately after upgrade.

2. **Wait for reset**: Monthly quotas reset on the 1st of each month. Your current counter resets automatically — no action needed.

3. **Check usage**: On the Billing page you can see exactly how many images you've used and when your counter resets.

**Current plans:**
- Hobby: 100 images/month (Free)
- Pro: 1,000 images/month ($29/month)
- Business: 10,000 images/month ($79/month)

Let me know if you have any questions about upgrading or if you need a temporary quota extension for a special campaign. We respond within 24 hours.`,
    tags: ["billing", "quota", "upgrade"],
  },

  billing_question: {
    title: "Billing Question",
    body: `Hi there! Thanks for your message.

Here's a quick overview of how billing works in MailCraft:

**Plans & Pricing:**
- Hobby: Free — 100 images/month
- Pro: $29/month — 1,000 images/month
- Business: $79/month — 10,000 images/month

**Billing is managed through Shopify:**
All charges appear on your Shopify invoice — there's no separate MailCraft invoice. You can view and manage your subscription directly in your Shopify admin under Apps & sales channels.

**Upgrading / Downgrading:**
You can change your plan at any time from the Billing page in the app. Upgrades take effect immediately. Downgrades take effect at the next billing cycle.

**Overage charges:**
If you exceed your plan limit, image generation pauses until you upgrade or your counter resets. We don't charge automatic overage fees — you're always in control.

**Cancellation:**
Uninstalling the app from Shopify cancels your subscription immediately. You won't be charged for the unused portion of the month (Shopify prorates).

If your question isn't answered above, please share the details and we'll respond within 24 hours.`,
    tags: ["billing", "pricing", "subscription"],
  },
};

// ---------------------------------------------------------------------------
// Intercom API helpers
// ---------------------------------------------------------------------------

const INTERCOM_API_BASE = "https://api.intercom.io";

async function intercomRequest(
  path: string,
  method: "GET" | "POST" | "PUT",
  body: unknown,
  accessToken: string
): Promise<unknown> {
  const response = await fetch(`${INTERCOM_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Intercom API error ${response.status}: ${text.slice(0, 200)}`
    );
  }

  return response.json();
}

/**
 * Create or update an Intercom contact for a newly installed merchant.
 * Called from the app/installed webhook handler.
 */
export async function createIntercomContact(
  contact: IntercomContact,
  accessToken: string
): Promise<{ contactId: string }> {
  const payload = {
    role: "user",
    external_id: contact.shop,
    email: contact.email,
    name: contact.name ?? contact.shop,
    custom_attributes: {
      shop_domain: contact.shop,
      plan: contact.plan ?? "hobby",
      ...contact.customAttributes,
    },
    signed_up_at: contact.createdAt ?? Math.floor(Date.now() / 1000),
  };

  const result = (await intercomRequest(
    "/contacts",
    "POST",
    payload,
    accessToken
  )) as { id: string };

  return { contactId: result.id };
}

/**
 * Track an Intercom event for a contact.
 */
export async function trackIntercomEvent(
  event: IntercomEvent,
  accessToken: string
): Promise<void> {
  await intercomRequest(
    "/events",
    "POST",
    {
      event_name: event.eventName,
      created_at: event.createdAt,
      user_id: event.userId,
      metadata: event.metadata ?? {},
    },
    accessToken
  );
}

// ---------------------------------------------------------------------------
// App/installed hook — creates Intercom contact
// ---------------------------------------------------------------------------

export interface MerchantInstalledPayload {
  shop: string;
  email: string;
  shopName?: string;
  plan?: string;
}

/**
 * Handle app/installed by creating an Intercom contact.
 * Should be called from the webhook handler's waitUntil() processing.
 */
export async function handleMerchantInstalled(
  payload: MerchantInstalledPayload,
  env: SupportEnv
): Promise<void> {
  if (!env.INTERCOM_ACCESS_TOKEN) {
    log({
      shop: payload.shop,
      step: "support.handleMerchantInstalled",
      status: "warn",
      error: "INTERCOM_ACCESS_TOKEN not configured — skipping contact creation",
    });
    return;
  }

  try {
    const { contactId } = await createIntercomContact(
      {
        shop: payload.shop,
        email: payload.email,
        name: payload.shopName,
        plan: payload.plan,
        createdAt: Math.floor(Date.now() / 1000),
      },
      env.INTERCOM_ACCESS_TOKEN
    );

    await trackIntercomEvent(
      {
        userId: payload.shop,
        eventName: "app_installed",
        createdAt: Math.floor(Date.now() / 1000),
        metadata: { plan: payload.plan ?? "hobby" },
      },
      env.INTERCOM_ACCESS_TOKEN
    );

    log({
      shop: payload.shop,
      step: "support.handleMerchantInstalled",
      status: "ok",
      contactId,
    });
  } catch (err) {
    log({
      shop: payload.shop,
      step: "support.handleMerchantInstalled",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    // Non-fatal — don't throw; support integration failure must not block install
  }
}

// ---------------------------------------------------------------------------
// Canned response retrieval
// ---------------------------------------------------------------------------

export function getCannedResponse(key: CannedResponseKey): CannedResponse {
  return CANNED_RESPONSES[key];
}

export function getAllCannedResponses(): Record<
  CannedResponseKey,
  CannedResponse
> {
  return CANNED_RESPONSES;
}

// ---------------------------------------------------------------------------
// Support configuration constants (for documentation / listing description)
// ---------------------------------------------------------------------------

export const SUPPORT_CONFIG = {
  /** First-response SLA in hours — shown in app listing description */
  firstResponseSlaHours: 24,

  /** Support email alias that forwards to Intercom inbox */
  supportEmailAlias: "support@mailcraft-app.com",

  /** Intercom inbox email (target of alias forwarding) */
  intercomInboxEmail: "mailcraft@intercom-mail.com",

  /** All canned response keys */
  cannedResponseKeys: [
    "images_not_generating",
    "background_removal_wrong",
    "template_colors_mismatch",
    "quota_exceeded",
    "billing_question",
  ] as CannedResponseKey[],
} as const;
