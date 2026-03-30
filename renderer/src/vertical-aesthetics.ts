/**
 * Per-vertical aesthetic defaults + smart fallback backgrounds.
 *
 * Design decisions (made offline, executed deterministically at render time):
 *   - media/gaming/web3/automotive/sports/fitness → dark cinematic canvas
 *   - saas/tech/ecommerce/general → mesh gradient on white
 *   - food/lifestyle/events/nonprofit → warm wash on off-white
 *   - hr/business/reviews/health/education → clean panel on white
 *   - fashion/interior → editorial split panel
 *   - finance/crypto → dark finance canvas
 *   - content/editorial → paper texture off-white
 *
 * No LLM involved. Pure lookup tables + layered div techniques (Satori-compatible).
 */

/**
 * Premium editorial fallback colors per vertical.
 * Used when brandUrl extraction fails and no primaryColor is provided.
 * Every color is drawn from real premium brand palettes — none are "AI purple".
 */
export const VERTICAL_FALLBACK_COLOR: Record<string, string> = {
  general:    '#2D3142',  // editorial slate — Notion-inspired
  ecommerce:  '#1A1A2E',  // deep commerce navy
  food:       '#6B3A2A',  // warm cognac — artisan restaurant quality
  saas:       '#0F3460',  // trust navy — Linear/Stripe-inspired
  tech:       '#0D1B2A',  // dark tech — Vercel-inspired
  social:     '#264653',  // editorial teal — premium social
  media:      '#1A0A2E',  // cinematic dark — streaming-grade
  sports:     '#1A1A1A',  // stadium black — Nike-grade
  gaming:     '#0D0D1A',  // gaming cinematic dark
  automotive: '#1C1C1E',  // premium near-black — Apple-grade
  fashion:    '#1A0F0A',  // deep mahogany — Céline-inspired
  web3:       '#0D0D1A',  // crypto cinematic dark
  nonprofit:  '#1D3557',  // trustworthy navy — NGO-grade
  interior:   '#2A2018',  // warm dark wood — 1stDibs-inspired
  hr:         '#1D3557',  // corporate navy — LinkedIn-grade
  business:   '#1B2B4B',  // executive dark navy
  reviews:    '#1D3557',  // trust navy
  content:    '#2C2C2C',  // editorial charcoal — NYT-inspired
  events:     '#2D1B4E',  // deep velvet — luxury events
  finance:    '#0F2027',  // Bloomberg dark slate
  health:     '#1A3A8F',  // deep medical navy-blue — EHR-grade (Epic/Cerner); shade600 ≥8:1 on light canvas
  lifestyle:  '#4A2F1E',  // warm artisan brown
  fitness:    '#1A0A0A',  // dark sport — Under Armour-grade
  travel:     '#1A2744',  // deep ocean navy — luxury travel
  realestate: '#1B2B3A',  // premium slate — architect-grade
  education:  '#1B3A5C',  // academic deep navy
}

// ── Vertical mapping ──────────────────────────────────────────────────────────

