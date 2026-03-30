/**
 * Platform compliance checker for ad creatives.
 *
 * Checks image dimensions against platform-approved sizes and estimates
 * text coverage using a pixel-heuristic for Meta's (deprecated) 20% rule.
 * All functions are pure TypeScript — no WASM required.
 */

// ── Platform size registries ──────────────────────────────────────────────────

const META_SIZES = new Set([
  '1200x628', '1080x1080', '1080x1920', '1200x1200',
  '1080x1350', '628x1200', '1080x608', '1200x675',
])

const GOOGLE_SIZES = new Set([
  '300x250', '336x280', '728x90', '300x600',
  '320x50', '160x600', '970x90', '970x250',
  '468x60', '320x100', '1200x628', '1280x720',
])

const LINKEDIN_SIZES = new Set([
  '1200x628', '1200x1200', '1080x1080', '1200x675',
])

const TWITTER_SIZES = new Set([
  '1200x675', '1200x628', '1280x720',
])

const PINTEREST_SIZES = new Set([
  '1000x1500', '1000x1000', '600x900', '735x1102',
])

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComplianceCheck {
  pass:    boolean
  details: string
  value?:  number  // numeric measurement where relevant
}

export interface ComplianceResult {
  platform:        string
  width:           number
  height:          number
  checks:          Record<string, ComplianceCheck>
  pass:            boolean
  recommendations: string[]
}

// ── Core check logic ──────────────────────────────────────────────────────────

/**
 * Check an image against platform creative specifications.
 *
 * @param width     Image width in pixels.
 * @param height    Image height in pixels.
 * @param platform  One of: 'meta' | 'facebook' | 'instagram' | 'google' | 'linkedin' | 'twitter' | 'x'.
 * @param rgbaPixels  Optional raw RGBA bytes (width×height×4) for text-coverage analysis.
 */
export function checkPlatformCompliance(
  width:      number,
  height:     number,
  platform:   string,
  rgbaPixels?: Uint8Array,
): ComplianceResult {
  const checks: Record<string, ComplianceCheck> = {}
  const recs: string[] = []
  const p = platform.toLowerCase()
  const sizeKey = `${width}x${height}`

  // ── Size check ─────────────────────────────────────────────────────────────
  let sizePass = false

  if (p === 'meta' || p === 'facebook' || p === 'instagram') {
    sizePass = META_SIZES.has(sizeKey)
    checks['size'] = {
      pass: sizePass,
      details: sizePass
        ? `${width}×${height} — approved Meta size ✓`
        : `${width}×${height} — not in Meta approved sizes. Recommended: 1200×628 (feed), 1080×1080 (square), 1080×1920 (story)`,
    }
    if (!sizePass) recs.push('Resize to a Meta-approved format (e.g. 1200×628 for feed ads)')

  } else if (p === 'google') {
    sizePass = GOOGLE_SIZES.has(sizeKey)
    checks['size'] = {
      pass: sizePass,
      details: sizePass
        ? `${width}×${height} — approved Google Display Network size ✓`
        : `${width}×${height} — not a standard GDN size. Common sizes: 300×250, 728×90, 300×600, 320×50`,
    }
    if (!sizePass) recs.push('Use a Google Display Network approved size: 300×250, 728×90, 300×600, 160×600')

  } else if (p === 'linkedin') {
    sizePass = LINKEDIN_SIZES.has(sizeKey)
    checks['size'] = {
      pass: sizePass,
      details: sizePass
        ? `${width}×${height} — approved LinkedIn size ✓`
        : `${width}×${height} — recommended LinkedIn sizes: 1200×628, 1200×1200`,
    }
    if (!sizePass) recs.push('Use 1200×628 for LinkedIn single image ads')

  } else if (p === 'twitter' || p === 'x') {
    sizePass = TWITTER_SIZES.has(sizeKey)
    checks['size'] = {
      pass: sizePass,
      details: sizePass
        ? `${width}×${height} — valid Twitter/X card size ✓`
        : `${width}×${height} — recommended: 1200×675 for Twitter/X summary large image`,
    }
    if (!sizePass) recs.push('Use 1200×675 for Twitter/X summary large image cards')

  } else {
    // Unknown platform — just validate dimensions are reasonable
    sizePass = width >= 100 && width <= 4096 && height >= 50 && height <= 4096
    checks['size'] = {
      pass: sizePass,
      details: `${width}×${height} — ${sizePass ? 'dimensions in valid range' : 'extreme dimensions'}`,
    }
  }

  // ── Aspect ratio check ─────────────────────────────────────────────────────
  const ar = width / height
  const arPass = ar >= 0.4 && ar <= 6.0
  checks['aspectRatio'] = {
    pass:    arPass,
    value:   Math.round(ar * 100) / 100,
    details: arPass
      ? `${(Math.round(ar * 100) / 100).toFixed(2)}:1 — within acceptable range ✓`
      : `${(Math.round(ar * 100) / 100).toFixed(2)}:1 — extreme aspect ratio; platforms may crop or reject`,
  }
  if (!arPass) recs.push('Avoid extreme aspect ratios — platforms may crop or reject the creative')

  // ── File-size guidance (estimated from resolution) ─────────────────────────
  const estimatedKb = Math.round((width * height * 3) / (1024 * 8))  // rough JPEG-equivalent estimate
  const fileSizePass = estimatedKb < 10000  // 10 MB guard
  checks['fileSize'] = {
    pass:    fileSizePass,
    value:   estimatedKb,
    details: fileSizePass
      ? `~${estimatedKb} KB estimated (uncompressed) — should compress well ✓`
      : `${estimatedKb} KB estimated — very large; ensure exported file is <1 MB for ads`,
  }
  if (!fileSizePass) recs.push('Export as optimised JPEG/WebP — ad platforms typically require <1 MB per creative')

  // ── Meta 20% text coverage heuristic ──────────────────────────────────────
  // Meta deprecated this rule in 2021 but it remains best practice for delivery.
  if ((p === 'meta' || p === 'facebook' || p === 'instagram') && rgbaPixels && rgbaPixels.length >= 4) {
    const coverage    = estimateTextCoverage(rgbaPixels, width, height)
    const textPass    = coverage < 0.20
    const pct         = Math.round(coverage * 100)
    checks['textCoverage'] = {
      pass:    textPass,
      value:   pct,
      details: textPass
        ? `~${pct}% non-background pixel coverage — below 20% threshold ✓`
        : `~${pct}% non-background pixel coverage — exceeds 20% (Meta best practice for ad delivery)`,
    }
    if (!textPass) recs.push('Reduce text/overlay density — Meta recommends <20% text coverage for optimal ad delivery')
  }

  // ── Safe-zone guidance ─────────────────────────────────────────────────────
  if (p === 'linkedin') {
    // LinkedIn crops a 10% margin on all sides in some placements
    recs.push('Keep primary content within 80% of the frame centre — LinkedIn may crop a 10% margin in some placements')
  }
  if (p === 'instagram' && height >= 1500) {
    recs.push('For Instagram Stories ensure no critical content within 14% of top/bottom edges (UI overlays)')
  }

  const pass = Object.values(checks).every(c => c.pass)
  return { platform, width, height, checks, pass, recommendations: recs }
}

