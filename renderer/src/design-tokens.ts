/**
 * Design token helpers — decorative accents + brand badge.
 *
 * All functions return plain Satori-compatible JSX-object nodes.
 * No linear-gradient, no clip-path, no filter/blur — only what Satori supports:
 * position:absolute, borderRadius, border, opacity, overflow:hidden.
 *
 * Designed offline (per-vertical) and executed deterministically at render time.
 */

import type { BgStyle } from './vertical-aesthetics'

// ── Decorative accent geometry ─────────────────────────────────────────────────
// Returns 2-3 absolute-positioned nodes to be injected AFTER bg layers, BEFORE content.
// Each is z-index neutral — they sit above bg but below content (content is also absolute).

export function buildDecorativeAccents(
  bgStyle:      BgStyle,
  primaryColor: string,
  isDark:       boolean,
  w:            number,
  h:            number,
  s:            (v: number) => number,
): object[] {
  const faintWhite  = 'rgba(255,255,255,0.07)'
  const accentFaint = primaryColor  // opacity set per-node

  switch (bgStyle) {

    // ── Dark cinematic — media, gaming, web3, automotive, sports, fitness ──────
    // Corner bracket marks + horizontal scan line + large ring
    case 'darkCinematic': return [
      // Top-left L-bracket
      { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(20), width: s(36), height: s(3), background: accentFaint, opacity: 0.55 } } },
      { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(20), width: s(3), height: s(36), background: accentFaint, opacity: 0.55 } } },
      // Bottom-right L-bracket
      { type: 'div', props: { style: { position: 'absolute', bottom: s(20), right: s(20), width: s(36), height: s(3), background: accentFaint, opacity: 0.55 } } },
      { type: 'div', props: { style: { position: 'absolute', bottom: s(20), right: s(20), width: s(3), height: s(36), background: accentFaint, opacity: 0.55 } } },
      // Large outer ring (top-right, mostly off-canvas for depth)
      { type: 'div', props: { style: { position: 'absolute', top: -Math.round(w * 0.18), right: -Math.round(w * 0.18), width: Math.round(w * 0.55), height: Math.round(w * 0.55), borderRadius: '50%', border: `1px solid ${accentFaint}`, opacity: 0.18 } } },
      // Thin horizontal scan-line at 38% height
      { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.38), left: s(20), right: s(20), height: 1, background: faintWhite } } },
    ]

    // ── Mesh gradient — SaaS, general, ecommerce, social, education ───────────
    // Inset dashed border frame + bottom accent strip + small corner dot
    case 'meshGradient': return [
      // Inset dashed rectangle frame
      { type: 'div', props: { style: { position: 'absolute', top: s(12), left: s(12), right: s(12), bottom: s(12), border: `1px dashed ${primaryColor}`, borderRadius: s(4), opacity: 0.10 } } },
      // Accent rule line near bottom
      { type: 'div', props: { style: { position: 'absolute', bottom: s(28), left: s(48), width: s(48), height: s(3), background: primaryColor, opacity: 0.35, borderRadius: s(2) } } },
      // Small accent circle bottom-right corner
      { type: 'div', props: { style: { position: 'absolute', bottom: s(22), right: s(32), width: s(8), height: s(8), borderRadius: '50%', background: primaryColor, opacity: 0.45 } } },
      // Three dot cluster top-right
      { type: 'div', props: { style: { position: 'absolute', top: s(24), right: s(32), display: 'flex', gap: s(5) }, children: [
        { type: 'div', props: { style: { width: s(6), height: s(6), borderRadius: '50%', background: primaryColor, opacity: 0.25 } } },
        { type: 'div', props: { style: { width: s(6), height: s(6), borderRadius: '50%', background: primaryColor, opacity: 0.45 } } },
        { type: 'div', props: { style: { width: s(6), height: s(6), borderRadius: '50%', background: primaryColor, opacity: 0.65 } } },
      ] } },
    ]

    // ── Warm wash — food, lifestyle, events, nonprofit ─────────────────────────
    // Organic rounded pill divider + soft dot cluster + corner arc
    case 'warmWash': return [
      // Thick pill divider line (organic feel)
      { type: 'div', props: { style: { position: 'absolute', bottom: s(36), left: s(40), width: s(56), height: s(5), background: primaryColor, opacity: 0.40, borderRadius: s(3) } } },
      // Three small dots in a row
      { type: 'div', props: { style: { position: 'absolute', top: s(26), right: s(36), display: 'flex', gap: s(6) }, children: [
        { type: 'div', props: { style: { width: s(7), height: s(7), borderRadius: '50%', background: primaryColor, opacity: 0.20 } } },
        { type: 'div', props: { style: { width: s(7), height: s(7), borderRadius: '50%', background: primaryColor, opacity: 0.35 } } },
        { type: 'div', props: { style: { width: s(7), height: s(7), borderRadius: '50%', background: primaryColor, opacity: 0.55 } } },
      ] } },
      // Large off-canvas circle outline (bottom-left, organic arc)
      { type: 'div', props: { style: { position: 'absolute', bottom: -Math.round(h * 0.3), left: -Math.round(w * 0.08), width: Math.round(w * 0.45), height: Math.round(w * 0.45), borderRadius: '50%', border: `2px solid ${primaryColor}`, opacity: 0.10 } } },
    ]

    // ── Clean panel — HR, business, health, reviews, real estate ──────────────
    // Left sidebar accent line + corner square mark + bottom rule
    case 'cleanPanel': return [
      // Left vertical rule (inside padding — companion to the edge strip from bg)
      { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.12), left: s(42), width: s(2), height: Math.round(h * 0.76), background: primaryColor, opacity: 0.12, borderRadius: s(1) } } },
      // Top-right corner square mark
      { type: 'div', props: { style: { position: 'absolute', top: s(20), right: s(28), width: s(14), height: s(14), border: `2px solid ${primaryColor}`, opacity: 0.25, borderRadius: s(2) } } },
      // Bottom rule line
      { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(48), right: s(48), height: 1, background: primaryColor, opacity: 0.12 } } },
    ]

    // ── Paper texture — content, editorial ────────────────────────────────────
    // Large decorative numeral / drop-cap circle + double rule + margin dots
    case 'paperTexture': return [
      // Large ghost circle (drop-cap backdrop)
      { type: 'div', props: { style: { position: 'absolute', top: s(24), right: s(32), width: Math.round(h * 0.30), height: Math.round(h * 0.30), borderRadius: '50%', border: `1px solid ${primaryColor}`, opacity: 0.12 } } },
      // Double rule — companion to bg rules (slightly offset for rhythm)
      { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.14), left: Math.round(w * 0.06), right: Math.round(w * 0.06), height: 1, background: primaryColor, opacity: 0.10 } } },
      // Small left-margin dot column (editorial margin marks)
      { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.30), left: s(22), display: 'flex', flexDirection: 'column', gap: s(12) }, children: [
        { type: 'div', props: { style: { width: s(4), height: s(4), borderRadius: '50%', background: primaryColor, opacity: 0.25 } } },
        { type: 'div', props: { style: { width: s(4), height: s(4), borderRadius: '50%', background: primaryColor, opacity: 0.15 } } },
        { type: 'div', props: { style: { width: s(4), height: s(4), borderRadius: '50%', background: primaryColor, opacity: 0.08 } } },
      ] } },
    ]

    // ── Split panel — fashion, interior ───────────────────────────────────────
    // Circle badge on split seam + thin horizontal rules in light panel + corner mark
    case 'splitPanel': {
      const seam = Math.round(w * 0.58)
      return [
        // Circle badge centered on the split seam
        { type: 'div', props: { style: { position: 'absolute', top: '50%', left: seam - s(20), width: s(40), height: s(40), borderRadius: '50%', background: 'rgba(255,255,255,0.95)', border: `2px solid ${primaryColor}`, opacity: 0.85 } } },
        // Horizontal rule in light panel at 40%
        { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.40), left: s(32), width: Math.round(seam * 0.45), height: 1, background: primaryColor, opacity: 0.18 } } },
        // Horizontal rule in light panel at 65%
        { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.65), left: s(32), width: Math.round(seam * 0.30), height: 1, background: primaryColor, opacity: 0.10 } } },
        // Top-right corner mark in dark panel
        { type: 'div', props: { style: { position: 'absolute', top: s(20), right: s(24), width: s(24), height: s(3), background: 'rgba(255,255,255,0.35)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: s(20), right: s(24), width: s(3), height: s(24), background: 'rgba(255,255,255,0.35)' } } },
      ]
    }

    // ── Finance canvas — dark slate ────────────────────────────────────────────
    // Grid cross-hair + corner bracket + thin bottom accent strip
    case 'financeCanvas': return [
      // Vertical crosshair line
      { type: 'div', props: { style: { position: 'absolute', top: s(20), left: Math.round(w * 0.65), width: 1, height: Math.round(h * 0.55), background: primaryColor, opacity: 0.12 } } },
      // Top-left corner bracket
      { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(20), width: s(28), height: s(2), background: primaryColor, opacity: 0.50 } } },
      { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(20), width: s(2), height: s(28), background: primaryColor, opacity: 0.50 } } },
      // Bottom accent strip
      { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: s(3), background: primaryColor, opacity: 0.60 } } },
      // Small blinking-style cursor dot (top-right)
      { type: 'div', props: { style: { position: 'absolute', top: s(24), right: s(28), width: s(8), height: s(8), borderRadius: '50%', background: primaryColor, opacity: 0.70 } } },
    ]

    // ── Tech terminal — code / developer ──────────────────────────────────────
    // Terminal prompt + corner marks + vertical separator
    case 'techTerminal': return [
      // Terminal prompt area (top-left pill)
      { type: 'div', props: { style: { position: 'absolute', top: s(18), left: s(18), display: 'flex', alignItems: 'center', gap: s(6) }, children: [
        { type: 'div', props: { style: { width: s(10), height: s(10), borderRadius: '50%', background: '#ff5f57', opacity: 0.8 } } },
        { type: 'div', props: { style: { width: s(10), height: s(10), borderRadius: '50%', background: '#febc2e', opacity: 0.8 } } },
        { type: 'div', props: { style: { width: s(10), height: s(10), borderRadius: '50%', background: '#28c840', opacity: 0.8 } } },
      ] } },
      // Bottom-right corner bracket
      { type: 'div', props: { style: { position: 'absolute', bottom: s(18), right: s(18), width: s(28), height: s(2), background: primaryColor, opacity: 0.50 } } },
      { type: 'div', props: { style: { position: 'absolute', bottom: s(18), right: s(18), width: s(2), height: s(28), background: primaryColor, opacity: 0.50 } } },
      // Vertical separator (left-side code gutter line)
      { type: 'div', props: { style: { position: 'absolute', top: s(48), bottom: s(18), left: s(48), width: 1, background: primaryColor, opacity: 0.15 } } },
    ]

    default: return []
  }
}