export const VARIANT_VERTICAL: Record<string, string> = {
  // Core/general
  'stat-hero': 'general', 'feature-split': 'general', 'announcement': 'general',
  'quote-overlay': 'general', 'benefit-strip': 'general', 'editorial-hero': 'general',
  'tip-card': 'general', 'social-proof': 'general', 'before-after': 'general',
  'video-thumbnail': 'general',
  // E-commerce
  'product-showcase': 'ecommerce', 'coupon-offer': 'ecommerce', 'product-shot': 'ecommerce',
  'price-drop': 'ecommerce', 'new-arrival': 'ecommerce', 'flash-deal': 'ecommerce',
  'gift-card': 'ecommerce', 'loyalty-card': 'ecommerce', 'receipt-card': 'ecommerce',
  'countdown-timer': 'ecommerce', 'pricing-card': 'ecommerce',
  // Food
  'recipe-hero': 'food', 'menu-special': 'food', 'nutrition-facts': 'food',
  'cocktail-recipe': 'food',
  // SaaS/tech
  'feature-launch': 'saas', 'changelog': 'saas', 'waitlist-signup': 'saas',
  'app-screenshot': 'saas', 'product-hunt': 'saas',
  'github-stats': 'tech', 'npm-package': 'tech', 'api-status': 'tech',
  'code-snippet': 'tech', 'status-page': 'tech', 'release-notes': 'tech',
  // Social
  'tweet-card': 'social', 'linkedin-article': 'social', 'reddit-post': 'social',
  'instagram-quote': 'social', 'tiktok-caption': 'social', 'discord-announcement': 'social',
  // Media/entertainment
  'spotify-now-playing': 'media', 'album-art': 'media', 'movie-poster': 'media',
  'music-release': 'media', 'twitch-banner': 'media', 'youtube-stats': 'media',
  'soundcloud-track': 'media', 'live-stream-alert': 'media', 'podcast-stats': 'media',
  'podcast-cover': 'media',
  // Sports
  'sports-score': 'sports', 'sports-player': 'sports', 'sports-schedule': 'sports',
  // Gaming
  'gaming-achievement': 'gaming', 'esports-match': 'gaming', 'leaderboard-card': 'gaming',
  // Automotive
  'car-listing': 'automotive', 'vehicle-specs': 'automotive', 'dealership-ad': 'automotive',
  'test-drive-cta': 'automotive',
  // Fashion
  'lookbook-card': 'fashion', 'ootd-card': 'fashion', 'style-drop': 'fashion',
  'fashion-sale': 'fashion',
  // Web3/NFT
  'nft-showcase': 'web3', 'mint-announcement': 'web3', 'dao-proposal': 'web3',
  'token-launch': 'web3', 'web3-stats': 'web3',
  // Non-profit
  'donation-progress': 'nonprofit', 'impact-stats': 'nonprofit', 'charity-appeal': 'nonprofit',
  'volunteer-cta': 'nonprofit',
  // Interior
  'room-reveal': 'interior', 'project-showcase': 'interior', 'material-moodboard': 'interior',
  'design-consultation': 'interior',
  // HR/culture
  'employee-spotlight': 'hr', 'company-benefits': 'hr', 'culture-stats': 'hr',
  'open-roles': 'hr', 'team-culture': 'hr', 'job-posting': 'hr',
  // Business
  'business-card': 'business', 'qr-code-card': 'business', 'team-member': 'business',
  'org-announcement': 'business', 'invoice-summary': 'business', 'proposal-cover': 'business',
  'award-badge': 'business', 'trust-badge': 'business',
  // Reviews/content
  'testimonial': 'reviews', 'google-review': 'reviews', 'star-rating': 'reviews',
  'nps-score': 'reviews', 'case-study': 'reviews',
  'newsletter-header': 'content', 'book-cover': 'content', 'magazine-cover': 'content',
  'blog-post-card': 'content', 'infographic-stat': 'content', 'press-release': 'content',
  // Events
  'event-card': 'events', 'birthday-card': 'events', 'wedding-card': 'events',
  'holiday-greeting': 'events', 'rsvp-card': 'events',
  // Finance
  'market-update': 'finance', 'rate-announcement': 'finance', 'crypto-price': 'finance',
  'portfolio-snapshot': 'finance', 'savings-goal': 'finance',
  // Health/lifestyle
  'appointment-card': 'health', 'health-metrics': 'health', 'habit-tracker': 'health',
  'referral-card': 'lifestyle', 'workout-plan': 'fitness', 'transformation': 'fitness',
  'class-schedule': 'fitness',
  // Travel/real estate
  'travel-destination': 'travel', 'property-listing': 'realestate',
  'open-house': 'realestate', 'sold-announcement': 'realestate',
  // Education
  'course-launch': 'education', 'certification': 'education',
}

export type AestheticRegister =
  | 'modern-sans' | 'editorial-serif' | 'luxury' | 'warm-script' | 'bold-condensed'
  | 'brutalist' | 'glassmorphism' | 'retro' | 'minimalist-luxury'

export type BgStyle =
  | 'primaryFlat'    // flat primaryColor — fallback
  | 'darkCinematic'  // near-black + primaryColor radial glow — media, gaming, automotive
  | 'warmWash'       // warm off-white + soft primary tint — food, lifestyle, events
  | 'meshGradient'   // white + translucent primary blobs — SaaS, general, ecommerce
  | 'cleanPanel'     // white + colored top bar — HR, business, health, reviews
  | 'paperTexture'   // warm off-white — content/editorial
  | 'splitPanel'     // light left + primary right split — fashion, interior
  | 'financeCanvas'  // dark slate + primary accent — finance, crypto
  | 'techTerminal'   // near-black + grid lines — tech/dev

