/**
 * PR-023: Template editor — brand kit customisation
 *
 * Server-side logic:
 *  - getTemplateBrandKit  — read brand kit from KV (with defaults)
 *  - saveTemplateBrandKit — persist brand kit to KV
 *  - uploadLogoToR2       — upload logo buffer to R2, return key
 *  - getLogoUrl           — return R2 public URL for logo
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateBrandKit {
  primaryColor: string;   // hex e.g. "#0052CC"
  fontFamily: string;     // e.g. "Inter"
  logoR2Key: string | null;
  logoUrl: string | null;
}

export const DEFAULT_BRAND_KIT: TemplateBrandKit = {
  primaryColor: "#0052CC",
  fontFamily: "Inter",
  logoR2Key: null,
  logoUrl: null,
};

export const TEMPLATE_BRAND_KIT_KEY_PREFIX = "brandkit:" as const;

// ---------------------------------------------------------------------------
// Supported fonts (kept in sync with Satori renderer)
// ---------------------------------------------------------------------------

export const TEMPLATE_FONTS = [
  "Inter",
  "Playfair Display",
  "Cormorant Garamond",
  "Dancing Script",
  "Bebas Neue",
] as const;

export type TemplateFont = (typeof TEMPLATE_FONTS)[number];

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

export const EDITOR_TEMPLATES = [
  {
    id: "product-card",
    name: "Product Card",
    thumbnail: "/templates/product-card.png",
  },
  {
    id: "sale-announcement",
    name: "Sale Announcement",
    thumbnail: "/templates/sale-announcement.png",
  },
  {
    id: "new-arrival",
    name: "New Arrival",
    thumbnail: "/templates/new-arrival.png",
  },
  {
    id: "story-format",
    name: "Story Format",
    thumbnail: "/templates/story-format.png",
  },
  {
    id: "landscape-post",
    name: "Landscape Post",
    thumbnail: "/templates/landscape-post.png",
  },
  {
    id: "square-post",
    name: "Square Post",
    thumbnail: "/templates/square-post.png",
  },
  {
    id: "price-drop",
    name: "Price Drop",
    thumbnail: "/templates/price-drop.png",
  },
  {
    id: "seasonal",
    name: "Seasonal",
    thumbnail: "/templates/seasonal.png",
  },
] as const;

export type EditorTemplateId = (typeof EDITOR_TEMPLATES)[number]["id"];

// ---------------------------------------------------------------------------
// KV key
// ---------------------------------------------------------------------------

export function templateBrandKitKey(shop: string): string {
  return `${TEMPLATE_BRAND_KIT_KEY_PREFIX}${shop}`;
}

// ---------------------------------------------------------------------------
// getTemplateBrandKit — returns DEFAULT_BRAND_KIT when nothing is stored
// ---------------------------------------------------------------------------

export async function getTemplateBrandKit(
  shop: string,
  kv: KVNamespace
): Promise<TemplateBrandKit> {
  const raw = await kv.get(templateBrandKitKey(shop));
  if (!raw) return { ...DEFAULT_BRAND_KIT };
  return JSON.parse(raw) as TemplateBrandKit;
}

// ---------------------------------------------------------------------------
// saveTemplateBrandKit
// ---------------------------------------------------------------------------

export async function saveTemplateBrandKit(
  shop: string,
  brandKit: TemplateBrandKit,
  kv: KVNamespace
): Promise<void> {
  await kv.put(templateBrandKitKey(shop), JSON.stringify(brandKit), {
    expirationTtl: 365 * 24 * 60 * 60, // 1 year
  });

  log({ shop, step: "templates.brand_kit.saved", status: "ok" });
}

// ---------------------------------------------------------------------------
// uploadLogoToR2 — store logo bytes, return R2 key
// ---------------------------------------------------------------------------

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

  log({ shop, step: "templates.logo.uploaded", status: "ok", r2Key: key });

  return key;
}

// ---------------------------------------------------------------------------
// getLogoUrl — returns public URL for the stored logo, or null
// ---------------------------------------------------------------------------

export function getLogoUrl(
  shop: string,
  appUrl: string,
  brandKit: TemplateBrandKit
): string | null {
  if (!brandKit.logoR2Key) return null;
  return `${appUrl}/r2/${brandKit.logoR2Key}`;
}
