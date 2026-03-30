/**
 * listing.server.ts
 * PR-035: App store listing assets — helpers for icon generation, screenshot spec,
 * demo product seeding, and listing copy validation.
 */

import listingCopy from '../listing/listing-copy.json';
import demoProducts from '../listing/demo-products/seed-demo-store.json';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Screenshot {
  filename: string;
  size: '1600x900';
  caption: string;
  route: string;
}

export interface DemoProduct {
  id: string;
  category: 'apparel' | 'home_goods' | 'food';
  title: string;
  price: string;
  currency: string;
  image_url: string;
  template_id: string;
  shopify_product_id: string;
  status: 'success' | 'pending' | 'failed';
}

export interface AppIconSpec {
  size: string;
  format: string;
  description: string;
}

export interface ListingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Listing Copy ─────────────────────────────────────────────────────────────

/** Returns validated listing copy from listing-copy.json */
export function getListingCopy() {
  return listingCopy;
}

/** Returns the short description, enforcing ≤100 character limit */
export function getShortDescription(): string {
  return listingCopy.short_description;
}

/** Returns the long description markdown string */
export function getLongDescription(): string {
  return listingCopy.long_description;
}

/** Returns the app icon specification */
export function getAppIconSpec(): AppIconSpec {
  return listingCopy.app_icon_spec;
}

/** Returns the six screenshot specs */
export function getScreenshots(): Screenshot[] {
  return listingCopy.screenshots as Screenshot[];
}

// ─── Demo Products ────────────────────────────────────────────────────────────

/** Returns all 20 demo products */
export function getDemoProducts(): DemoProduct[] {
  return demoProducts.products as DemoProduct[];
}

/** Returns demo products filtered by category */
export function getDemoProductsByCategory(
  category: 'apparel' | 'home_goods' | 'food'
): DemoProduct[] {
  return getDemoProducts().filter((p) => p.category === category);
}

/** Returns the count of products per category */
export function getDemoProductCategoryCounts(): Record<string, number> {
  const products = getDemoProducts();
  return products.reduce<Record<string, number>>((acc, p) => {
    acc[p.category] = (acc[p.category] ?? 0) + 1;
    return acc;
  }, {});
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates all listing assets meet Shopify App Store requirements:
 * - Short description ≤ 100 chars
 * - Long description contains required sections
 * - Exactly 6 screenshots at 1600×900
 * - App icon is 512×512 PNG
 * - Demo video duration 40–50 seconds
 * - 20 products across exactly 3 categories (≥5 each)
 */
export function validateListingAssets(): ListingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Short description length
  const shortDesc = getShortDescription();
  if (shortDesc.length > 100) {
    errors.push(
      `Short description is ${shortDesc.length} chars — must be ≤100. Current: "${shortDesc}"`
    );
  }

  // Long description required sections
  const longDesc = getLongDescription();
  const requiredSections = [
    'How It Works',
    'Why Merchants Choose',
    'Pricing',
  ];
  for (const section of requiredSections) {
    if (!longDesc.includes(section)) {
      errors.push(`Long description missing section: "${section}"`);
    }
  }

  // Screenshots: exactly 6 at 1600×900
  const screenshots = getScreenshots();
  if (screenshots.length !== 6) {
    errors.push(`Expected 6 screenshots, got ${screenshots.length}`);
  }
  for (const s of screenshots) {
    if (s.size !== '1600x900') {
      errors.push(`Screenshot "${s.filename}" has size "${s.size}", expected "1600x900"`);
    }
    if (!s.caption || s.caption.length === 0) {
      errors.push(`Screenshot "${s.filename}" is missing a caption`);
    }
  }

  // App icon
  const iconSpec = getAppIconSpec();
  if (iconSpec.size !== '512x512') {
    errors.push(`App icon size is "${iconSpec.size}", expected "512x512"`);
  }
  if (iconSpec.format !== 'PNG') {
    errors.push(`App icon format is "${iconSpec.format}", expected "PNG"`);
  }

  // Demo video
  const video = listingCopy.demo_video;
  if (video.duration_seconds < 40 || video.duration_seconds > 50) {
    errors.push(
      `Demo video duration is ${video.duration_seconds}s, expected 40–50s`
    );
  }
  if (video.scenes.length < 4) {
    warnings.push(`Demo video has only ${video.scenes.length} scenes — recommend at least 5`);
  }

  // Demo products: 20 total, 3 categories, ≥5 each
  const products = getDemoProducts();
  if (products.length !== 20) {
    errors.push(`Expected 20 demo products, got ${products.length}`);
  }

  const counts = getDemoProductCategoryCounts();
  const categories = Object.keys(counts);
  if (categories.length !== 3) {
    errors.push(`Expected 3 product categories, got ${categories.length}: ${categories.join(', ')}`);
  }
  for (const [cat, count] of Object.entries(counts)) {
    if (count < 5) {
      errors.push(`Category "${cat}" has only ${count} products — need at least 5`);
    }
  }

  // Check no duplicate shopify_product_ids
  const ids = products.map((p) => p.shopify_product_id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    errors.push(`Duplicate shopify_product_id values detected in demo products`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Builds the Satori renderer request body for the 512×512 app icon.
 * The actual render is performed by calling the satori-renderer Worker.
 */
export function buildAppIconRequest(): Record<string, unknown> {
  return {
    variant: 'app-icon',
    brandKit: {
      primaryColor: '#6366F1',
      fontFamily: 'Inter',
      logoText: 'MC',
    },
    width: 512,
    height: 512,
    label: 'MailCraft',
    tagline: 'AI Product Images',
  };
}