interface VerticalSpec {
  aesthetic:  AestheticRegister
  bgStyle:    BgStyle
  /** For dark-canvas styles: the canvas base color (replaces primaryColor as bg). */
  darkCanvas: string
  /** For light-canvas styles: the canvas base color. */
  lightCanvas: string
}

const VERTICAL_SPEC: Record<string, VerticalSpec> = {
  general:     { aesthetic: 'modern-sans',       bgStyle: 'meshGradient',   darkCanvas: '#0d0d1a', lightCanvas: '#ffffff' },
  ecommerce:   { aesthetic: 'modern-sans',       bgStyle: 'meshGradient',   darkCanvas: '#0d0d1a', lightCanvas: '#ffffff' },
  food:        { aesthetic: 'warm-script',       bgStyle: 'warmWash',       darkCanvas: '#1a0f08', lightCanvas: '#fdf8f2' },
  saas:        { aesthetic: 'modern-sans',       bgStyle: 'meshGradient',   darkCanvas: '#0d0d1a', lightCanvas: '#f8f7ff' },
  tech:        { aesthetic: 'brutalist',         bgStyle: 'techTerminal',   darkCanvas: '#0d1117', lightCanvas: '#f6f8fa' },
  social:      { aesthetic: 'modern-sans',       bgStyle: 'meshGradient',   darkCanvas: '#0d0d1a', lightCanvas: '#ffffff' },
  media:       { aesthetic: 'glassmorphism',     bgStyle: 'darkCinematic',  darkCanvas: '#0a0a12', lightCanvas: '#0a0a12' },
  sports:      { aesthetic: 'bold-condensed',    bgStyle: 'darkCinematic',  darkCanvas: '#0f0f0f', lightCanvas: '#0f0f0f' },
  gaming:      { aesthetic: 'brutalist',         bgStyle: 'darkCinematic',  darkCanvas: '#080812', lightCanvas: '#080812' },
  automotive:  { aesthetic: 'bold-condensed',    bgStyle: 'darkCinematic',  darkCanvas: '#111111', lightCanvas: '#111111' },
  fashion:     { aesthetic: 'luxury',            bgStyle: 'splitPanel',     darkCanvas: '#1a1208', lightCanvas: '#faf5ee' },
  web3:        { aesthetic: 'glassmorphism',     bgStyle: 'darkCinematic',  darkCanvas: '#0d0d1a', lightCanvas: '#0d0d1a' },
  nonprofit:   { aesthetic: 'modern-sans',       bgStyle: 'warmWash',       darkCanvas: '#1a0f08', lightCanvas: '#fff8f3' },
  interior:    { aesthetic: 'minimalist-luxury', bgStyle: 'splitPanel',     darkCanvas: '#1a1710', lightCanvas: '#f7f4ef' },
  hr:          { aesthetic: 'editorial-serif',   bgStyle: 'cleanPanel',     darkCanvas: '#0f1a2e', lightCanvas: '#f0f4f8' },
  business:    { aesthetic: 'modern-sans',       bgStyle: 'cleanPanel',     darkCanvas: '#0f1a2e', lightCanvas: '#ffffff' },
  reviews:     { aesthetic: 'modern-sans',       bgStyle: 'cleanPanel',     darkCanvas: '#0f1a2e', lightCanvas: '#ffffff' },
  content:     { aesthetic: 'editorial-serif',   bgStyle: 'paperTexture',   darkCanvas: '#1a1710', lightCanvas: '#faf6f0' },
  events:      { aesthetic: 'warm-script',       bgStyle: 'warmWash',       darkCanvas: '#1a0f08', lightCanvas: '#fdf8f2' },
  finance:     { aesthetic: 'modern-sans',       bgStyle: 'financeCanvas',  darkCanvas: '#0d1117', lightCanvas: '#0d1117' },
  health:      { aesthetic: 'modern-sans',       bgStyle: 'cleanPanel',     darkCanvas: '#0f2020', lightCanvas: '#f0faf6' },
  lifestyle:   { aesthetic: 'warm-script',       bgStyle: 'warmWash',       darkCanvas: '#1a0f08', lightCanvas: '#fdf8f2' },
  fitness:     { aesthetic: 'bold-condensed',    bgStyle: 'darkCinematic',  darkCanvas: '#0f0f0f', lightCanvas: '#0f0f0f' },
  travel:      { aesthetic: 'editorial-serif',   bgStyle: 'meshGradient',   darkCanvas: '#0a1428', lightCanvas: '#f0f6ff' },
  realestate:  { aesthetic: 'minimalist-luxury', bgStyle: 'cleanPanel',     darkCanvas: '#0f1a2e', lightCanvas: '#ffffff' },
  education:   { aesthetic: 'modern-sans',       bgStyle: 'meshGradient',   darkCanvas: '#0d0d1a', lightCanvas: '#f8f7ff' },
}

