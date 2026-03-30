export type AspectClass = 'story' | 'portrait' | 'square' | 'landscape' | 'cinematic'

export interface LayoutTokens {
  aspect:         AspectClass
  headlineScale:  number   // multiplier on headline font sizes
  subScale:       number   // multiplier on subheadline/body font sizes
  paddingScale:   number   // multiplier on padding values
  textMaxFrac:    number   // max text block width as fraction of canvas w
  justifyContent: 'center' | 'flex-end' | 'flex-start'  // vertical flow alignment
  textAlign:      'center' | 'left'
  brandTop:       boolean  // true → brand name anchored top, false → bottom
  headlineChars:  number   // max chars for headline.slice()
  /**
   * Display-tier scale — applied when a headline is short (≤ 4 words) and should
   * be treated as a large-type impact statement rather than a running headline.
   * Approximately 1.25× headlineScale, giving a 3–5:1 ratio against body text.
   *
   * Examples (square canvas, scale≈1.0):
   *   sd(54) ≈ 68px display vs sb(15) ≈ 15px subhead → 4.5:1 ✓
   *   sh(54) ≈ 54px headline vs sb(15) ≈ 15px subhead → 3.6:1 ✓
   */
  displayScale:   number
}

export function classifyAspect(w: number, h: number): AspectClass {
  const r = w / h
  if (r < 0.65)  return 'story'      // 9:16 ≈ 0.5625
  if (r < 0.90)  return 'portrait'   // 4:5 ≈ 0.8
  if (r <= 1.15) return 'square'     // 1:1
  if (r <= 1.80) return 'landscape'  // 4:3, 16:9 landscape etc.
  return 'cinematic'                  // > 1.80  (Twitter/X banner etc.)
}

const LAYOUT_MAP: Record<AspectClass, LayoutTokens> = {
  story: {
    aspect: 'story',
    headlineScale: 0.65,
    subScale:      0.78,
    paddingScale:  0.90,
    textMaxFrac:   0.82,
    justifyContent: 'center',
    textAlign:     'center',
    brandTop:      true,
    headlineChars: 55,
    displayScale:  0.82,
  },
  portrait: {
    aspect: 'portrait',
    headlineScale: 1.12,
    subScale:      1.02,
    paddingScale:  0.95,
    textMaxFrac:   0.85,
    justifyContent: 'flex-end',
    textAlign:     'left',
    brandTop:      true,
    headlineChars: 60,
    displayScale:  1.40,
  },
  square: {
    aspect: 'square',
    headlineScale: 1.0,
    subScale:      1.0,
    paddingScale:  1.0,
    textMaxFrac:   0.82,
    justifyContent: 'center',
    textAlign:     'center',
    brandTop:      false,
    headlineChars: 65,
    displayScale:  1.25,
  },
  landscape: {
    aspect: 'landscape',
    headlineScale: 0.93,
    subScale:      0.97,
    paddingScale:  1.05,
    textMaxFrac:   0.72,
    justifyContent: 'flex-end',
    textAlign:     'left',
    brandTop:      false,
    headlineChars: 72,
    displayScale:  1.15,
  },
  cinematic: {
    aspect: 'cinematic',
    headlineScale: 0.86,
    subScale:      0.92,
    paddingScale:  1.10,
    textMaxFrac:   0.62,
    justifyContent: 'flex-end',
    textAlign:     'left',
    brandTop:      false,
    headlineChars: 80,
    displayScale:  1.05,
  },
}

export function resolveLayout(w: number, h: number): LayoutTokens {
  return LAYOUT_MAP[classifyAspect(w, h)]
}