// ── Brand badge / pill ─────────────────────────────────────────────────────────
// Returns a Satori node for the brand name — styled as a pill or badge
// rather than plain text, for a more polished "logo area" treatment.

export interface BrandBadgeOpts {
  brandName:    string
  primaryColor: string
  isDark:       boolean
  style:        'pill' | 'inline' | 'eyebrow'
  s:            (v: number) => number
  tk: {
    brandFamily:         string
    brandWeight:         number
    brandLetterSpacing:  number
    brandTransform:      'none' | 'uppercase' | 'capitalize'
  }
  logoData?:    string
}

export function buildBrandBadge(opts: BrandBadgeOpts): object {
  const { brandName, primaryColor, isDark, style, s, tk, logoData } = opts

  // If logo is available, always show logo instead
  if (logoData) {
    return { type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(120), opacity: 0.90 } } }
  }

  const textColor = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)'

  switch (style) {

    // Pill: brand name inside a rounded pill with border
    case 'pill':
      return {
        type: 'div', props: {
          style: {
            display: 'flex', alignItems: 'center',
            paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(12), paddingRight: s(12),
            borderRadius: s(20), border: `1px solid ${primaryColor}`,
            background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          },
          children: {
            type: 'div', props: {
              style: {
                fontSize: s(10), fontWeight: tk.brandWeight,
                letterSpacing: Math.min(tk.brandLetterSpacing, 3) * (s(1) / s(1)),
                textTransform: tk.brandTransform, fontFamily: tk.brandFamily,
                color: primaryColor,
              },
              children: brandName.toUpperCase(),
            },
          },
        },
      }

    // Eyebrow: brand name with a short colored rule before it
    case 'eyebrow':
      return {
        type: 'div', props: {
          style: { display: 'flex', alignItems: 'center', gap: s(10) },
          children: [
            { type: 'div', props: { style: { width: s(28), height: s(2), background: primaryColor, borderRadius: s(1) } } },
            { type: 'div', props: {
              style: {
                fontSize: s(10), fontWeight: tk.brandWeight,
                letterSpacing: Math.min(tk.brandLetterSpacing, 4) * (s(1) / s(1)),
                textTransform: tk.brandTransform, fontFamily: tk.brandFamily,
                color: primaryColor,
              },
              children: brandName.toUpperCase(),
            } },
          ],
        },
      }

    // Inline: simple styled text (existing behavior, improved color)
    case 'inline':
    default:
      return {
        type: 'div', props: {
          style: {
            fontSize: s(11), fontWeight: tk.brandWeight,
            letterSpacing: Math.min(tk.brandLetterSpacing, 4) * (s(1) / s(1)),
            textTransform: tk.brandTransform, fontFamily: tk.brandFamily,
            color: textColor,
          },
          children: brandName,
        },
      }
  }
}

