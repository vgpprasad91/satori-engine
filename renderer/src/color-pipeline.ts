/**
 * color-pipeline.ts — Single source of truth for all color resolution.
 *
 * All render paths (handleSingleRender, SatoriDO.render) import from here.
 * Consolidating this eliminates the 4-layer color scatter that caused repeated
 * regression cycles (index.ts inline → vertical-aesthetics.ts → design-tokens.ts
 * → email-generator.ts inline — each with slightly different fallback logic).
 *
 * Contract:
 *   brandUrl  → extractBrandColorFn() → primaryColor
 *   primaryColor + variant → resolveVerticalContext() → palette + canvas
 *   canvas + palette → paletteText() → ptxt, pbody, pmuted
 *   canvasBg luminance → accent overlay rgba
 *
 * The caller passes `extractBrandColorFn` to avoid circular imports between
 * color-pipeline.ts and the crypto utilities in index.ts.  Dependency injection
 * also makes this unit-testable without a KV binding.
 */

import {
  resolveVerticalContext,
  paletteText,
  luminance,
  VERTICAL_FALLBACK_COLOR,
  VARIANT_VERTICAL,
  inferVerticalFromVariantName,
  type VerticalContext,
  type ColorPalette,
  type AestheticRegister,
  type BgStyle,
} from './vertical-aesthetics'

// ── Public types ──────────────────────────────────────────────────────────────

export interface ResolvedColors {
  /** The resolved hex primary color (from explicit value, brand URL extraction, or vertical fallback). */
  primary:   string
  /** Full 6-tone palette derived from `primary` via HSL arithmetic. */
  palette:   ColorPalette
  /** The canvas background hex for this vertical + primary combination. */
  canvasBg:  string
  /** True when the canvas is dark (darkCinematic, techTerminal, financeCanvas, etc.). */
  isDark:    boolean
  /** WCAG AA headline text color (≥4.5:1 on canvasBg, most prominent brand tone). */
  ptxt:      string
  /** WCAG AA body text color (≥4.5:1 on canvasBg, one palette step softer than ptxt). */
  pbody:     string
  /** WCAG AA muted text color (≥3.0:1 on canvasBg, deliberately secondary). */
  pmuted:    string
  /** Accent overlay rgba — dark tint on light canvas, light tint on dark canvas. */
  accent:    string
  /** Typographic aesthetic register (font family + weight personality). */
  aesthetic: AestheticRegister
  /** Resolved vertical key (e.g. "food", "saas", "fitness"). */
  vertical:  string
  /** Background layer style key (e.g. "darkCinematic", "warmWash"). */
  bgStyle:   BgStyle
  /**
   * Raw VerticalContext for callers that need buildSmartBgLayers / buildDecorativeAccents.
   * Contains the same data as the fields above plus the `txt`/`muted`/`accent` aliases.
   * Do not use ctx.txt / ctx.muted in new code — use ptxt / pmuted from this struct.
   */
  ctx:       VerticalContext
}

/** Callback type for brand-color extraction — mirrors extractBrandColor in index.ts. */
export type BrandExtractFn = (
  url: string,
  kv?: KVNamespace | undefined,
) => Promise<{ color: string; source: string }>

export interface ResolveColorsOpts {
  /** Explicit brand primary color (hex). Takes priority over all other sources. */
  primaryColor?: string
  /** Brand homepage URL. Triggers extraction if primaryColor is not set. */
  brandUrl?: string
  /** Card variant name — drives vertical lookup and fallback color selection. */
  variant?: string
  /** KV namespace passed to the extraction callback (optional — skips extraction if absent). */
  kv?: KVNamespace
  /**
   * Async function that extracts a primary color from a brand URL.
   * Pass `extractBrandColor` from index.ts.  Omit to skip URL extraction.
   */
  extractBrandColorFn?: BrandExtractFn
  /**
   * Explicit aesthetic register override.
   * If omitted, the per-vertical default is used.
   */
  aesthetic?: string
}

// ── Core resolution function ──────────────────────────────────────────────────

/**
 * Resolve the complete color set for a single render call.
 *
 * This is the ONE place where the color resolution chain is defined.
 * Every render path calls this function; none inline their own color logic.
 *
 * Resolution order:
 *  1. Explicit `primaryColor` → used as-is.
 *  2. `brandUrl` → call `extractBrandColorFn` → extracted hex.
 *  3. Extraction fails / no brandUrl → per-vertical premium editorial fallback.
 *     (VERTICAL_FALLBACK_COLOR — never AI-purple #6C63FF)
 *  4. resolveVerticalContext() → palette + canvas + text colors.
 *  5. Derive accent overlay from canvas luminance.
 */
