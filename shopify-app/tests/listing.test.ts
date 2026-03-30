/**
 * listing.test.ts
 * PR-035: App store listing assets — unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  getShortDescription,
  getLongDescription,
  getScreenshots,
  getAppIconSpec,
  getDemoProducts,
  getDemoProductsByCategory,
  getDemoProductCategoryCounts,
  validateListingAssets,
  buildAppIconRequest,
} from '../src/listing.server';

// ─── Short description ────────────────────────────────────────────────────────

describe('getShortDescription', () => {
  it('returns a non-empty string', () => {
    const desc = getShortDescription();
    expect(typeof desc).toBe('string');
    expect(desc.length).toBeGreaterThan(0);
  });

  it('is at most 100 characters', () => {
    const desc = getShortDescription();
    expect(desc.length).toBeLessThanOrEqual(100);
  });
});

// ─── Long description ─────────────────────────────────────────────────────────

describe('getLongDescription', () => {
  it('contains "How It Works" section', () => {
    expect(getLongDescription()).toContain('How It Works');
  });

  it('contains differentiators section', () => {
    expect(getLongDescription()).toContain('Why Merchants Choose');
  });

  it('contains pricing section', () => {
    expect(getLongDescription()).toContain('Pricing');
  });

  it('mentions all three plans', () => {
    const desc = getLongDescription();
    expect(desc).toContain('Hobby');
    expect(desc).toContain('Pro');
    expect(desc).toContain('Business');
  });
});

// ─── Screenshots ──────────────────────────────────────────────────────────────

describe('getScreenshots', () => {
  it('returns exactly 6 screenshots', () => {
    expect(getScreenshots()).toHaveLength(6);
  });

  it('all screenshots are 1600x900', () => {
    for (const s of getScreenshots()) {
      expect(s.size).toBe('1600x900');
    }
  });

  it('all screenshots have captions', () => {
    for (const s of getScreenshots()) {
      expect(s.caption.length).toBeGreaterThan(0);
    }
  });

  it('all screenshots have unique filenames', () => {
    const names = getScreenshots().map((s) => s.filename);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers all required screens', () => {
    const routes = getScreenshots().map((s) => s.route);
    expect(routes).toContain('/app');
    expect(routes).toContain('/app/templates');
    expect(routes).toContain('/app/products');
    expect(routes).toContain('/app/billing');
    expect(routes).toContain('/app/onboarding');
    expect(routes).toContain('/status');
  });
});

// ─── App icon ─────────────────────────────────────────────────────────────────

describe('getAppIconSpec', () => {
  it('is 512x512', () => {
    expect(getAppIconSpec().size).toBe('512x512');
  });

  it('is PNG format', () => {
    expect(getAppIconSpec().format).toBe('PNG');
  });
});

// ─── Demo products ────────────────────────────────────────────────────────────

describe('getDemoProducts', () => {
  it('returns exactly 20 products', () => {
    expect(getDemoProducts()).toHaveLength(20);
  });

  it('all products have required fields', () => {
    for (const p of getDemoProducts()) {
      expect(p.id).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.price).toBeTruthy();
      expect(p.image_url).toBeTruthy();
      expect(p.shopify_product_id).toBeTruthy();
      expect(p.template_id).toBeTruthy();
    }
  });

  it('all products have valid status', () => {
    const validStatuses = ['success', 'pending', 'failed'];
    for (const p of getDemoProducts()) {
      expect(validStatuses).toContain(p.status);
    }
  });

  it('no duplicate shopify_product_ids', () => {
    const ids = getDemoProducts().map((p) => p.shopify_product_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getDemoProductsByCategory', () => {
  it('returns only apparel products', () => {
    const apparel = getDemoProductsByCategory('apparel');
    expect(apparel.every((p) => p.category === 'apparel')).toBe(true);
    expect(apparel.length).toBeGreaterThanOrEqual(5);
  });

  it('returns only home_goods products', () => {
    const home = getDemoProductsByCategory('home_goods');
    expect(home.every((p) => p.category === 'home_goods')).toBe(true);
    expect(home.length).toBeGreaterThanOrEqual(5);
  });

  it('returns only food products', () => {
    const food = getDemoProductsByCategory('food');
    expect(food.every((p) => p.category === 'food')).toBe(true);
    expect(food.length).toBeGreaterThanOrEqual(5);
  });
});

describe('getDemoProductCategoryCounts', () => {
  it('has exactly 3 categories', () => {
    const counts = getDemoProductCategoryCounts();
    expect(Object.keys(counts)).toHaveLength(3);
  });

  it('categories are apparel, home_goods, food', () => {
    const counts = getDemoProductCategoryCounts();
    expect(counts).toHaveProperty('apparel');
    expect(counts).toHaveProperty('home_goods');
    expect(counts).toHaveProperty('food');
  });

  it('all categories have at least 5 products', () => {
    const counts = getDemoProductCategoryCounts();
    for (const [, count] of Object.entries(counts)) {
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });

  it('counts sum to 20', () => {
    const counts = getDemoProductCategoryCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(20);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('validateListingAssets', () => {
  it('passes all validation checks', () => {
    const result = validateListingAssets();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns a result with valid, errors, and warnings fields', () => {
    const result = validateListingAssets();
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

// ─── App icon request ─────────────────────────────────────────────────────────

describe('buildAppIconRequest', () => {
  it('specifies 512×512 dimensions', () => {
    const req = buildAppIconRequest();
    expect(req.width).toBe(512);
    expect(req.height).toBe(512);
  });

  it('uses the correct brand color', () => {
    const req = buildAppIconRequest() as { brandKit: { primaryColor: string } };
    expect(req.brandKit.primaryColor).toBe('#6366F1');
  });

  it('includes variant field', () => {
    const req = buildAppIconRequest();
    expect(req.variant).toBe('app-icon');
  });
});