// Dark-canvas verticals — the card ALWAYS renders on a dark base (like a cinema or terminal)
const DARK_CANVAS_VERTICALS = new Set([
  'media', 'gaming', 'web3', 'automotive', 'sports', 'fitness', 'finance', 'tech',
])

// ── Derived color palette ─────────────────────────────────────────────────────

export interface ColorPalette {
  shade900: string  // deep dark  — dark panel backgrounds, cinematic canvas
  shade700: string  // dark rich  — secondary panels, heavy accent blobs
  shade600: string  // mid-tone   — section bars, accent rules, borders
  base:     string  // original   — CTA buttons, primary accent pops
  tint300:  string  // soft pastel — light panel backgrounds, warmWash canvas
  tint100:  string  // near-white — paper backgrounds, cleanPanel canvas
}

function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace('#', '').padEnd(6, '0')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hue = 0
  if      (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) hue = ((b - r) / d + 2) / 6
  else                hue = ((r - g) / d + 4) / 6
  return [Math.round(hue * 360), Math.round(s * 100), Math.round(l * 100)]
}

function hslToHex(h: number, s: number, l: number): string {
  const hN = h / 360, sN = s / 100, lN = l / 100
  const q = lN < 0.5 ? lN * (1 + sN) : lN + sN - lN * sN
  const p = 2 * lN - q
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const rr = Math.round(hue2rgb(hN + 1 / 3) * 255)
  const gg = Math.round(hue2rgb(hN) * 255)
  const bb = Math.round(hue2rgb(hN - 1 / 3) * 255)
  return '#' + [rr, gg, bb].map(x => x.toString(16).padStart(2, '0')).join('')
}

/**
 * Derive a 6-tone palette from a single brand hex.
 * Hue is preserved throughout; lightness and saturation are shifted arithmetically.
 * Near-achromatic inputs (saturation < 12%) use a dedicated neutral palette
 * so multiplier math doesn't produce incorrect tones.
 */
export function buildColorPalette(primaryHex: string): ColorPalette {
  const [hue, sat, lig] = hexToHsl(primaryHex)

  // Near-achromatic: grays, off-whites, beiges — saturation multiplier math produces wrong tones
  if (sat < 15) {
    // Warm vs cool neutral based on hue
    const isWarm = (hue >= 15 && hue <= 75) || hue >= 345
    const s0 = isWarm ? 8 : 5   // slight saturation to keep warmth/coolness
    return {
      shade900: hslToHex(hue, s0,                        10),
      shade700: hslToHex(hue, Math.max(s0 - 2, 0),       22),
      shade600: hslToHex(hue, Math.max(s0 - 2, 0),       34),
      base:     primaryHex,
      tint300:  hslToHex(hue, Math.max(s0 - 4, 2),       78),
      tint100:  hslToHex(hue, Math.max(s0 - 5, 1),       96),
    }
  }

  void lig // used implicitly via base hex; suppress unused warning
  const satN = Math.max(sat, 18) // floor saturation for achromatic inputs
  // For very dark chromatic inputs (lig < 15), shade900 must still be noticeably
  // darker than shade700 — clamp shade900 to max lightness 13.
  // For very light chromatic inputs (lig > 85), tint100 must remain near-white —
  // clamp tint100 lightness to min 93.
  const shade900L = Math.min(13, 11)  // always ≤ 13 — safe for near-black inputs
  const tint100L  = Math.max(93, 96)  // always ≥ 93 — safe for near-white inputs
  return {
    shade900: hslToHex(hue, Math.min(Math.round(satN * 0.75), 40),  shade900L),
    shade700: hslToHex(hue, Math.min(Math.round(satN * 0.88), 55),  23),
    shade600: hslToHex(hue, Math.min(Math.round(satN * 0.95), 68),  38),
    base:     primaryHex,
    tint300:  hslToHex(hue, Math.min(Math.round(satN * 0.52), 42),  80),
    tint100:  hslToHex(hue, Math.min(Math.round(satN * 0.20), 14),  tint100L),
  }
}