export async function resolveColors(opts: ResolveColorsOpts): Promise<ResolvedColors> {
  const variant = opts.variant ?? 'editorial-hero'

  // ── Step 1–3: resolve primaryColor ────────────────────────────────────────

  let primary = opts.primaryColor ?? ''

  if (!primary && opts.brandUrl && opts.extractBrandColorFn) {
    try {
      const extracted = await opts.extractBrandColorFn(opts.brandUrl, opts.kv)
      if (extracted.color) primary = extracted.color
    } catch {
      // Extraction threw — fall through to vertical fallback below
    }
  }

  if (!primary) {
    // Per-vertical premium editorial fallback — deterministic, never AI-purple.
    const v = VARIANT_VERTICAL[variant] ?? inferVerticalFromVariantName(variant) ?? 'general'
    primary = VERTICAL_FALLBACK_COLOR[v] ?? VERTICAL_FALLBACK_COLOR['general']!
  }

  return resolveColorsFromPrimary(primary, variant, opts.aesthetic)
}

// ── Synchronous variant ───────────────────────────────────────────────────────

/**
 * Synchronous variant for contexts where primaryColor is already known
 * (e.g. inside a Durable Object after brand URL extraction is complete).
 */
export function resolveColorsSync(opts: {
  primaryColor: string
  variant?: string
  aesthetic?: string
}): ResolvedColors {
  return resolveColorsFromPrimary(opts.primaryColor, opts.variant, opts.aesthetic)
}

// ── Canonical text-color helper ───────────────────────────────────────────────

/**
 * Compute ptxt/pbody/pmuted for a given canvas background and palette.
 *
 * This is the SINGLE place that calls paletteText() for all three text roles.
 * Both resolveColorsFromPrimary() and buildCardJSX() should call this function
 * rather than making three independent paletteText() calls. Using a shared
 * function eliminates the dual-computation gap (Gap 3): if the canvas-bg ever
 * diverges between the two call sites, the invariant Check 7 catches it because
 * it compares resolveTextColors() against direct paletteText() output.
 */
export function resolveTextColors(
  ptxtBg:  string,
  palette: ColorPalette,
): { ptxt: string; pbody: string; pmuted: string } {
  return {
    ptxt:   paletteText(ptxtBg, palette, 'headline'),
    pbody:  paletteText(ptxtBg, palette, 'body'),
    pmuted: paletteText(ptxtBg, palette, 'muted'),
  }
}

// ── Shared implementation ─────────────────────────────────────────────────────

function resolveColorsFromPrimary(
  primary: string,
  variant?: string,
  aesthetic?: string,
): ResolvedColors {
  const v = variant ?? 'editorial-hero'

  // Full vertical context (palette, canvas, headline text, muted text, accent)
  const ctx = resolveVerticalContext(v, primary, aesthetic)

  // Resolve all three text roles through the canonical helper.
  // resolveTextColors() is the single-call-site for paletteText — this ensures
  // color-pipeline.ts and buildCardJSX use the same code path (Gap 3 fix).
  const { ptxt, pbody, pmuted } = resolveTextColors(ctx.canvasBg, ctx.palette)

  // Accent overlay — dark on light canvas, light on dark canvas.
  const accent = luminance(ctx.canvasBg) > 0.55
    ? 'rgba(0,0,0,0.10)'
    : 'rgba(255,255,255,0.18)'

  const vertical = VARIANT_VERTICAL[v] ?? inferVerticalFromVariantName(v) ?? 'general'

  return {
    primary,
    palette:   ctx.palette,
    canvasBg:  ctx.canvasBg,
    isDark:    ctx.isDark,
    ptxt,    // headline — WCAG AA, most prominent brand tone
    pbody,   // body    — WCAG AA, one step softer for hierarchy
    pmuted,  // muted   — WCAG AA at 3.0:1, deliberately secondary
    accent,
    aesthetic: ctx.aesthetic,
    vertical,
    bgStyle:   ctx.bgStyle,
    ctx,     // raw context for buildSmartBgLayers / buildDecorativeAccents
  }
}