// ── Stat circle badge ──────────────────────────────────────────────────────────
// Wraps a stat value in a circular badge for dramatic visual emphasis.

export function buildStatBadge(
  statValue:    string,
  primaryColor: string,
  isDark:       boolean,
  w:            number,
  h:            number,
  s:            (v: number) => number,
): object {
  const diameter   = Math.min(Math.round(Math.min(w, h) * 0.52), s(240))
  const fontSize   = Math.round(diameter * 0.28)
  const bg         = primaryColor
  // WCAG 2.1 contrast — badge background is always primaryColor
  const toLin = (v: number) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  const hex6  = (primaryColor.startsWith('#') ? primaryColor : '#000000').replace('#', '').padEnd(6, '0')
  const lum   = 0.2126 * toLin(parseInt(hex6.slice(0, 2), 16) / 255)
             + 0.7152 * toLin(parseInt(hex6.slice(2, 4), 16) / 255)
             + 0.0722 * toLin(parseInt(hex6.slice(4, 6), 16) / 255)
  const textColor  = lum <= 0.18 ? '#ffffff' : '#111111'

  return {
    type: 'div', props: {
      style: {
        width: diameter, height: diameter, borderRadius: '50%',
        background: bg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0,
      },
      children: {
        type: 'div', props: {
          style: {
            fontSize, fontWeight: 900, color: textColor,
            fontFamily: 'Inter', lineHeight: 1, letterSpacing: -1,
          },
          children: statValue,
        },
      },
    },
  }
}