// ── Pixel analysis helpers ────────────────────────────────────────────────────

/**
 * Estimate the fraction of pixels that are "non-background" — a rough proxy for
 * text + graphics overlay coverage. Uses corner sampling for background estimation.
 *
 * NOTE: This is a heuristic. Product images with complex backgrounds will produce
 * inflated estimates. The result should be treated as an approximate guide only.
 */
function estimateTextCoverage(rgba: Uint8Array, width: number, height: number): number {
  const n = width * height
  if (n === 0) return 0

  // Sample background colour from a 6×6 grid of corner pixels
  const sz = Math.min(6, width, height)
  let bgR = 0, bgG = 0, bgB = 0, bgN = 0

  const sampleCorner = (startX: number, startY: number) => {
    for (let y = startY; y < startY + sz; y++) {
      for (let x = startX; x < startX + sz; x++) {
        const i = (y * width + x) * 4
        bgR += rgba[i]; bgG += rgba[i + 1]; bgB += rgba[i + 2]
        bgN++
      }
    }
  }
  sampleCorner(0, 0)
  sampleCorner(width - sz, 0)
  sampleCorner(0, height - sz)
  sampleCorner(width - sz, height - sz)

  bgR = Math.round(bgR / bgN)
  bgG = Math.round(bgG / bgN)
  bgB = Math.round(bgB / bgN)

  // Count pixels that deviate significantly from the background colour
  // Use a Manhattan distance threshold of 90 (across three channels → 30 per channel avg)
  let textPixels = 0
  for (let i = 0; i < n; i++) {
    const diff =
      Math.abs(rgba[i * 4]     - bgR) +
      Math.abs(rgba[i * 4 + 1] - bgG) +
      Math.abs(rgba[i * 4 + 2] - bgB)
    if (diff > 90) textPixels++
  }
  return textPixels / n
}

/**
 * Quick size-only compliance check — no pixel data needed.
 * Returns a compact summary: `{ pass, platform, size, notes[] }`.
 */
export function quickSizeCheck(
  width:    number,
  height:   number,
  platform: string,
): { pass: boolean; platform: string; size: string; notes: string[] } {
  const result = checkPlatformCompliance(width, height, platform)
  return {
    pass:     result.pass,
    platform: result.platform,
    size:     `${width}x${height}`,
    notes:    result.recommendations,
  }
}

/** Returns every platform where `width×height` is an approved size. */
export function detectPlatforms(width: number, height: number): string[] {
  const key = `${width}x${height}`
  const found: string[] = []
  if (META_SIZES.has(key))      found.push('meta/instagram')
  if (GOOGLE_SIZES.has(key))    found.push('google-display')
  if (LINKEDIN_SIZES.has(key))  found.push('linkedin')
  if (TWITTER_SIZES.has(key))   found.push('twitter/x')
  if (PINTEREST_SIZES.has(key)) found.push('pinterest')
  return found
}
