import type { ColorPalette } from './vertical-aesthetics'
import type { LayoutTokens } from './layout-engine'

// Shared VariantHelpers interface for all variant group files
export interface VariantHelpers {
  s:            (v: number) => number
  /** Headline-scaled size — use for primary headline font sizes. */
  sh:           (v: number) => number
  /** Subheadline-scaled size — use for subheadline/body font sizes. */
  sb:           (v: number) => number
  /** Padding-scaled size — use for main outer padding values. */
  sp:           (v: number) => number
  w:            number
  h:            number
  txt:          string
  muted:        string
  accent:       string
  lightTxt:     string
  lightMuted:   string
  primaryColor: string
  /** Smart canvas background color for this vertical (dark or light). */
  canvasBg:     string
  /** True when canvasBg is dark (media, gaming, web3, automotive, sports, etc.). */
  isDark:       boolean
  brandName:    string
  headline:     string
  subheadline?: string
  stat?:        string
  bgImageData?: string
  logoData?:    string
  tk:           {
    headlineFamily:        string
    headlineWeight:        number
    headlineStyle:         'normal' | 'italic'
    headlineLetterSpacing: number
    headlineTransform:     'none' | 'uppercase' | 'capitalize'
    quoteWeight:           number
    quoteStyle:            'normal' | 'italic'
    brandFamily:           string
    brandWeight:           number
    brandLetterSpacing:    number
    brandTransform:        'none' | 'uppercase' | 'capitalize'
    quoteFamily:           string
    subheadlineFamily:     string
    subheadlineWeight:     number
    subheadlineLineHeight: number
    panelBg:               string
    lightPanelText:        string
    lightPanelMuted:       string
    overlayOpacity:        number
    accentOverride:        string | null
    quoteGlyphColor:       string | null
  }
  accentBar:    string
  contrastText: (hex: string) => string
  palette:  ColorPalette
  /** Palette headline text — hued near-white on dark, hued near-black on light. */
  ptxt:     string
  /** Palette body text — slightly softer than ptxt. */
  pbody:    string
  /** Palette muted text — for labels, captions, brand name. */
  pmuted:   string
  /** Dark-surface palette text — for text on dark photo scrims. */
  ptxtDark:    string
  pbodyDark:   string
  pmutedDark:  string
  /** Light-surface palette text — for text on light panels. */
  ptxtLight:   string
  pbodyLight:  string
  pmutedLight: string
  /** Palette-hued contrast text for platform-coloured badges. */
  paletteContrastText: (bgHex: string) => string
  /** WCAG contrast enforcer — ec(color, bg) returns color if contrast ≥ minRatio, else #fff/#111. */
  ec: (color: string, bg: string, minRatio?: number) => string
  /**
   * Smart text colors — THE universal solution for variant files.
   * Photo mode  (bgImageData present): forced white — always readable on dark photo scrims.
   * Canvas mode (no photo):            ec-safe palette tone against primaryColor.
   * Always use sTxt/sBody/sMuted instead of ptxt/pbody/pmuted in variant files.
   */
  sTxt:   string
  sBody:  string
  sMuted: string
  /** Layout tokens resolved from canvas aspect ratio. */
  lk: LayoutTokens
  /** RTL-safe layout text align: respects rtl direction over aspect-ratio preference */
  lta: 'center' | 'left' | 'right'
}