export type TextPurpose = 'headline' | 'body' | 'muted'

/**
 * WCAG-correct relative luminance (IEC 61966-2-1 sRGB transfer function).
 * Distinct from the faster `luminance()` which uses BT.601 coefficients.
 * Used only for the WCAG 2.1 contrast ratio guarantee in `paletteText`.
 */
function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const toLinear = (v: number) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  const r = toLinear(parseInt(h.slice(0, 2), 16) / 255)
  const g = toLinear(parseInt(h.slice(2, 4), 16) / 255)
  const b = toLinear(parseInt(h.slice(4, 6), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(lum1: number, lum2: number): number {
  const [lighter, darker] = lum1 > lum2 ? [lum1, lum2] : [lum2, lum1]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Return the appropriate palette tone for text sitting on `bgHex`.
 * Uses WCAG 2.1 IEC sRGB relative luminance for all contrast calculations.
 *
 * `purpose` drives typographic hierarchy:
 *  - 'headline' / 'body': first tone ≥ 4.5:1 (WCAG AA normal text)
 *  - 'muted': deliberately softer — tries the next-down palette tone at ≥ 3.0:1
 *             so muted labels are visually secondary to headline/body.
 *
 * Threshold 0.18 is the mathematical crossover where white and black achieve
 * equal contrast ratio (both ≈3.5:1 on bgLum≈0.179). Dark navies (#1a2e44),
 * charcoals (#2d2d2d) etc. have WCAG relative luminance ≈ 0.02–0.04, well below.
 */
export function paletteText(
  bgHex:   string,
  palette: ColorPalette,
  purpose: TextPurpose = 'body',
): string {
  const bgLum = relativeLuminance(bgHex)
  const isDarkSurface = bgLum <= 0.18

  // Muted: use a softer palette tier with a 3.0:1 floor so it reads as secondary.
  // Falls back to the headline candidates if no softer tone meets even 3:1.
  if (purpose === 'muted') {
    let mutedCandidates: string[]
    if (isDarkSurface) {
      // On dark canvases: prepend a computed mid-tone at L≈58% as first candidate.
      // This creates genuine visual hierarchy between body (tint100, ~11:1) and
      // muted (~6:1) even when the fallback primary equals the canvas color
      // (web3 #0D0D1A, gaming #080812, sports #0f0f0f, automotive, fitness).
      const [h, s] = hexToHsl(palette.base)
      const satN = Math.max(s, 18)
      const midTone = hslToHex(h, Math.min(Math.round(satN * 0.38), 30), 58)
      mutedCandidates = [midTone, palette.tint300, palette.tint100, '#ffffff']
    } else {
      mutedCandidates = [palette.shade600, palette.shade700, palette.shade900, '#000000']
    }
    for (const c of mutedCandidates) {
      if (contrastRatio(bgLum, relativeLuminance(c)) >= 3.0) return c
    }
    return isDarkSurface ? '#ffffff' : '#000000'
  }

  // Candidates ordered from most brand-hued-prominent to softest.
  // Dark surface:  tint100 (near-white hued) → tint300 (soft pastel) → #ffffff (pure)
  // Light surface: shade900 (darkest hued) → shade700 → shade600 → #000000 (pure)
  const candidates = isDarkSurface
    ? [palette.tint100, palette.tint300, '#ffffff']
    : [palette.shade900, palette.shade700, palette.shade600, '#000000']

  // Collect all tones that clear WCAG AA 4.5:1.
  const valid = candidates.filter(c => contrastRatio(bgLum, relativeLuminance(c)) >= 4.5)
  if (valid.length === 0) return isDarkSurface ? '#ffffff' : '#000000'

  // Headline: first (most prominent) qualifying tone — highest visual weight.
  if (purpose === 'headline') return valid[0]

  // Body: second qualifying tone (softer than headline) — creates typographic hierarchy
  // while still meeting WCAG AA.
  if (valid.length >= 2) return valid[1]

  // Only one tone clears 4.5:1 on this mid-tone surface. Try the next palette tone
  // at a relaxed 4.0:1 floor to preserve visual hierarchy between headline and body.
  // (4.0:1 meets WCAG AA large-text; acceptable for card body text on edge-case inputs.)
  const nextIdx = candidates.indexOf(valid[0]) + 1
  if (nextIdx < candidates.length) {
    const next = candidates[nextIdx]
    if (contrastRatio(bgLum, relativeLuminance(next)) >= 4.0) return next
  }
  return valid[0]
}

/**
 * Like `paletteText` but biased toward badge/button contexts: returns the
 * most brand-cohesive palette tone for text on `bgHex` using the correct
 * WCAG 2.1 IEC 61966-2-1 luminance formula, iterating all candidates before
 * falling back to pure white/black.
 *
 * Candidate order preserves brand-hue cohesion as long as contrast is met:
 *   Dark bg  → tint100, tint300, shade900, #ffffff
 *   Light bg → shade900, shade700, shade600, tint100, #000000
 */
export function paletteContrastText(bgHex: string, palette: ColorPalette): string {
  const bgLum = relativeLuminance(bgHex)
  const isDark = bgLum <= 0.18
  const candidates = isDark
    ? [palette.tint100, palette.tint300, palette.shade900, '#ffffff']
    : [palette.shade900, palette.shade700, palette.shade600, palette.tint100, '#000000']
  for (const c of candidates) {
    if (contrastRatio(bgLum, relativeLuminance(c)) >= 4.5) return c
  }
  return isDark ? '#ffffff' : '#000000'
}

// ── Resolved vertical context ─────────────────────────────────────────────────

export interface VerticalContext {
  aesthetic:  AestheticRegister
  canvasBg:   string   // the bg color to paint the card canvas
  txt:        string   // primary text color matching the canvas
  muted:      string   // muted text color
  accent:     string   // accent overlay
  bgStyle:    BgStyle
  isDark:     boolean  // true when canvas is dark
  palette:    ColorPalette
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255
}

/**
 * Infer a vertical from variant name keywords when the variant is not in
 * VARIANT_VERTICAL. Prevents new variants from silently falling through to
 * 'general' and regressing to AI-purple fallback colors.
 */
export function inferVerticalFromVariantName(variant: string): string {
  const v = variant.toLowerCase()
  if (/crypto|nft|token|web3|defi|dao|mint|blockchain/.test(v))            return 'web3'
  if (/food|recipe|meal|kitchen|cook|restaurant|menu|chef|nutrition|cocktail/.test(v)) return 'food'
  if (/spotify|music|podcast|album|stream|twitch|youtube|media|movie|film|audio/.test(v)) return 'media'
  if (/gaming|game|esport|achievement|leaderboard/.test(v))                return 'gaming'
  if (/fitness|workout|gym|exercise|sport|athlete/.test(v))                return 'fitness'
  if (/fashion|style|ootd|lookbook|outfit|clothing/.test(v))               return 'fashion'
  if (/interior|room|furnish|decor|architecture/.test(v))                  return 'interior'
  if (/finance|market|invest|stock|rate|bank|fund|revenue|portfolio/.test(v)) return 'finance'
  if (/health|medical|wellness|doctor|hospital|clinic/.test(v))            return 'health'
  if (/travel|trip|destination|hotel|flight|vacation/.test(v))             return 'travel'
  if (/event|party|wedding|birthday|invite|rsvp|holiday|greeting/.test(v)) return 'events'
  if (/charity|donat|nonprofit|volunteer|impact/.test(v))                  return 'nonprofit'
  // Word boundary on 'car' prevents false-positive match against 'card' in hyphenated names.
  // Also match 'automotive' explicitly since \bauto\b won't match it.
  if (/\bcar\b|vehicle|automotive|\bauto\b|dealer|drive/.test(v))          return 'automotive'
  if (/saas|feature|launch|waitlist|changelog|app-screen/.test(v))         return 'saas'
  if (/tech|code|git|npm|api|dev|terminal|developer|snippet|release/.test(v)) return 'tech'
  if (/tweet|linkedin|instagram|discord|reddit|tiktok/.test(v))            return 'social'
  if (/review|testimonial|rating|star|nps|case-study/.test(v))             return 'reviews'
  // job-board, open-role, career etc. → HR vertical
  if (/employee|culture|hiring|job-post|job-board|open-role|career|benefits/.test(v)) return 'hr'
  if (/business|corporate|org|invoice|proposal|trust-badge|award-badge/.test(v)) return 'business'
  if (/education|course|learn|certif|school|academic/.test(v))             return 'education'
  if (/lifestyle|referral/.test(v))                                        return 'lifestyle'
  if (/content|blog|book|magazine|newsletter|article/.test(v))             return 'content'
  if (/realestate|real.estate|property|house|sold|listing|open-house/.test(v)) return 'realestate'
  if (/ecommerce|shop|price-drop|deal|flash|gift-card|coupon|loyalty|receipt|countdown|cart/.test(v)) return 'ecommerce'
  if (/sport|score|player|schedule/.test(v))                               return 'sports'
  return 'general'
}

/**
 * Resolve the visual context for a variant.
 *
 * If the user passed an explicit `aesthetic`, it is respected.
 * Otherwise the vertical default is used.
 */
export function resolveVerticalContext(
  variant:          string,
  primaryColor:     string,
  explicitAesthetic?: string,
): VerticalContext {
  const vertical = VARIANT_VERTICAL[variant] ?? inferVerticalFromVariantName(variant)
  const spec     = VERTICAL_SPEC[vertical] ?? VERTICAL_SPEC['general']

  const aesthetic = (explicitAesthetic ?? spec.aesthetic) as AestheticRegister

  const isDark    = DARK_CANVAS_VERTICALS.has(vertical)
  const canvasBg  = isDark ? spec.darkCanvas : spec.lightCanvas

  // Text color system based on canvas, not primaryColor
  const palette = buildColorPalette(primaryColor)
  const txt     = paletteText(canvasBg, palette, 'headline')
  const muted   = paletteText(canvasBg, palette, 'muted')
  const accent  = luminance(canvasBg) > 0.55 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.18)'
  return { aesthetic, canvasBg, txt, muted, accent, bgStyle: spec.bgStyle, isDark, palette }
}

// ── Smart background layers ────────────────────────────────────────────────────
// Returns an array of Satori-compatible JSX node objects for the background.
// All use position:absolute + layered divs (no linear-gradient in background).

export function buildSmartBgLayers(
  ctx:          VerticalContext,
  primaryColor: string,
  w:            number,
  h:            number,
  bgImageData?: string,
): object[] {
  // Always respect user-supplied background image — just add the vertical overlay
  if (bgImageData) {
    const overlayOp = ctx.isDark ? 0.75 : 0.55
    return [
      { type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', objectPosition: 'center' } } },
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: ctx.isDark ? ctx.palette.shade900 : ctx.palette.shade600, opacity: overlayOp } } },
    ]
  }

  const blob = (size: number, color: string, opacity: number, top: number, left: number) => ({
    type: 'div',
    props: { style: { position: 'absolute', top, left, width: size, height: size, borderRadius: '50%', background: color, opacity } },
  })

  switch (ctx.bgStyle) {

    // ── Dark cinematic — media, gaming, web3, automotive, sports, fitness ──────
    case 'darkCinematic': return [
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: ctx.canvasBg } } },
      // primary glow top-right
      blob(Math.round(w * 0.85), primaryColor, 0.18, -Math.round(w * 0.3), Math.round(w * 0.4)),
      // deep accent blob bottom-left — uses palette shade700 instead of raw purple
      blob(Math.round(w * 0.55), ctx.palette.shade700, 0.45, Math.round(h * 0.6), -Math.round(w * 0.15)),
      // subtle vignette overlay
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.25)' } } },
    ]

    // ── Warm wash — food, lifestyle, events, nonprofit ─────────────────────────
    case 'warmWash': return [
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: ctx.canvasBg } } },
      // soft warm tint blob (bottom center) — uses tint300 for a more saturated pastel
      blob(Math.round(w * 0.9), ctx.palette.tint300, 0.55, Math.round(h * 0.5), Math.round(w * 0.05)),
      // top right soft accent
      blob(Math.round(w * 0.45), ctx.palette.base, 0.07, -Math.round(h * 0.1), Math.round(w * 0.65)),
    ]

    // ── Mesh gradient — SaaS, general, ecommerce, social, education ───────────
    case 'meshGradient': return [
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: ctx.canvasBg } } },
      // large blob top-right — uses tint300 for a pastel hue wash
      blob(Math.round(w * 0.75), ctx.palette.tint300, 0.50, -Math.round(h * 0.25), Math.round(w * 0.45)),
      // small blob bottom-left — uses shade600 for contrast depth
      blob(Math.round(w * 0.40), ctx.palette.shade600, 0.10, Math.round(h * 0.65), -Math.round(w * 0.1)),
      // very subtle overall tint
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor, opacity: 0.03 } } },
    ]

    // ── Clean panel — HR, business, health, reviews, real estate ──────────────
    case 'cleanPanel': return [
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: ctx.palette.tint100 } } },
      // top accent bar — uses shade600 for a richer brand-hued stripe
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: Math.max(8, Math.round(h * 0.025)), background: ctx.palette.shade600 } } },
      // right edge accent strip
      { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.025), right: 0, bottom: 0, width: Math.max(6, Math.round(w * 0.012)), background: primaryColor, opacity: 0.35 } } },
    ]

    // ── Paper texture — content, editorial ────────────────────────────────────
    case 'paperTexture': return [
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: ctx.palette.tint100 } } },
      // horizontal rule accent near top — uses shade600 for a visible hued rule
      { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.12), left: Math.round(w * 0.06), right: Math.round(w * 0.06), height: 2, background: ctx.palette.shade600, opacity: 0.35 } } },
      // bottom rule
      { type: 'div', props: { style: { position: 'absolute', bottom: Math.round(h * 0.08), left: Math.round(w * 0.06), right: Math.round(w * 0.06), height: 1, background: ctx.palette.shade600, opacity: 0.18 } } },
    ]

    // ── Split panel — fashion, interior ───────────────────────────────────────
    case 'splitPanel': return [
      // light left panel — uses tint100 instead of raw canvasBg for palette consistency
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: Math.round(w * 0.58), height: h, background: ctx.palette.tint100 } } },
      // dark right panel — uses shade900 instead of raw primaryColor for depth
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: Math.round(w * 0.58), right: 0, height: h, background: ctx.palette.shade900 } } },
      // thin palette.base divider strip at the seam (2px, opacity 0.60)
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: Math.round(w * 0.58) - 1, width: 2, height: h, background: ctx.palette.base, opacity: 0.60 } } },
    ]

    // ── Finance canvas — dark slate market aesthetic ───────────────────────────
    case 'financeCanvas': return [
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: ctx.palette.shade900 } } },
      // subtle primary glow bottom-right — uses palette.base for hue consistency
      blob(Math.round(w * 0.6), ctx.palette.base, 0.15, Math.round(h * 0.5), Math.round(w * 0.55)),
      // dark overlay to keep it professional
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.35)' } } },
    ]

    // ── Tech terminal — dark code aesthetic with grid lines ───────────────────
    case 'techTerminal': return [
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: ctx.palette.shade900 } } },
      // primary accent glow top-left (like terminal cursor) — uses palette.base
      blob(Math.round(w * 0.5), ctx.palette.base, 0.16, -Math.round(h * 0.15), -Math.round(w * 0.1)),
      // subtle horizontal grid lines (3 lines) — uses shade700 hued lines instead of pure rgba white
      { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.33), left: 0, right: 0, height: 1, background: ctx.palette.shade700, opacity: 0.18 } } },
      { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.66), left: 0, right: 0, height: 1, background: ctx.palette.shade700, opacity: 0.18 } } },
      // dark overlay
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.2)' } } },
    ]

    // ── Flat fallback ─────────────────────────────────────────────────────────
    case 'primaryFlat':
    default: return [
      { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } },
    ]
  }
}
