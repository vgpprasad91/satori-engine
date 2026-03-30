/**
 * mailcraft-satori — dedicated Satori/Resvg rendering Worker.
 *
 * Architecture:
 *   - Fonts bundled via [[rules]] type="Data" — 4 weights (400/700/800/900), zero CDN latency.
 *   - DO shard pool of 4 — each shard has semaphore(2) → 8 parallel render slots total.
 *   - Shard affinity by brand name (murmurHash32 % 4) → same brand always lands same shard.
 *   - L1 cache: in-memory LRU (20 PNGs per shard) — repeat renders are instantaneous.
 *   - L2 cache: DO persistent storage (survives isolate eviction, ~1-2 ms reads).
 *   - In-DO image fetch: accepts bgImageUrl (URL string) instead of base64 data URI;
 *     DO fetches once + keeps an in-memory image LRU (10 entries) for reuse across cards.
 *   - Keep-warm cron every 5 min — all 4 shards pinged so none ever goes cold.
 *
 * POST /render
 *   Body (JSON): { variant, headline, subheadline?, stat?, brandName, primaryColor,
 *                  bgImageUrl?, bgImageData?, preset?, width?, height?, tokens?, ... }
 *   Response:    PNG bytes  (Content-Type: image/png)
 *             or { error: string }  (Content-Type: application/json, status 500)
 *
 * POST /render-carousel
 *   Body (JSON): { slides: CardOpts[], format? }
 *   Response:    { slides: [{ index, image: 'data:...' }], count }
 */

import satori from '@cf-wasm/satori'
import { Resvg }  from '@cf-wasm/resvg'
import { PhotonImage } from '@cf-wasm/photon'
import { DurableObject } from 'cloudflare:workers'
import { encodeAnimatedGif, applyBrightness, applyShimmer, applyWipe, applyZoom, applySlide, applyGlitch, applyFlipSqueeze, applyPing } from './gif-encoder'
import { checkPlatformCompliance, detectPlatforms } from './compliance'
import { buildVariants as buildMediaVariants } from './variants-media'
import { buildVariants as buildSocialVariants } from './variants-social'
import { buildVariants as buildBusinessVariants } from './variants-business'
import { buildVariants as buildContentVariants } from './variants-content'
import { buildVariants as buildLifestyleVariants } from './variants-lifestyle'
import { buildVariants as buildAutomotiveVariants } from './variants-automotive'
import { buildVariants as buildFashionVariants } from './variants-fashion'
import { buildVariants as buildWeb3Variants } from './variants-web3'
import { buildVariants as buildNonprofitVariants } from './variants-nonprofit'
import { buildVariants as buildInteriorVariants } from './variants-interior'
import { buildVariants as buildHrCultureVariants } from './variants-hrculture'
import { resolveVerticalContext, buildSmartBgLayers, buildColorPalette, paletteText, paletteContrastText, VERTICAL_FALLBACK_COLOR, VARIANT_VERTICAL, inferVerticalFromVariantName } from './vertical-aesthetics'
import type { ColorPalette } from './vertical-aesthetics'
import { resolveColors, resolveTextColors } from './color-pipeline'
import { buildDecorativeAccents, buildBrandBadge } from './design-tokens'
import { resolveLayout } from './layout-engine'
import type { LayoutTokens } from './layout-engine'

// @ts-ignore
import inter400 from '../fonts/inter-latin-400-normal.woff'
// @ts-ignore
import inter700 from '../fonts/inter-latin-700-normal.woff'
// @ts-ignore
import inter800 from '../fonts/inter-latin-800-normal.woff'
// @ts-ignore
import inter900 from '../fonts/inter-latin-900-normal.woff'
// @ts-ignore
import playfair400Normal from '../fonts/playfair-400-normal.woff'
// @ts-ignore
import playfair400Italic from '../fonts/playfair-400-italic.woff'
// Aesthetic register fonts (TTF) — Cormorant Garamond, Dancing Script, Bebas Neue
// @ts-ignore
import cormorant400Normal from '../fonts/cormorant-400-normal.ttf'
// @ts-ignore
import cormorant400Italic from '../fonts/cormorant-400-italic.ttf'
// @ts-ignore
import cormorant600Normal from '../fonts/cormorant-600-normal.ttf'
// @ts-ignore
import cormorant600Italic from '../fonts/cormorant-600-italic.ttf'
// @ts-ignore
import dancing400Normal from '../fonts/dancing-400-normal.ttf'
// @ts-ignore
import dancing700Normal from '../fonts/dancing-700-normal.ttf'
// @ts-ignore
import bebas400Normal from '../fonts/bebas-400-normal.ttf'

// ── Env ───────────────────────────────────────────────────────────────────────

export interface Env {
  SATORI_DO:         DurableObjectNamespace
  RATE_LIMITER:      DurableObjectNamespace
  RENDER_CACHE:      R2Bucket
  API_KEYS:          KVNamespace
  SATORI_MASTER_KEY?: string
  PEXELS_API_KEY?:   string
  ANTHROPIC_API_KEY?: string
}

// ── Custom template types ──────────────────────────────────────────────────────

/** A single token slot in a custom template. */
export interface TemplateToken {
  type:         'text' | 'image' | 'color' | 'number'
  description?: string
  default?:     string | number
}

/** Shape of a node in a Satori JSX tree (plain JSON). */
export interface SatoriNode {
  type:  string
  props: {
    style?:    Record<string, unknown>
    children?: SatoriNode | SatoriNode[] | string
    src?:      string
    [key: string]: unknown
  }
}

/** Stored representation of a custom template in R2. */
export interface StoredTemplate {
  id:        string
  name:      string
  width:     number
  height:    number
  tokens:    Record<string, TemplateToken>
  tree:      SatoriNode
  createdAt: string
  keyId:     string
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CardVariantName =
  | 'stat-hero' | 'feature-split' | 'announcement'
  | 'quote-overlay' | 'benefit-strip'
  | 'recipe-hero' | 'tip-card' | 'editorial-hero'
  // Ad creative variants
  | 'product-showcase' | 'coupon-offer' | 'testimonial'
  | 'event-card' | 'video-thumbnail'
  // New variants
  | 'before-after' | 'pricing-card' | 'social-proof'
  | 'countdown-timer' | 'app-screenshot' | 'job-posting' | 'podcast-cover'
  // E-commerce
  | 'product-shot' | 'price-drop' | 'new-arrival' | 'flash-deal'
  // Real estate
  | 'property-listing' | 'open-house' | 'sold-announcement'
  // SaaS/Tech
  | 'feature-launch' | 'changelog' | 'waitlist-signup'
  // Fitness
  | 'transformation' | 'class-schedule'
  // Food & Beverage
  | 'menu-special'
  // Education
  | 'course-launch' | 'certification'
  // Finance
  | 'market-update' | 'rate-announcement'
  // Media/Entertainment (variants-media)
  | 'spotify-now-playing' | 'album-art' | 'movie-poster' | 'music-release'
  | 'twitch-banner' | 'youtube-stats' | 'soundcloud-track' | 'live-stream-alert' | 'podcast-stats'
  // Social/Tech/Developer (variants-social)
  | 'tweet-card' | 'linkedin-article' | 'product-hunt' | 'reddit-post'
  | 'instagram-quote' | 'tiktok-caption' | 'discord-announcement' | 'github-stats'
  | 'npm-package' | 'api-status' | 'code-snippet' | 'status-page' | 'release-notes'
  // Business/Sports/Gaming (variants-business)
  | 'receipt-card' | 'business-card' | 'qr-code-card' | 'team-member'
  | 'org-announcement' | 'invoice-summary' | 'proposal-cover'
  | 'sports-score' | 'sports-player' | 'sports-schedule' | 'leaderboard-card'
  | 'gaming-achievement' | 'esports-match' | 'award-badge' | 'trust-badge'
  // Content/Publishing/Reviews (variants-content)
  | 'newsletter-header' | 'book-cover' | 'magazine-cover' | 'blog-post-card'
  | 'infographic-stat' | 'press-release' | 'google-review' | 'star-rating'
  | 'nps-score' | 'case-study' | 'gift-card' | 'loyalty-card'
  // Lifestyle/Health/Events/Finance (variants-lifestyle)
  | 'referral-card' | 'nutrition-facts' | 'cocktail-recipe' | 'workout-plan'
  | 'travel-destination' | 'birthday-card' | 'wedding-card' | 'holiday-greeting'
  | 'rsvp-card' | 'crypto-price' | 'portfolio-snapshot' | 'savings-goal'
  | 'appointment-card' | 'health-metrics' | 'habit-tracker'
  // Automotive
  | 'car-listing' | 'vehicle-specs' | 'dealership-ad' | 'test-drive-cta'
  // Fashion/Retail
  | 'lookbook-card' | 'ootd-card' | 'style-drop' | 'fashion-sale'
  // Web3/NFT
  | 'nft-showcase' | 'mint-announcement' | 'dao-proposal' | 'token-launch' | 'web3-stats'
  // Non-profit
  | 'donation-progress' | 'impact-stats' | 'charity-appeal' | 'volunteer-cta'
  // Interior Design
  | 'room-reveal' | 'project-showcase' | 'material-moodboard' | 'design-consultation'
  // HR/Culture
  | 'employee-spotlight' | 'company-benefits' | 'culture-stats' | 'open-roles' | 'team-culture'

/**
 * Named format presets — each maps to a canonical w×h for a specific ad placement.
 * Passing `preset` overrides `width`/`height`.
 */
type FormatPreset =
  | 'instagram-square'    // 1080×1080
  | 'instagram-story'     // 1080×1920
  | 'facebook-linkedin'   // 1200×628
  | 'twitter-x'           // 1200×675
  | 'leaderboard'         // 728×90
  | 'medium-rectangle'    // 300×250
  | 'half-page'           // 300×600
  | 'youtube-thumbnail'   // 1280×720
  | 'email-header'        // 600×314 (default)
  | 'pinterest'           // 1000×1500
  | 'wide-skyscraper'     // 160×600
  | 'large-mobile-banner' // 320×100
  | 'billboard'           // 970×250
  | 'large-leaderboard'   // 970×90
  // Additional presets
  | 'og-image'            // 1200×628
  | 'twitter-card'        // 1200×628
  | 'linkedin-post'       // 1200×627
  | 'facebook-feed'       // 1200×628
  | 'facebook-cover'      // 820×312
  | 'twitter-header'      // 1500×500
  | 'linkedin-cover'      // 1584×396
  | 'spotify-cover'       // 3000×3000
  | 'tiktok-video'        // 1080×1920
  | 'display-interstitial' // 320×480

const FORMAT_PRESETS: Record<FormatPreset, { w: number; h: number; label?: string }> = {
  'instagram-square':    { w: 1080, h: 1080, label: 'Instagram Square' },
  'instagram-story':     { w: 1080, h: 1920, label: 'Instagram Story' },
  'facebook-linkedin':   { w: 1200, h: 628,  label: 'Facebook / LinkedIn' },
  'twitter-x':           { w: 1200, h: 675,  label: 'Twitter / X' },
  'leaderboard':         { w: 728,  h: 90,   label: 'Leaderboard' },
  'medium-rectangle':    { w: 300,  h: 250,  label: 'Medium Rectangle' },
  'half-page':           { w: 300,  h: 600,  label: 'Half Page' },
  'youtube-thumbnail':   { w: 1280, h: 720,  label: 'YouTube Thumbnail' },
  'email-header':        { w: 600,  h: 200,  label: 'Email Header' },
  'pinterest':           { w: 1000, h: 1500, label: 'Pinterest' },
  'wide-skyscraper':     { w: 160,  h: 600,  label: 'Wide Skyscraper' },
  'large-mobile-banner': { w: 320,  h: 100,  label: 'Large Mobile Banner' },
  'billboard':           { w: 970,  h: 250,  label: 'Billboard' },
  'large-leaderboard':   { w: 970,  h: 90,   label: 'Large Leaderboard' },
  'og-image':            { w: 1200, h: 628,  label: 'Open Graph Image' },
  'twitter-card':        { w: 1200, h: 628,  label: 'Twitter Card' },
  'linkedin-post':       { w: 1200, h: 627,  label: 'LinkedIn Post' },
  'facebook-feed':       { w: 1200, h: 628,  label: 'Facebook Feed' },
  'facebook-cover':      { w: 820,  h: 312,  label: 'Facebook Cover' },
  'twitter-header':      { w: 1500, h: 500,  label: 'Twitter/X Header' },
  'linkedin-cover':      { w: 1584, h: 396,  label: 'LinkedIn Cover' },
  'spotify-cover':       { w: 3000, h: 3000, label: 'Spotify Podcast Cover' },
  'tiktok-video':        { w: 1080, h: 1920, label: 'TikTok Video' },
  'display-interstitial':{ w: 320,  h: 480,  label: 'Display Interstitial' },
}

/**
 * Five aesthetic registers — each encodes a distinct typographic personality.
 *   modern-sans      → Inter; clean, versatile (default — food, wellness, B2B)
 *   editorial-serif  → Playfair Display italic; magazine, editorial content
 *   luxury           → Cormorant Garamond; high-end fashion, hospitality, beauty
 *   warm-script      → Dancing Script; creator economy, handcrafted, artisan
 *   bold-condensed   → Bebas Neue; fitness, sport, streetwear, high-energy
 */
type AestheticRegister = 'modern-sans' | 'editorial-serif' | 'luxury' | 'warm-script' | 'bold-condensed'
  | 'brutalist' | 'glassmorphism' | 'retro' | 'minimalist-luxury'

interface CardOpts {
  variant?:       CardVariantName
  headline:       string
  subheadline?:   string
  stat?:          string
  brandName:      string
  primaryColor:   string
  bgImageUrl?:    string   // preferred: DO fetches + caches internally
  bgImageData?:   string   // legacy: base64 data URI (still accepted for backward compat)
  preset?:        FormatPreset  // named format preset — overrides width/height
  width?:         number
  height?:        number
  brandUrl?:      string   // brand homepage URL — auto-extracts primaryColor if primaryColor not set
  format?:        'png' | 'webp'   // default 'png'
  aesthetic?:     AestheticRegister  // default 'modern-sans'
  // Personalization tokens — {{key}} in text fields is replaced at render time
  tokens?:        Record<string, string>
  // product-showcase
  price?:         string   // e.g. "$49" or "From $29/mo"
  ctaText?:       string   // CTA button label
  ctaColor?:      string   // CTA button bg color override (hex)
  // coupon-offer
  couponCode?:    string   // e.g. "SAVE20"
  expiryText?:    string   // e.g. "Expires Dec 31"
  // testimonial
  reviewText?:    string   // full review quote (falls back to headline)
  reviewerName?:  string   // reviewer display name
  reviewerTitle?: string   // reviewer role / company
  rating?:        number   // 1-5 star rating (default 5)
  // event-card
  eventDate?:     string   // e.g. "Dec 14" or "14 December"
  eventTime?:     string   // e.g. "7:00 PM EST"
  eventLocation?: string   // e.g. "Madison Square Garden, NYC"
  // before-after
  beforeText?:    string   // "before" state description (left panel)
  afterText?:     string   // "after" state description (right panel)
  beforeLabel?:   string   // left label override (default "Before")
  afterLabel?:    string   // right label override (default "After")
  // pricing-card
  plans?:         Array<{ name: string; price: string; period?: string; features?: string[]; highlighted?: boolean }>
  // social-proof
  logos?:         string[]  // company/brand names for proof grid
  tagline?:       string    // secondary tagline
  // countdown-timer
  timerDays?:     number
  timerHours?:    number
  timerMins?:     number
  timerSecs?:     number
  // app-screenshot
  appRating?:     number    // 1–5
  appDownloads?:  string    // e.g. "10M+"
  // job-posting
  jobTitle?:      string    // falls back to headline
  location?:      string
  jobType?:       string    // "Full-time" | "Remote" | "Contract"
  salary?:        string    // "$120k–$180k"
  skills?:        string[]  // ["React", "TypeScript"]
  // podcast-cover
  episodeNumber?: string    // "EP. 47"
  host?:          string

  // brand kit
  logoUrl?:          string    // URL to logo image (fetched + cached by DO)
  brandFontUrl?:     string    // Google Fonts or direct .ttf/.woff URL for brand font
  brandFontFamily?:  string    // Font family name to use after loading brandFontUrl

  // e-commerce
  originalPrice?:    string    // e.g. "$99" (crossed out)
  badge?:            string    // e.g. "NEW" | "SALE" | "HOT" | "-40%"
  productCategory?:  string    // e.g. "Footwear"
  stockCount?:       number    // e.g. 3 (low stock warning)

  // real estate
  propertyPrice?:    string    // e.g. "$1,250,000"
  bedrooms?:         number
  bathrooms?:        number
  sqft?:             string    // e.g. "2,400 sq ft"
  agentName?:        string
  propertyAddress?:  string

  // fitness
  beforeStat?:       string    // e.g. "185 lbs"
  afterStat?:        string    // e.g. "162 lbs"
  duration?:         string    // e.g. "12 Weeks"
  classTime?:        string    // e.g. "6:00 AM"
  classDuration?:    string    // e.g. "45 min"
  instructor?:       string
  classType?:        string    // e.g. "HIIT" | "Yoga" | "Cycling"

  // education
  courseName?:       string
  courseLevel?:      string    // e.g. "Beginner" | "Advanced"
  lessonCount?:      number
  studentCount?:     string    // e.g. "2,400 students"
  certificateName?:  string
  recipientName?:    string
  completionDate?:   string

  // finance
  ticker?:           string    // e.g. "AAPL"
  priceChange?:      string    // e.g. "+4.2%"
  positive?:         boolean   // true = green, false = red
  interestRate?:     string    // e.g. "5.25%"
  rateType?:         string    // e.g. "APY" | "APR"
  chartData?:        number[]  // sparkline data points (6-12 values)

  // food & beverage
  dishName?:         string
  dishPrice?:        string    // e.g. "$18"
  dietaryTags?:      string[]  // ["Vegan", "GF"]
  prepTime?:         string    // e.g. "25 min"
  calories?:         string    // e.g. "420 cal"

  // SaaS/tech
  changelogItems?:   string[]  // list of changelog bullet points
  version?:          string    // e.g. "v2.4.0"
  waitlistCount?:    string    // e.g. "2,400 on waitlist"
  launchDate?:       string    // e.g. "Coming Jan 2026"
  featureIcon?:      string    // emoji icon for feature

  // webhook / async
  webhookUrl?:       string    // for async render jobs

  // ── Media/Entertainment (variants-media) ──────────────────────────────────
  spotifyTrack?:     string    // track/song title
  spotifyArtist?:    string    // artist name
  spotifyProgress?:  number    // 0–100 progress percent
  streamViewers?:    string    // e.g. "12.4K"
  releaseDate?:      string    // e.g. "Out Now" / "Jan 14"
  genre?:            string    // music genre label
  gameTitle?:        string    // video game title
  listens?:          string    // listen count e.g. "2.1M"
  trackCount?:       number    // album track count
  podcastEpisodes?:  number    // total episode count
  podcastListeners?: string    // e.g. "50K monthly"

  // ── Social/Tech/Developer (variants-social) ────────────────────────────────
  tweetText?:        string    // full tweet body
  tweetHandle?:      string    // @handle
  tweetLikes?:       string    // e.g. "2.4K"
  tweetRetweets?:    string    // e.g. "847"
  githubRepo?:       string    // e.g. "owner/repo"
  githubStars?:      string    // e.g. "12.4k"
  githubForks?:      string    // e.g. "1.2k"
  packageName?:      string    // npm package name
  packageVersion?:   string    // e.g. "3.2.1"
  packageDownloads?: string    // e.g. "2M/week"
  statusItems?:      Array<{ name: string; status: 'operational' | 'degraded' | 'outage' }>
  codeLanguage?:     string    // e.g. "TypeScript"
  codeLines?:        string[]  // lines of code to display
  uptime?:           string    // e.g. "99.98%"
  releaseVersion?:   string    // e.g. "v4.0.0"
  releaseChanges?:   string[]  // bullet list of changes
  upvotes?:          string    // e.g. "847"
  comments?:         string    // comment count
  subreddit?:        string    // subreddit name

  // ── Business/Sports/Gaming (variants-business) ────────────────────────────
  teamA?:            string    // home team name
  teamB?:            string    // away team name
  scoreA?:           string    // home team score
  scoreB?:           string    // away team score
  matchStatus?:      string    // e.g. "LIVE" | "FT" | "HT"
  leaderboardItems?: Array<{ rank: number; name: string; score: string; change?: 'up' | 'down' | 'same' }>
  invoiceNumber?:    string    // e.g. "INV-2024-001"
  invoiceAmount?:    string    // e.g. "$4,250.00"
  invoiceDue?:       string    // e.g. "Due Jan 14"
  achievement?:      string    // achievement/badge name
  xpGained?:         string    // e.g. "+250 XP"
  playerSport?:      string    // sport name
  playerPosition?:   string    // e.g. "Forward"
  playerStats?:      Array<{ label: string; value: string }>
  matchDate?:        string    // e.g. "Jan 14 · 8PM"
  matchVenue?:       string
  phone?:            string    // contact phone number
  email?:            string    // contact email
  website?:          string    // website URL
  proposalClient?:   string    // client company name
  proposalValue?:    string    // e.g. "$24,000"
  proposalDue?:      string    // proposal deadline

  // ── Content/Publishing/Reviews (variants-content) ─────────────────────────
  issueNumber?:      string    // e.g. "Issue #47"
  author?:           string    // author name
  isbn?:             string    // book ISBN
  readTime?:         string    // e.g. "5 min read"
  category?:         string    // content category
  publishDate?:      string    // e.g. "Jan 2026"
  reviewCount?:      string    // e.g. "2,847 reviews"
  reviewPlatform?:   string    // e.g. "Google" | "Trustpilot"
  npsScore?:         number    // 0–10 NPS score
  promoters?:        number    // % promoters
  detractors?:       number    // % detractors
  giftAmount?:       string    // e.g. "$50"
  giftFrom?:         string    // e.g. "From: Sarah"
  loyaltyPoints?:    string    // e.g. "2,450 pts"
  loyaltyTier?:      string    // e.g. "Gold Member"
  caseStudyResult?:  string    // key outcome e.g. "3× revenue growth"
  caseStudyClient?:  string    // client name

  // ── Lifestyle/Health/Events/Finance (variants-lifestyle) ──────────────────
  referralBonus?:    string    // e.g. "$20 for each referral"
  alcoholContent?:   string    // e.g. "ABV: 12%"
  servings?:         string    // e.g. "Serves 2"
  exercises?:        Array<{ name: string; sets?: string; reps?: string }>
  habitItems?:       Array<{ name: string; done: boolean }>
  cryptoSymbol?:     string    // e.g. "BTC"
  cryptoPrice?:      string    // e.g. "$67,420"
  marketCap?:        string    // e.g. "$1.32T"
  portfolioValue?:   string    // e.g. "$48,250"
  portfolioChange?:  string    // e.g. "+12.4%"
  savingsGoal?:      string    // e.g. "$10,000"
  savedAmount?:      string    // e.g. "$6,800"
  savingsProgress?:  number    // 0–100 percent
  steps?:            string    // e.g. "8,432"
  heartRate?:        string    // e.g. "72 bpm"
  sleepHours?:       string    // e.g. "7h 24m"
  appointmentType?:  string    // e.g. "Dental Checkup"
  appointmentTime?:  string    // e.g. "Mon, Jan 14 · 2:30 PM"
  providerName?:     string    // doctor/provider name
  destination?:      string    // travel destination
  travelDuration?:   string    // e.g. "7 nights"
  travelPrice?:      string    // e.g. "From $899"
  rsvpDeadline?:     string    // e.g. "RSVP by Dec 1"
  cocktailIngredients?: string[] // list of ingredients

  // ── Automotive ────────────────────────────────────────────────────────────
  vehicleMake?:      string    // e.g. "Toyota"
  vehicleModel?:     string    // e.g. "Camry XSE"
  vehicleYear?:      number    // e.g. 2025
  vehicleMileage?:   string    // e.g. "12,000 miles"
  vehicleEngine?:    string    // e.g. "2.5L 4-Cylinder"
  vehicleColor?:     string    // e.g. "Midnight Black"
  vehicleFeatures?:  string[]  // e.g. ["Sunroof", "Leather", "AWD"]
  vehicleCondition?: string    // "New" | "Certified Pre-Owned" | "Used"

  // ── Fashion/Retail ────────────────────────────────────────────────────────
  lookbookItems?:    string[]  // outfit piece names
  styleTag?:         string    // e.g. "Minimalist" | "Streetwear" | "Boho"
  collection?:       string    // e.g. "Spring/Summer 2026"
  sizes?:            string[]  // e.g. ["XS","S","M","L","XL"]
  material?:         string    // e.g. "100% Organic Cotton"
  colorways?:        string[]  // e.g. ["Black","White","Sand"]

  // ── NFT/Web3 ──────────────────────────────────────────────────────────────
  nftName?:          string    // NFT collection or item name
  nftPrice?:         string    // e.g. "2.5 ETH"
  nftEdition?:       string    // e.g. "1 of 100"
  blockchain?:       string    // e.g. "Ethereum" | "Solana" | "Polygon"
  mintDate?:         string    // e.g. "Jan 20, 2026"
  totalSupply?:      string    // e.g. "10,000"
  floorPrice?:       string    // e.g. "0.8 ETH"
  holderCount?:      string    // e.g. "4,200 holders"
  daoName?:          string    // e.g. "NounsDAO"
  proposalId?:       string    // e.g. "#247"
  tokenSymbol?:      string    // e.g. "USDC" | "PEPE"
  tokenPrice?:       string    // e.g. "$1.00"
  tokenChange?:      string    // e.g. "+12.4%"

  // ── Non-profit/Fundraising ────────────────────────────────────────────────
  donationGoal?:     string    // e.g. "$50,000"
  donationRaised?:   string    // e.g. "$34,200"
  donationProgress?: number    // 0-100
  donorCount?:       string    // e.g. "1,247 donors"
  impactStat?:       string    // e.g. "10,000 meals served"
  impactLabel?:      string    // e.g. "Children fed this month"
  causeTag?:         string    // e.g. "Environment" | "Education" | "Health"
  volunteerCount?:   string    // e.g. "450 volunteers"

  // ── Interior Design ───────────────────────────────────────────────────────
  roomType?:         string    // e.g. "Living Room" | "Kitchen" | "Bedroom"
  designStyle?:      string    // e.g. "Scandinavian" | "Industrial" | "Mid-Century"
  projectBudget?:    string    // e.g. "$45,000"
  projectDuration?:  string    // e.g. "6 weeks"
  materials?:        string[]  // e.g. ["Oak Wood", "Marble", "Brass"]
  swatchColors?:     string[]  // hex colors for material palette

  // ── HR/Culture ────────────────────────────────────────────────────────────
  employeeName?:     string    // employee display name
  employeeYears?:    string    // e.g. "5 years"
  employeeDept?:     string    // e.g. "Engineering"
  employeeQuote?:    string    // short employee quote
  benefits?:         string[]  // e.g. ["Remote Work", "401k Match", "Unlimited PTO"]
  openRoles?:        number    // number of open positions
  cultureStats?:     Array<{ label: string; value: string }>  // e.g. [{ label: "eNPS", value: "72" }]
}

// ── Generic LRU cache ─────────────────────────────────────────────────────────

class LRUCache<V> {
  private readonly max: number
  private readonly map = new Map<string, V>()

  constructor(max: number) { this.max = max }

  get(key: string): V | undefined {
    const val = this.map.get(key)
    if (val === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, val)
    return val
  }

  set(key: string, val: V): void {
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size >= this.max) {
      this.map.delete(this.map.keys().next().value as string)
    }
    this.map.set(key, val)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** MurmurHash3 32-bit — pure JS, no dependencies. Used for shard routing. */
function murmurHash32(str: string): number {
  let h = 0x9747b28c
  for (let i = 0; i < str.length; i++) {
    let k = str.charCodeAt(i)
    k = Math.imul(k, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  h ^= str.length
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function tintColor(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = Math.round(parseInt(h.slice(0, 2), 16) * alpha + 255 * (1 - alpha))
  const g = Math.round(parseInt(h.slice(2, 4), 16) * alpha + 255 * (1 - alpha))
  const b = Math.round(parseInt(h.slice(4, 6), 16) * alpha + 255 * (1 - alpha))
  return `rgb(${r},${g},${b})`
}

/**
 * Return #ffffff or #111111 — whichever achieves better contrast on `hex`.
 * Uses WCAG 2.1 IEC 61966-2-1 sRGB relative luminance, consistent with
 * paletteText / paletteContrastText. Threshold 0.18 ≈ the mathematical
 * crossover where white and #111111 achieve equal contrast ratio.
 */
function contrastText(hex: string): string {
  const h = (hex.startsWith('#') ? hex : '#000000').replace('#', '').padEnd(6, '0')
  const toLinear = (v: number) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  const r = toLinear(parseInt(h.slice(0, 2), 16) / 255)
  const g = toLinear(parseInt(h.slice(2, 4), 16) / 255)
  const b = toLinear(parseInt(h.slice(4, 6), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.18 ? '#ffffff' : '#111111'
}

/** Relative luminance (WCAG 2.1) for a hex color string. */
function relativeLuminance(hex: string): number {
  const h = (hex.startsWith('#') ? hex : '#000000').replace('#', '').padEnd(6, '0')
  const toLinear = (v: number) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  const r = toLinear(parseInt(h.slice(0, 2), 16) / 255)
  const g = toLinear(parseInt(h.slice(2, 4), 16) / 255)
  const b = toLinear(parseInt(h.slice(4, 6), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colors (1–21). */
function wcagContrast(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Ensure `color` has at least `minRatio` contrast against `bg`.
 * If it doesn't, return `contrastText(bg)` (#fff or #111 — guaranteed legible).
 * Use minRatio=4.5 for body/muted text, 3.0 for large display headlines (≥24px bold).
 * This is the universal text-safety net — applied to every text color in every variant.
 */
function ec(color: string, bg: string, minRatio = 4.5): string {
  if (!color || !bg || !color.startsWith('#') || !bg.startsWith('#')) return color
  return wcagContrast(color, bg) >= minRatio ? color : contrastText(bg)
}

/**
 * Decode the DC Y (luma) coefficient from a JPEG baseline image to estimate
 * average luminance. Returns 0–1 (0=black, 1=white). Falls back to 0.5 on error.
 *
 * Algorithm:
 *  1. Scan JPEG markers for DQT (quantization table) → extract Y DC step q0
 *  2. Scan for DHT (Huffman table class=0 id=0) → build DC Y Huffman lookup
 *  3. At SOS, Huffman-decode the first Y DC coefficient from entropy data
 *  4. Apply JPEG level shift: avgY = (dcCoeff × q0 / 8) + 128
 *     (JPEG shifts 8-bit pixels by −128 before DCT; DC coeff = sum/8 for 8×8 block)
 */
function decodeJpegLuma(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return 0.5

  let q0 = 8 // default Y DC quantization step
  const dcYHuff: { code: number; bits: number; value: number }[] = []
  let huffReady = false
  let pos = 2

  while (pos + 3 < bytes.length) {
    if (bytes[pos] !== 0xFF) { pos++; continue }
    // Skip consecutive 0xFF padding bytes
    while (pos + 1 < bytes.length && bytes[pos + 1] === 0xFF) pos++
    const marker = bytes[pos + 1]
    pos += 2
    if (marker === 0xD8 || marker === 0xD9 || marker === 0x01) continue
    if (pos + 2 > bytes.length) break
    const segLen = (bytes[pos] << 8) | bytes[pos + 1]
    if (segLen < 2) break

    if (marker === 0xDB) {
      // DQT — Quantization Table(s)
      let qi = pos + 2
      const end = pos + segLen
      while (qi < end) {
        const precId = bytes[qi++]
        const tableId = precId & 0x0F
        const is16bit = (precId >> 4) !== 0
        if (tableId === 0 && !is16bit && qi < end) q0 = bytes[qi] // Y DC step
        qi += is16bit ? 128 : 64
      }
    } else if (marker === 0xC4) {
      // DHT — Huffman Table(s)
      let hi = pos + 2
      const end = pos + segLen
      while (hi < end) {
        const tcTh = bytes[hi++]
        const tableClass = (tcTh >> 4)
        const tableId = tcTh & 0x0F
        const counts = bytes.slice(hi, hi + 16); hi += 16
        const totalSym = Array.from(counts).reduce((a, b) => a + b, 0)
        const values = bytes.slice(hi, hi + totalSym); hi += totalSym
        if (tableClass === 0 && tableId === 0) {
          // Build DC Y Huffman lookup
          dcYHuff.length = 0
          let code = 0, symIdx = 0
          for (let len = 1; len <= 16; len++) {
            for (let j = 0; j < counts[len - 1]; j++) {
              dcYHuff.push({ code, bits: len, value: values[symIdx++] })
              code++
            }
            code <<= 1
          }
          huffReady = true
        }
      }
    } else if (marker === 0xDA) {
      // SOS — Start of Scan: entropy-coded data follows the SOS header
      if (!huffReady) break
      const sosHdrLen = (bytes[pos] << 8) | bytes[pos + 1]
      let scanPos = pos + sosHdrLen

      // Bit reader with JPEG byte-stuffing (0xFF 0x00 → literal 0xFF)
      let bitBuf = 0, bitsLeft = 0
      const nextByte = (): number => {
        if (scanPos >= bytes.length) return 0
        const b = bytes[scanPos++]
        if (b === 0xFF && scanPos < bytes.length && bytes[scanPos] === 0x00) scanPos++
        return b
      }
      const readBit = (): number => {
        if (bitsLeft === 0) { bitBuf = nextByte(); bitsLeft = 8 }
        return (bitBuf >> --bitsLeft) & 1
      }

      // Huffman-decode the DC Y category (= number of additional coefficient bits)
      let accCode = 0, dcCategory = -1
      for (let len = 1; len <= 16; len++) {
        accCode = (accCode << 1) | readBit()
        for (const e of dcYHuff) {
          if (e.bits === len && e.code === accCode) { dcCategory = e.value; break }
        }
        if (dcCategory >= 0) break
      }
      if (dcCategory < 0 || dcCategory > 11) break

      // Read dcCategory additional bits for the signed DC coefficient
      let dcCoeff = 0
      for (let i = 0; i < dcCategory; i++) dcCoeff = (dcCoeff << 1) | readBit()
      // Sign-extend: MSB=0 means negative range
      if (dcCategory > 0 && !((dcCoeff >> (dcCategory - 1)) & 1)) {
        dcCoeff -= (1 << dcCategory) - 1
      }

      // Apply JPEG level shift to get average luma (0–255) → normalise to 0–1
      const avgY = (dcCoeff * q0) / 8 + 128
      return Math.max(0, Math.min(1, avgY / 255))
    }

    pos += segLen
  }
  return 0.5 // fallback
}

/**
 * Estimates the average luminance (0–1) of a base64 JPEG data URI by decoding
 * the DC Y coefficient. Returns 0.5 on error or non-JPEG data.
 */
function estimateBgLuminance(dataUri: string): number {
  try {
    const b64 = dataUri.replace(/^data:[^;]+;base64,/, '')
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return decodeJpegLuma(bytes)
  } catch {
    return 0.5
  }
}

/** Replace {{key}} tokens in text with values from the tokens map. */
function applyTokens(text: string | undefined, tokens: Record<string, string>): string | undefined {
  if (!text || Object.keys(tokens).length === 0) return text
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => tokens[key] ?? `{{${key}}}`)
}

/** Bump this whenever rendering code changes that should invalidate all cached renders. */
const RENDER_VERSION = 'rv4'

function makeCacheKey(opts: CardOpts): string {
  return [
    RENDER_VERSION,
    opts.variant ?? 'editorial-hero',
    opts.headline, opts.brandName, opts.primaryColor,
    opts.preset ?? '',
    opts.width  ?? 600,
    opts.height ?? 314,
    opts.bgImageUrl ?? (opts.bgImageData ?? '').slice(0, 48),
    opts.format ?? 'png',
    opts.aesthetic ?? 'modern-sans',
    opts.price ?? '', opts.ctaText ?? '', opts.ctaColor ?? '',
    opts.couponCode ?? '', opts.expiryText ?? '',
    opts.reviewerName ?? '', opts.rating ?? '',
    opts.eventDate ?? '', opts.eventTime ?? '', opts.eventLocation ?? '',
    JSON.stringify(opts.tokens ?? {}),
  ].join('\x00')
}

/** True if any character in `text` is Arabic or Hebrew (requires RTL layout). */
function isRTL(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF]/.test(text)
}

// ── Pexels auto-image sourcing ────────────────────────────────────────────────

// ── Claude Haiku query generation ─────────────────────────────────────────────

/**
 * Use Claude Haiku to generate a highly contextual Pexels search query.
 *
 * Sends a compact prompt with variant + headline + brand to Haiku and asks for
 * a 5-7 word photography search query. Max 30 output tokens → costs ~$0.00025.
 *
 * Falls back to `buildImageQueryFallback()` if ANTHROPIC_API_KEY is not set
 * or if the API call fails for any reason.
 */
async function buildImageQuery(opts: CardOpts, env: Env): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) return buildImageQueryFallback(opts)

  const prompt =
    `You are a Pexels stock photography search expert helping generate background images for ad creatives.\n` +
    `Given this ad card context, write a 5-7 word Pexels search query that will find the most visually compelling and on-brand background image.\n` +
    `Return ONLY the search query — no quotes, no explanation, no punctuation at the end.\n\n` +
    `Variant: ${opts.variant ?? 'editorial-hero'}\n` +
    `Brand: ${opts.brandName}\n` +
    `Headline: "${opts.headline}"` +
    (opts.subheadline ? `\nSubheadline: "${opts.subheadline}"` : '') +
    (opts.stat        ? `\nStat: ${opts.stat}`                 : '')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 30,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.warn(`[claude-query] Haiku API ${res.status} — falling back to static`)
      return buildImageQueryFallback(opts)
    }

    const data  = await res.json() as { content: Array<{ text: string }> }
    const query = data.content?.[0]?.text?.trim().toLowerCase().replace(/['"]/g, '') ?? ''

    if (!query) return buildImageQueryFallback(opts)

    console.log(`[claude-query] "${opts.headline.slice(0, 40)}" → "${query}"`)
    return query.slice(0, 120)

  } catch (e) {
    console.warn('[claude-query] fetch failed — falling back to static:', e)
    return buildImageQueryFallback(opts)
  }
}

/** Static fallback: variant-style hints + stop-word-filtered headline keywords. */
function buildImageQueryFallback(opts: CardOpts): string {
  const STOP = new Set([
    'the','a','an','is','are','was','were','be','been','have','has','had',
    'do','does','did','will','would','could','should','may','might','can',
    'to','of','in','on','at','for','with','by','from','and','but','or',
    'not','very','just','your','our','my','this','that','get','make','new',
  ])
  const HINTS: Record<string, string> = {
    'recipe-hero':      'food photography cooking kitchen',
    'tip-card':         'minimal clean workspace desk',
    'editorial-hero':   'lifestyle editorial photography',
    'feature-split':    'lifestyle brand product',
    'announcement':     'brand campaign bold',
    'quote-overlay':    'abstract texture minimal background',
    'benefit-strip':    'lifestyle wellness health',
    'stat-hero':        'business growth data analytics',
    'product-showcase': 'product lifestyle photography',
    'coupon-offer':     'sale shopping retail store',
    'testimonial':      'portrait professional person smiling',
    'event-card':       'event venue gathering crowd',
    'video-thumbnail':  'cinematic dramatic scene landscape',
    'before-after':    'transformation comparison result change progress',
    'pricing-card':    'business growth investment pricing value clean',
    'social-proof':    'professional team meeting collaboration trust',
    'countdown-timer': 'urgency time limited sale flash offer',
    'app-screenshot':  'mobile app smartphone technology lifestyle',
    'job-posting':     'office professional career hiring workspace',
    'podcast-cover':   'podcast microphone studio recording audio',
  }
  const hint  = HINTS[opts.variant ?? 'editorial-hero'] ?? 'lifestyle photography'
  const words = opts.headline.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w)).slice(0, 3).join(' ')
  return [words, hint].filter(Boolean).join(' ').slice(0, 120)
}


/**
 * Search Pexels for a relevant image and return the `large2x` photo URL.
 * Picks randomly from the top 5 results so repeated renders vary.
 */
async function pexelsSearch(
  query:       string,
  apiKey:      string,
  orientation: 'landscape' | 'portrait' | 'square' = 'landscape',
): Promise<string | null> {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${orientation}`
  try {
    const res = await fetch(url, { headers: { Authorization: apiKey } })
    if (!res.ok) {
      console.warn(`[pexels] API error ${res.status} for query: "${query}"`)
      return null
    }
    const data = await res.json() as {
      photos: Array<{ src: { large2x: string; large: string } }>
    }
    if (!data.photos?.length) {
      console.warn(`[pexels] zero results for query: "${query}"`)
      return null
    }
    const photo = data.photos[Math.floor(Math.random() * data.photos.length)]
    return photo.src.large2x || photo.src.large || null
  } catch (e) {
    console.warn('[pexels] fetch failed:', e)
    return null
  }
}

/**
 * Score an extracted hex color for confidence that it is a real brand color.
 * Returns 0 (do not cache/use), 0.6 (tentative, cache 1 day), or 1.0 (confident, cache 7 days).
 */
function colorConfidence(hex: string): number {
  const h = hex.replace('#', '').toLowerCase().padEnd(6, '0')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = max === min ? 0 : (l > 0.5 ? d / (2 - max - min) : d / (max + min))

  // Near-white or near-black → low confidence (spinner pages, default backgrounds)
  if (l > 0.90 || l < 0.08) return 0
  // Near-gray (achromatic) → low confidence (likely a default/fallback)
  if (s < 0.08) return 0

  const GENERIC = ['#ffffff','#f5f5f5','#eeeeee','#e5e5e5','#cccccc','#999999',
                   '#666666','#333333','#111111','#000000','#f0f0f0','#fafafa']
  if (GENERIC.includes('#' + h)) return 0

  // High confidence: saturated and mid-luminance (real brand colors: s > 0.30, l 0.25–0.75)
  if (s >= 0.30 && l >= 0.25 && l <= 0.75) return 1.0

  // Medium confidence: decent saturation
  if (s >= 0.15) return 0.6

  return 0.3
}

type BrandColorSource = 'theme-color' | 'css-var' | 'pixel-freq' | 'cache' | 'failed'

/**
 * Extract the primary brand color from a URL.
 * Priority: theme-color meta → CSS custom props (--primary/--brand/--accent) → most-frequent mid-range hex.
 * Returns { color, source } — source indicates how the color was obtained.
 * High-confidence colors cached 7 days; medium-confidence cached 1 day.
 */
async function extractBrandColor(
  url: string,
  kv: KVNamespace | undefined,
): Promise<{ color: string; source: BrandColorSource }> {
  if (!kv) return { color: '', source: 'failed' }

  const cacheKey = `brandcolor:${await sha256Hex(url)}`
  const cached = await kv.get(cacheKey, { type: 'json' }) as { color: string; source: string } | null
  if (cached) {
    if (cached.source === 'failed') {
      // Negative cache — extraction previously failed; skip the 6s fetch attempt
      console.log(`[brand] negative-cache hit — ${url} (skipping re-fetch)`)
      return { color: '', source: 'failed' }
    }
    if (cached.color) {
      console.log(`[brand] cache hit — ${url} → ${cached.color}`)
      return { color: cached.color, source: 'cache' }
    }
  }

  // Single outer AbortController with 6s total budget covers the HTML fetch
  // AND all subsequent CSS fetches. Aborting it cancels every in-flight sub-fetch
  // so no Worker CPU continues burning after the budget expires.
  const outer  = new AbortController()
  const outerTimer = setTimeout(() => outer.abort(), 6000)
  const UA = 'Mozilla/5.0 (compatible; MailcraftBot/1.0; +https://mailcraft.io/bot)'

  try {
    const res = await fetch(url, { signal: outer.signal, headers: { 'User-Agent': UA } })
    if (!res.ok) {
      clearTimeout(outerTimer)
      kv?.put(cacheKey, JSON.stringify({ color: '', source: 'failed' }), { expirationTtl: 3600 }).catch(() => {})
      return { color: '', source: 'failed' }
    }
    const html = await res.text()

    // Helper: cache a color based on its confidence score, then return result
    const cacheAndReturn = (color: string, source: BrandColorSource): { color: string; source: BrandColorSource } | null => {
      const conf = colorConfidence(color)
      if (conf === 0) {
        console.log(`[brand] low-confidence ${source} — ${url} → ${color} (skipped)`)
        return null
      }
      const ttl = conf >= 0.6 ? 604800 : 86400
      kv?.put(cacheKey, JSON.stringify({ color, source }), { expirationTtl: ttl }).catch(() => {})
      console.log(`[brand] ${source} (conf=${conf.toFixed(1)}, ttl=${ttl}s) — ${url} → ${color}`)
      return { color, source }
    }

    // Priority 1 — <meta name="theme-color" content="#rrggbb">
    const themeA = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[a-fA-F0-9]{6})["']/i)
    const themeB = html.match(/<meta[^>]+content=["'](#[a-fA-F0-9]{6})["'][^>]+name=["']theme-color["']/i)
    const theme  = (themeA ?? themeB)?.[1] ?? null
    if (theme) {
      const result = cacheAndReturn(theme, 'theme-color')
      if (result) { clearTimeout(outerTimer); return result }
      // Low confidence — fall through to next priority
    }

    // Priority 2 — CSS custom property --primary / --brand / --accent / --color-primary
    // Search inline HTML first, then fetch up to 3 external stylesheets (Vercel/Next.js/Remix
    // define CSS variables exclusively in external bundles, never inlined in the HTML document).
    // All CSS fetches share the outer AbortController — aborting it cancels them all.
    const CSS_VAR_RE = /--(?:primary|brand|accent|color-primary|main-color)[-\w]*\s*:\s*(#[a-fA-F0-9]{6})/gi
    const inlineCssMatches = [...html.matchAll(CSS_VAR_RE)]
    const allCssSources: string[] = inlineCssMatches.map(m => m[1])

    if (allCssSources.length === 0) {
      // Extract <link rel="stylesheet" href="..."> from HTML, prefer design-token files
      const linkHrefs = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)]
        .map(m => m[1])
        .filter(href => !href.includes('font') && !href.includes('icon') && !href.includes('print'))
        .slice(0, 3)
      const baseUrl = new URL(url)
      const cssResults = await Promise.allSettled(
        linkHrefs.map(async href => {
          const cssUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString()
          try {
            // Reuse outer signal — CSS fetches are cancelled when the 6s budget expires
            const r = await fetch(cssUrl, { signal: outer.signal, headers: { 'User-Agent': UA } })
            if (!r.ok) return ''
            return await r.text()
          } catch { return '' }
        })
      )
      for (const res of cssResults) {
        if (res.status === 'fulfilled' && res.value) {
          for (const m of res.value.matchAll(CSS_VAR_RE)) allCssSources.push(m[1])
        }
      }
    }

    if (allCssSources.length > 0) {
      // Prefer the most-frequently repeated value (dark/light-mode duplication means one value appears 2x)
      const freq: Record<string, number> = {}
      for (const c of allCssSources) freq[c.toUpperCase()] = (freq[c.toUpperCase()] ?? 0) + 1
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
      for (const [color] of sorted) {
        const result = cacheAndReturn(color, 'css-var')
        if (result) { clearTimeout(outerTimer); return result }
      }
      // Low confidence — fall through to next priority
    }

    // Priority 3 — most-frequent mid-luminance hex in page (skip near-black/near-white)
    const hexes = [...html.matchAll(/#([a-fA-F0-9]{6})\b/g)].map(m => '#' + m[1].toUpperCase())
    const midHexes = hexes.filter(c => {
      const h = c.replace('#', '')
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      return lum > 0.08 && lum < 0.82
    })
    if (midHexes.length > 0) {
      const freq: Record<string, number> = {}
      for (const c of midHexes) freq[c] = (freq[c] ?? 0) + 1
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
      // Try candidates in frequency order, skip low-confidence ones
      for (const [candidate] of sorted) {
        const result = cacheAndReturn(candidate, 'pixel-freq')
        if (result) { clearTimeout(outerTimer); return result }
      }
    }

    clearTimeout(outerTimer)
    kv?.put(cacheKey, JSON.stringify({ color: '', source: 'failed' }), { expirationTtl: 3600 }).catch(() => {})
    return { color: '', source: 'failed' }
  } catch (e) {
    clearTimeout(outerTimer)
    console.warn(`[brand] extraction failed for ${url}:`, e)
    kv?.put(cacheKey, JSON.stringify({ color: '', source: 'failed' }), { expirationTtl: 3600 }).catch(() => {})
    return { color: '', source: 'failed' }
  }
}

/**
 * If `opts` has no `bgImageUrl`/`bgImageData`, auto-source a Pexels image.
 *
 * Two-tier KV cache:
 *   1. `query:{sha256(variant|headline|brand)}`  → Claude-generated query string (7-day TTL)
 *      Ensures each unique card context calls Claude at most once per week.
 *   2. `pexels:{sha256(query)}`                  → Pexels photo URL (24-hour TTL)
 *      Ensures the same query never hits Pexels more than once per day.
 *
 * On a fully warm cache: 0 external API calls, ~0 added latency.
 */
async function maybeAutoSourceBg(opts: CardOpts, env: Env): Promise<CardOpts> {
  if (opts.bgImageUrl || opts.bgImageData) return opts
  if (!env.PEXELS_API_KEY) return opts

  // ── Tier-1: query cache (Claude result) ──────────────────────────────────
  const contextKey = `query:${await sha256Hex(`${opts.variant}|${opts.headline}|${opts.brandName}`)}`
  let query: string

  if (env.API_KEYS) {
    const cachedQuery = await env.API_KEYS.get(contextKey)
    if (cachedQuery) {
      query = cachedQuery
      console.log(`[query-cache] hit — "${opts.headline.slice(0, 40)}" → "${query}"`)
    } else {
      query = await buildImageQuery(opts, env)
      // Cache query for 7 days — Claude only called once per week per unique card context
      env.API_KEYS.put(contextKey, query, { expirationTtl: 604800 }).catch(() => {})
    }
  } else {
    query = await buildImageQuery(opts, env)
  }

  // ── Tier-2: photo URL cache (Pexels result) ───────────────────────────────
  const photoKey = `pexels:${await sha256Hex(query)}`

  if (env.API_KEYS) {
    const cachedUrl = await env.API_KEYS.get(photoKey)
    if (cachedUrl) {
      console.log(`[pexels] cache hit — "${query}" → ${cachedUrl.slice(0, 60)}…`)
      return { ...opts, bgImageUrl: cachedUrl }
    }
  }

  // ── Live Pexels fetch ─────────────────────────────────────────────────────
  const preset = opts.preset
  const orientation: 'portrait' | 'square' | 'landscape' =
    preset === 'instagram-story' || preset === 'half-page' || preset === 'pinterest' || preset === 'wide-skyscraper' ? 'portrait' :
    preset === 'instagram-square' || preset === 'medium-rectangle'                                                   ? 'square'   :
    'landscape'

  const photoUrl = await pexelsSearch(query, env.PEXELS_API_KEY, orientation)
  if (!photoUrl) return opts

  console.log(`[pexels] fetched "${query}" → ${photoUrl.slice(0, 60)}…`)

  if (env.API_KEYS) {
    env.API_KEYS.put(photoKey, photoUrl, { expirationTtl: 86400 }).catch(() => {})
  }

  return { ...opts, bgImageUrl: photoUrl }
}

// ── Aesthetic register typography + color tokens ──────────────────────────────

interface AestheticTokens {
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

function getAestheticFonts(aesthetic: AestheticRegister = 'modern-sans'): AestheticTokens {
  switch (aesthetic) {
    case 'editorial-serif':
      return {
        headlineFamily: 'Playfair Display', headlineWeight: 400, headlineStyle: 'italic',
        headlineLetterSpacing: 0, headlineTransform: 'none',
        quoteWeight: 400, quoteStyle: 'italic',
        brandFamily: 'Inter', brandWeight: 700, brandLetterSpacing: 4, brandTransform: 'uppercase',
        quoteFamily: 'Playfair Display',
        subheadlineFamily: 'Inter', subheadlineWeight: 400, subheadlineLineHeight: 1.6,
        panelBg: '#f5f1eb',
        lightPanelText: '#1a1a1a', lightPanelMuted: 'rgba(0,0,0,0.50)',
        overlayOpacity: 0.68, accentOverride: null, quoteGlyphColor: null,
      }
    case 'luxury':
      return {
        headlineFamily: 'Cormorant Garamond', headlineWeight: 600, headlineStyle: 'normal',
        headlineLetterSpacing: 2, headlineTransform: 'none',
        quoteWeight: 600, quoteStyle: 'italic',
        brandFamily: 'Cormorant Garamond', brandWeight: 400, brandLetterSpacing: 8, brandTransform: 'uppercase',
        quoteFamily: 'Cormorant Garamond',
        subheadlineFamily: 'Inter', subheadlineWeight: 400, subheadlineLineHeight: 1.7,
        panelBg: '#faf7f2',
        lightPanelText: '#1a1a1a', lightPanelMuted: 'rgba(0,0,0,0.45)',
        overlayOpacity: 0.88, accentOverride: '#c9a96e', quoteGlyphColor: '#c9a96e',
      }
    case 'warm-script':
      return {
        headlineFamily: 'Dancing Script', headlineWeight: 700, headlineStyle: 'normal',
        headlineLetterSpacing: 0, headlineTransform: 'none',
        quoteWeight: 700, quoteStyle: 'normal',
        brandFamily: 'Inter', brandWeight: 700, brandLetterSpacing: 3, brandTransform: 'uppercase',
        quoteFamily: 'Dancing Script',
        subheadlineFamily: 'Dancing Script', subheadlineWeight: 400, subheadlineLineHeight: 1.5,
        panelBg: '#faf9f7',
        lightPanelText: '#1a1a1a', lightPanelMuted: 'rgba(0,0,0,0.50)',
        overlayOpacity: 0.72, accentOverride: null, quoteGlyphColor: null,
      }
    case 'bold-condensed':
      return {
        headlineFamily: 'Bebas Neue', headlineWeight: 400, headlineStyle: 'normal',
        headlineLetterSpacing: 4, headlineTransform: 'uppercase',
        quoteWeight: 400, quoteStyle: 'normal',
        brandFamily: 'Bebas Neue', brandWeight: 400, brandLetterSpacing: 8, brandTransform: 'uppercase',
        quoteFamily: 'Inter',
        subheadlineFamily: 'Inter', subheadlineWeight: 500, subheadlineLineHeight: 1.2,
        panelBg: '#111111',
        lightPanelText: '#ffffff', lightPanelMuted: 'rgba(255,255,255,0.65)',
        overlayOpacity: 0.88, accentOverride: null, quoteGlyphColor: null,
      }
    case 'brutalist':
      return {
        headlineFamily: 'Bebas Neue', headlineWeight: 400, headlineStyle: 'normal',
        headlineLetterSpacing: 6, headlineTransform: 'uppercase',
        quoteWeight: 400, quoteStyle: 'normal',
        brandFamily: 'Inter', brandWeight: 900, brandLetterSpacing: 10, brandTransform: 'uppercase',
        quoteFamily: 'Inter',
        subheadlineFamily: 'Inter', subheadlineWeight: 700, subheadlineLineHeight: 1.1,
        panelBg: '#000000',
        lightPanelText: '#ffffff', lightPanelMuted: 'rgba(255,255,255,0.60)',
        overlayOpacity: 0.95, accentOverride: null, quoteGlyphColor: null,
      }
    case 'glassmorphism':
      return {
        headlineFamily: 'Inter', headlineWeight: 700, headlineStyle: 'normal',
        headlineLetterSpacing: -0.5, headlineTransform: 'none',
        quoteWeight: 400, quoteStyle: 'normal',
        brandFamily: 'Inter', brandWeight: 600, brandLetterSpacing: 3, brandTransform: 'uppercase',
        quoteFamily: 'Inter',
        subheadlineFamily: 'Inter', subheadlineWeight: 400, subheadlineLineHeight: 1.6,
        panelBg: 'rgba(255,255,255,0.12)',
        lightPanelText: '#ffffff', lightPanelMuted: 'rgba(255,255,255,0.65)',
        overlayOpacity: 0.55, accentOverride: null, quoteGlyphColor: null,
      }
    case 'retro':
      return {
        headlineFamily: 'Bebas Neue', headlineWeight: 400, headlineStyle: 'normal',
        headlineLetterSpacing: 5, headlineTransform: 'uppercase',
        quoteWeight: 700, quoteStyle: 'normal',
        brandFamily: 'Bebas Neue', brandWeight: 400, brandLetterSpacing: 8, brandTransform: 'uppercase',
        quoteFamily: 'Playfair Display',
        subheadlineFamily: 'Inter', subheadlineWeight: 400, subheadlineLineHeight: 1.45,
        panelBg: '#fff8e7',
        lightPanelText: '#2a1a0a', lightPanelMuted: 'rgba(42,26,10,0.55)',
        overlayOpacity: 0.78, accentOverride: null, quoteGlyphColor: null,
      }
    case 'minimalist-luxury':
      return {
        headlineFamily: 'Cormorant Garamond', headlineWeight: 400, headlineStyle: 'normal',
        headlineLetterSpacing: 4, headlineTransform: 'none',
        quoteWeight: 400, quoteStyle: 'italic',
        brandFamily: 'Inter', brandWeight: 300, brandLetterSpacing: 12, brandTransform: 'uppercase',
        quoteFamily: 'Cormorant Garamond',
        subheadlineFamily: 'Inter', subheadlineWeight: 300, subheadlineLineHeight: 1.8,
        panelBg: '#f9f8f6',
        lightPanelText: '#1a1a1a', lightPanelMuted: 'rgba(0,0,0,0.40)',
        overlayOpacity: 0.65, accentOverride: '#b8a88a', quoteGlyphColor: '#b8a88a',
      }
    case 'modern-sans':
    default:
      return {
        headlineFamily: 'Inter', headlineWeight: 800, headlineStyle: 'normal',
        headlineLetterSpacing: -1, headlineTransform: 'none',
        quoteWeight: 400, quoteStyle: 'normal',
        brandFamily: 'Inter', brandWeight: 700, brandLetterSpacing: 4, brandTransform: 'uppercase',
        quoteFamily: 'Playfair Display',
        subheadlineFamily: 'Inter', subheadlineWeight: 400, subheadlineLineHeight: 1.55,
        panelBg: '#faf9f7',
        lightPanelText: '#1a1a1a', lightPanelMuted: 'rgba(0,0,0,0.50)',
        overlayOpacity: 0.72, accentOverride: null, quoteGlyphColor: null,
      }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCardJSX(variant: CardVariantName, opts: {
  headline: string; subheadline?: string; stat?: string
  brandName: string; primaryColor: string; bgImageData?: string
  bgIsLight?: boolean  // true → light bg image — use dark scrim + dark text
  w: number; h: number; txt: string; muted: string; accent: string
  rtl: boolean; aesthetic: AestheticRegister
  // vertical theme — canvasBg is required; both callers (SatoriDO and recursive fallback)
  // always supply it from resolveVerticalContext(). Making it required eliminates the
  // dead null-branch in smartBgCtx and the redundant resolveVerticalContext fallback call.
  canvasBg: string; bgStyle?: string; isDark?: boolean; palette?: ColorPalette
  // ad creative extended fields
  price?: string; ctaText?: string; ctaColor?: string
  couponCode?: string; expiryText?: string
  reviewText?: string; reviewerName?: string; reviewerTitle?: string; rating?: number
  eventDate?: string; eventTime?: string; eventLocation?: string
  // new variant fields
  beforeText?: string; afterText?: string; beforeLabel?: string; afterLabel?: string
  plans?: Array<{ name: string; price: string; period?: string; features?: string[]; highlighted?: boolean }>
  logos?: string[]; tagline?: string
  timerDays?: number; timerHours?: number; timerMins?: number; timerSecs?: number
  appRating?: number; appDownloads?: string
  jobTitle?: string; location?: string; jobType?: string; salary?: string; skills?: string[]
  episodeNumber?: string; host?: string
  // logo + new variant fields
  logoData?: string
  originalPrice?: string; badge?: string; productCategory?: string; stockCount?: number
  propertyPrice?: string; bedrooms?: number; bathrooms?: number; sqft?: string; agentName?: string; propertyAddress?: string
  beforeStat?: string; afterStat?: string; duration?: string; classTime?: string; classDuration?: string; instructor?: string; classType?: string
  courseName?: string; courseLevel?: string; lessonCount?: number; studentCount?: string; certificateName?: string; recipientName?: string; completionDate?: string
  ticker?: string; priceChange?: string; positive?: boolean; interestRate?: string; rateType?: string; chartData?: number[]
  dishName?: string; dishPrice?: string; dietaryTags?: string[]; prepTime?: string; calories?: string
  changelogItems?: string[]; version?: string; waitlistCount?: string; launchDate?: string; featureIcon?: string
  // media
  spotifyTrack?: string; spotifyArtist?: string; spotifyProgress?: number
  streamViewers?: string; releaseDate?: string; genre?: string; gameTitle?: string
  listens?: string; trackCount?: number; podcastEpisodes?: number; podcastListeners?: string
  // social/tech
  tweetText?: string; tweetHandle?: string; tweetLikes?: string; tweetRetweets?: string
  githubRepo?: string; githubStars?: string; githubForks?: string
  packageName?: string; packageVersion?: string; packageDownloads?: string
  statusItems?: Array<{ name: string; status: 'operational' | 'degraded' | 'outage' }>
  codeLanguage?: string; codeLines?: string[]; uptime?: string
  releaseVersion?: string; releaseChanges?: string[]
  upvotes?: string; comments?: string; subreddit?: string
  // business/sports/gaming
  teamA?: string; teamB?: string; scoreA?: string; scoreB?: string; matchStatus?: string
  leaderboardItems?: Array<{ rank: number; name: string; score: string; change?: 'up' | 'down' | 'same' }>
  invoiceNumber?: string; invoiceAmount?: string; invoiceDue?: string
  achievement?: string; xpGained?: string
  playerSport?: string; playerPosition?: string; playerStats?: Array<{ label: string; value: string }>
  matchDate?: string; matchVenue?: string
  phone?: string; email?: string; website?: string
  proposalClient?: string; proposalValue?: string; proposalDue?: string
  // content/reviews
  issueNumber?: string; author?: string; isbn?: string; readTime?: string
  category?: string; publishDate?: string; reviewCount?: string; reviewPlatform?: string
  npsScore?: number; promoters?: number; detractors?: number
  giftAmount?: string; giftFrom?: string; loyaltyPoints?: string; loyaltyTier?: string
  caseStudyResult?: string; caseStudyClient?: string
  // lifestyle/health/finance
  referralBonus?: string; alcoholContent?: string; servings?: string
  exercises?: Array<{ name: string; sets?: string; reps?: string }>
  habitItems?: Array<{ name: string; done: boolean }>
  cryptoSymbol?: string; cryptoPrice?: string; marketCap?: string
  portfolioValue?: string; portfolioChange?: string
  savingsGoal?: string; savedAmount?: string; savingsProgress?: number
  steps?: string; heartRate?: string; sleepHours?: string
  appointmentType?: string; appointmentTime?: string; providerName?: string
  destination?: string; travelDuration?: string; travelPrice?: string
  rsvpDeadline?: string; cocktailIngredients?: string[]
  // automotive
  vehicleMake?: string; vehicleModel?: string; vehicleYear?: number
  vehicleMileage?: string; vehicleEngine?: string; vehicleColor?: string
  vehicleFeatures?: string[]; vehicleCondition?: string
  // fashion
  lookbookItems?: string[]; styleTag?: string; collection?: string
  sizes?: string[]; material?: string; colorways?: string[]
  // web3/nft
  nftName?: string; nftPrice?: string; nftEdition?: string; blockchain?: string
  mintDate?: string; totalSupply?: string; floorPrice?: string; holderCount?: string
  daoName?: string; proposalId?: string; tokenSymbol?: string; tokenPrice?: string; tokenChange?: string
  // nonprofit
  donationGoal?: string; donationRaised?: string; donationProgress?: number
  donorCount?: string; impactStat?: string; impactLabel?: string; causeTag?: string; volunteerCount?: string
  // interior
  roomType?: string; designStyle?: string; projectBudget?: string; projectDuration?: string
  materials?: string[]; swatchColors?: string[]
  // hr/culture
  employeeName?: string; employeeYears?: string; employeeDept?: string; employeeQuote?: string
  benefits?: string[]; openRoles?: number; cultureStats?: Array<{ label: string; value: string }>
}): any {
  const { stat, brandName, primaryColor, bgImageData,
          w, h, txt, muted, accent, rtl, aesthetic } = opts
  const bgIsLight   = opts.bgIsLight ?? false
  const headline    = opts.headline    ?? ''
  const subheadline = opts.subheadline ?? ''

  // Scale factor relative to base 600×314 — fonts and spacing adapt to any format preset
  const scale = Math.sqrt((w * h) / (600 * 314))
  const s = (v: number): number => Math.round(v * scale)

  const tk = getAestheticFonts(aesthetic)

  const accentBar  = tk.accentOverride ?? primaryColor
  const quoteGlyph = tk.quoteGlyphColor ?? primaryColor

  const lightTxt   = tk.lightPanelText
  const lightMuted = tk.lightPanelMuted

  const brandPanelTxt   = aesthetic === 'bold-condensed' ? tk.lightPanelText   : txt
  const brandPanelMuted = aesthetic === 'bold-condensed' ? tk.lightPanelMuted  : muted

  const textDir   = rtl ? 'rtl'   as const : 'ltr'   as const
  const textAlign = rtl ? 'right' as const : 'left'  as const

  // canvasBg is required — callers (DO path, recursive editorial-hero fallback) always
  // provide it from resolveVerticalContext(). Non-optional contract eliminates the
  // dead null-branch and the redundant resolveVerticalContext() fallback call.
  const smartBgCtx = {
    canvasBg: opts.canvasBg,
    bgStyle:  (opts.bgStyle ?? 'primaryFlat') as import('./vertical-aesthetics').BgStyle,
    isDark:   opts.isDark ?? false, txt, muted, accent, aesthetic,
    palette:  opts.palette ?? buildColorPalette(primaryColor),
  }

  const palette = smartBgCtx.palette

  // Palette-aware text colors — hued tones instead of flat #fff/#000.
  // resolveTextColors() is the canonical single call-site for paletteText (Gap 3 fix).
  const ptxtBg = smartBgCtx.canvasBg
  const { ptxt: rawPtxt, pbody: rawPbody, pmuted: rawPmuted } = resolveTextColors(ptxtBg, palette)
  // ec() = ensureContrast: if the palette-derived color falls below WCAG threshold on its
  // actual background, substitute #fff or #111 — the universal text-safety net for all variants.
  const ptxt    = ec(rawPtxt,   ptxtBg)
  const pbody   = ec(rawPbody,  ptxtBg, 3.5)
  const pmuted  = ec(rawPmuted, ptxtBg, 3.0)

  // Always-available dark-surface and light-surface text variants.
  // Variant cases that render on a dark photo scrim use ptxtDark/pbodyDark/pmutedDark.
  // Variant cases that render on a light panel use ptxtLight/pbodyLight/pmutedLight.
  const ptxtDark    = ec(paletteText(palette.shade900, palette, 'headline'), palette.shade900)
  const pbodyDark   = ec(paletteText(palette.shade900, palette, 'body'),     palette.shade900, 3.5)
  const pmutedDark  = ec(paletteText(palette.shade900, palette, 'muted'),    palette.shade900, 3.0)
  const ptxtLight   = ec(paletteText(palette.tint100,  palette, 'headline'), palette.tint100)
  const pbodyLight  = ec(paletteText(palette.tint100,  palette, 'body'),     palette.tint100, 3.5)
  const pmutedLight = ec(paletteText(palette.tint100,  palette, 'muted'),    palette.tint100, 3.0)

  // Responsive layout tokens — scale headlines/subheads/padding to aspect ratio
  const layout = resolveLayout(w, h)
  const sh = (n: number): number => Math.round(s(n) * layout.headlineScale)
  const sb = (n: number): number => Math.round(s(n) * layout.subScale)
  const g8 = (v: number): number => Math.round(v / 8) * 8
  const sp = (n: number): number => g8(Math.round(s(n) * layout.paddingScale))
  // Display-scale tier: ~1.25× headlineScale for short (≤4 word) headlines treated as impact statements
  const sd = (n: number): number => Math.round(s(n) * layout.displayScale)
  // Display tier guard — word count AND char budget (4 long words at displayScale=1.60 can overflow story canvas)
  const isDisplay = (hl: string): boolean => hl.trim().split(/\s+/).length <= 4 && hl.trim().length <= 24
  // RTL-safe layout text align: respects rtl direction over aspect-ratio preference
  const lta = rtl ? 'right' as const : layout.textAlign

  const photoBgLayers = (overlayOpacity: number): object[] => bgImageData ? [
    { type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', objectPosition: 'center' } } },
    // Light bg image → white scrim so dark text reads cleanly; dark bg → dark scrim for white text
    { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: bgIsLight ? '#ffffff' : (smartBgCtx.isDark ? palette.shade900 : palette.shade600),
      opacity: bgIsLight ? 0.60 : overlayOpacity } } },
  ] : buildSmartBgLayers(smartBgCtx as Parameters<typeof buildSmartBgLayers>[0], primaryColor, w, h) as object[]

  // Decorative accent geometry — injected after bg, before content in core variants
  const photoBgAccents = (): object[] =>
    buildDecorativeAccents(smartBgCtx.bgStyle as Parameters<typeof buildDecorativeAccents>[0], primaryColor, smartBgCtx.isDark, w, h, s) as object[]

  // Brand badge helper — pill/eyebrow/inline treatment for the brand lockup
  const brandBadge = (style: 'pill' | 'inline' | 'eyebrow' = 'inline'): object =>
    buildBrandBadge({ brandName, primaryColor, isDark: smartBgCtx?.isDark ?? false, style, s, tk, logoData: opts.logoData ?? undefined })

  // ── Banner override — leaderboard (728×90), mobile banner (320×50), etc. ───
  if (h < 150) {
    const ctaLabel  = opts.ctaText ?? ''
    const ctaBg     = opts.ctaColor ?? accentBar
    const ctaTxt2   = contrastText(ctaBg)
    const bFont     = Math.round(h * 0.28)
    const brandFont = Math.round(h * 0.18)
    const ctaFont   = Math.round(h * 0.22)
    const padV      = Math.round(h * 0.22)
    const padH      = Math.round(h * 0.28)
    return { type: 'div', props: { style: { width: w, height: h, display: 'flex', overflow: 'hidden', position: 'relative', fontFamily: 'Inter', background: primaryColor, alignItems: 'center', justifyContent: 'space-between', paddingLeft: padH, paddingRight: padH, direction: textDir }, children: [
      ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', opacity: 0.30 } } }] : []),
      { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: 0, flex: 1, overflow: 'hidden' }, children: [
        { type: 'div', props: { style: { fontSize: brandFont, fontWeight: tk.brandWeight, letterSpacing: Math.min(tk.brandLetterSpacing, 2), textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: 'rgba(255,255,255,0.55)', lineHeight: 1 }, children: brandName } },
        { type: 'div', props: { style: { fontSize: bFont, fontWeight: 800, color: txt, lineHeight: 1.1 }, children: headline.slice(0, 50) } },
      ] } },
      ...(ctaLabel ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: ctaBg, color: ctaTxt2, fontSize: ctaFont, fontWeight: 700, fontFamily: 'Inter', textTransform: 'uppercase' as const, letterSpacing: 1, paddingTop: padV, paddingBottom: padV, paddingLeft: Math.round(padH * 0.8), paddingRight: Math.round(padH * 0.8), borderRadius: Math.round(h * 0.1), flexShrink: 0, marginLeft: padH }, children: ctaLabel } }] : []),
    ] } }
  }

  switch (variant) {

    // ── Existing 8 variants (scale applied) ───────────────────────────────────

    case 'stat-hero': {
      const statVal   = stat ?? headline.match(/\d[\d.,×xX%]+/)?.[0] ?? '10×'
      const useD      = !!bgImageData && !bgIsLight
      const cardTxt   = useD ? ptxtDark   : ptxt
      const cardBody  = useD ? pbodyDark  : pbody
      const cardMuted = useD ? pmutedDark : pmuted
      const decBorder = useD ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'
      const shCtaText = opts.ctaText as string | undefined
      const ctaBg     = accentBar
      const ctaTxt    = contrastText(ctaBg)
      const brandNode = { type: 'div', props: { style: { fontSize: s(13), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: cardMuted, textAlign }, children: brandName } }
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor, direction: textDir }, children: [
        ...photoBgLayers(tk.overlayOpacity),
        ...photoBgAccents(),
        { type: 'div', props: { style: { position: 'absolute', top: s(-110), right: s(-110), width: s(420), height: s(420), borderRadius: 999, border: `2px solid ${decBorder}` } } },
        { type: 'div', props: { style: { position: 'absolute', top: s(-50), right: s(-50), width: s(240), height: s(240), borderRadius: 999, border: `2px solid ${useD ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'}` } } },
        ...(layout.brandTop ? [{ type: 'div', props: { style: { position: 'absolute', top: sp(36), left: sp(64), right: sp(64), display: 'flex' }, children: [brandNode] } }] : []),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', padding: `0 ${sp(64)}px ${sp(52)}px ${sp(64)}px`, gap: s(0) }, children: [
          ...(layout.brandTop ? [] : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: cardMuted, marginBottom: s(24), textAlign }, children: brandName } }]),
          { type: 'div', props: { style: { fontSize: s(100), fontWeight: 900, lineHeight: 1, color: cardTxt, letterSpacing: s(-3), textAlign, width: Math.round(w * layout.textMaxFrac) }, children: statVal } },
          { type: 'div', props: { style: { fontSize: sb(24), fontWeight: 500, color: cardBody, marginTop: s(16), lineHeight: 1.3, textAlign, width: Math.round(w * layout.textMaxFrac) }, children: headline.slice(0, 65) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(16), fontWeight: 400, color: cardMuted, marginTop: s(10), lineHeight: 1.45, textAlign, width: Math.round(w * layout.textMaxFrac) }, children: subheadline.slice(0, 90) } }] : []),
          ...(shCtaText ? [{ type: 'div', props: { style: { display: 'flex', marginTop: s(24), alignSelf: layout.textAlign === 'center' ? 'center' : 'flex-start' }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(13), fontWeight: 700, letterSpacing: s(0.5), paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(40) }, children: shCtaText } },
          ] } }] : []),
        ] } },
      ] } }
    }

    case 'feature-split': {
      const panelW = Math.round(w * 0.55), photoW = w - panelW, padH = sp(36), textW = panelW - padH * 2
      // Left panel is always shade900 (dark) — use ptxtDark/pmutedDark for readable light text on dark
      const fpTxt   = aesthetic === 'bold-condensed' ? tk.lightPanelText  : ptxtDark
      const fpMuted = aesthetic === 'bold-condensed' ? tk.lightPanelMuted : pmutedDark
      const splitChildren = [
        { type: 'div', props: { style: { width: panelW, height: h, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: sp(48), paddingBottom: sp(48), paddingLeft: padH, paddingRight: padH, background: aesthetic === 'bold-condensed' ? tk.panelBg : palette.shade900, overflow: 'hidden', direction: textDir }, children: [
          { type: 'div', props: { style: { display: 'flex', fontSize: s(11), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: fpMuted, marginBottom: s(16), textAlign }, children: brandName } },
          { type: 'div', props: { style: { display: 'flex', width: s(36), height: s(3), background: accentBar, marginBottom: s(22), alignSelf: rtl ? 'flex-end' : 'flex-start' } } },
          { type: 'div', props: { style: { display: 'flex', fontSize: isDisplay(headline) ? sd(32) : sh(32), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, letterSpacing: tk.headlineLetterSpacing * scale, textTransform: tk.headlineTransform, lineHeight: 1.2, color: fpTxt, width: textW, textAlign }, children: headline.slice(0, 55) } },
          ...(subheadline ? [{ type: 'div', props: { style: { display: 'flex', fontSize: s(12), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: tk.subheadlineLineHeight, color: fpMuted, marginTop: s(16), width: textW, textAlign }, children: subheadline.slice(0, 80) } }] : []),
        ] } },
        { type: 'div', props: { style: { display: 'flex', width: photoW, height: h, flexShrink: 0, overflow: 'hidden', background: accent, position: 'relative' }, children: bgImageData ? [
          { type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: photoW, height: h, objectFit: 'cover', objectPosition: 'center' } } },
        ] : [] } },
      ]
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', flexDirection: rtl ? 'row-reverse' : 'row' }, children: splitChildren } }
    }

    case 'announcement': {
      const useD        = !!bgImageData && !bgIsLight
      const cardTxt     = useD ? ptxtDark   : ptxt
      const cardBody    = useD ? pbodyDark  : pbody
      const cardMuted   = useD ? pmutedDark : pmuted
      const bottomLine  = useD ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.12)'
      const dividerLine = useD ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.18)'
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor, direction: textDir }, children: [
        ...photoBgLayers(useD ? 0.25 : tk.overlayOpacity),
        ...photoBgAccents(),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(h * 0.90), background: useD ? 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.52) 50%, rgba(0,0,0,0.85) 100%)' : 'transparent' } } },
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: s(4), background: bottomLine } } },
        ...(layout.brandTop ? [{ type: 'div', props: { style: { position: 'absolute', top: sp(36), left: sp(80), right: sp(80), display: 'flex', justifyContent: 'center' }, children: [
          { type: 'div', props: { style: { fontSize: s(12), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: cardMuted, textAlign: 'center' }, children: brandName } },
        ] } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: sp(56), paddingBottom: sp(56), paddingLeft: sp(80), paddingRight: sp(80) }, children: [
          ...(!layout.brandTop ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16), marginBottom: s(32) }, children: [
            { type: 'div', props: { style: { width: s(44), height: 1, background: dividerLine } } },
            { type: 'div', props: { style: { fontSize: s(12), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: cardMuted, textAlign: 'center' }, children: brandName } },
            { type: 'div', props: { style: { width: s(44), height: 1, background: dividerLine } } },
          ] } }] : []),
          // Wrapper with definite raw-pixel width (not scaled via s()) so yoga measures
          // wrapped-text height correctly; text divs need the same explicit width for rendering.
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: Math.round(w * layout.textMaxFrac), gap: s(20) }, children: [
            { type: 'div', props: { style: { fontSize: isDisplay(headline) ? sd(58) : sh(58), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, letterSpacing: tk.headlineLetterSpacing * scale, textTransform: tk.headlineTransform, lineHeight: 1.05, color: cardTxt, textAlign: lta, width: Math.round(w * layout.textMaxFrac) }, children: headline.slice(0, layout.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(15), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: tk.subheadlineLineHeight, color: cardBody, textAlign: lta, width: Math.round(w * layout.textMaxFrac) }, children: subheadline.slice(0, 100) } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'quote-overlay': {
      const accentBarStyle = rtl
        ? { position: 'absolute' as const, top: 0, right: 0, width: s(6), height: h, background: accentBar }
        : { position: 'absolute' as const, top: 0, left: 0,  width: s(6), height: h, background: accentBar }
      const openQuote = rtl ? '\u201D' : '\u201C'
      const quoteText = rtl ? `\u201D${headline.slice(0, 120)}\u201C` : `\u201C${headline.slice(0, 120)}\u201D`
      const quotePad  = rtl ? `${s(64)}px ${s(88)}px ${s(64)}px ${s(96)}px` : `${s(64)}px ${s(96)}px ${s(64)}px ${s(88)}px`
      const attrOrder = rtl
        ? [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, fontFamily: tk.brandFamily, color: accentBar, textTransform: tk.brandTransform, textAlign }, children: brandName } },
           { type: 'div', props: { style: { width: s(36), height: s(2), background: accentBar } } }]
        : [{ type: 'div', props: { style: { width: s(36), height: s(2), background: accentBar } } },
           { type: 'div', props: { style: { fontSize: s(14), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, fontFamily: tk.brandFamily, color: accentBar, textTransform: tk.brandTransform }, children: brandName } }]
      const quoteBg = tk.panelBg !== '#faf9f7' ? tk.panelBg : palette.tint100
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', direction: textDir }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', objectPosition: 'center' } } }]
          : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: quoteBg } } }]),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.70)' } } },
        { type: 'div', props: { style: accentBarStyle } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: quotePad }, children: [
          { type: 'div', props: { style: { fontSize: s(110), fontWeight: tk.quoteWeight, lineHeight: 0.6, color: quoteGlyph, opacity: 0.65, marginBottom: s(28), fontFamily: tk.quoteFamily, textAlign }, children: openQuote } },
          { type: 'div', props: { style: { fontSize: s(36), fontWeight: tk.quoteWeight, lineHeight: 1.5, color: palette.shade900, fontStyle: tk.quoteStyle, fontFamily: tk.headlineFamily, maxWidth: s(920), textAlign }, children: quoteText } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16), marginTop: s(36) }, children: attrOrder } },
        ] } },
      ] } }
    }

    case 'benefit-strip': {
      const photoW = Math.round(w * 0.44), textW = w - photoW
      // Panel background is always palette.tint100 (light); dark-panel aesthetics use tk.panelBg (#111/#000)
      const bsPanelIsDark = aesthetic === 'bold-condensed' || aesthetic === 'brutalist' || aesthetic === 'glassmorphism'
      const bsTxt   = bsPanelIsDark ? lightTxt   : ptxtLight
      const bsMuted = bsPanelIsDark ? lightMuted : pmutedLight
      const photoPanel = { type: 'div', props: { style: { display: 'flex', width: photoW, height: h, flexShrink: 0, overflow: 'hidden', background: palette.shade600, position: 'relative' }, children: bgImageData ? [
        { type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: photoW, height: h, objectFit: 'cover', objectPosition: 'center' } } },
      ] : [] } }
      const textPanel = { type: 'div', props: { style: { width: textW, height: h, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: sp(52), paddingBottom: sp(52), paddingLeft: sp(52), paddingRight: sp(52), background: palette.tint100, direction: textDir }, children: [
        { type: 'div', props: { style: { fontSize: s(72), fontWeight: 900, lineHeight: 1, color: palette.tint300, marginBottom: 0, textAlign }, children: '01' } },
        { type: 'div', props: { style: { fontSize: isDisplay(headline) ? sd(32) : sh(32), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, letterSpacing: tk.headlineLetterSpacing * scale, textTransform: tk.headlineTransform, lineHeight: 1.25, color: bsTxt, marginBottom: s(18), textAlign, width: textW }, children: headline.slice(0, 60) } },
        ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(12), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: tk.subheadlineLineHeight, color: bsMuted, textAlign, width: textW }, children: subheadline.slice(0, 100) } }] : []),
        { type: 'div', props: { style: { display: 'flex', width: s(36), height: s(3), background: accentBar, marginTop: s(28), alignSelf: rtl ? 'flex-end' : 'flex-start' } } },
      ] } }
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', flexDirection: rtl ? 'row-reverse' : 'row' }, children: [photoPanel, textPanel] } }
    }

    case 'recipe-hero': {
      const recipeBar = rtl
        ? { position: 'absolute' as const, top: 0, right: 0, width: s(5), height: h, background: tk.accentOverride ?? primaryColor }
        : { position: 'absolute' as const, top: 0, left: 0,  width: s(5), height: h, background: tk.accentOverride ?? primaryColor }
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', direction: textDir }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', objectPosition: 'center' } } }]
          : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: palette.shade600 } } }]),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(h * 0.70), background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.60) 40%, rgba(0,0,0,0.92) 100%)' } } },
        { type: 'div', props: { style: recipeBar } },
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', padding: `0 ${sp(52)}px ${sp(44)}px ${sp(56)}px` }, children: [
          { type: 'div', props: { style: { fontSize: s(11), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: accentBar, marginBottom: s(14), textAlign }, children: brandName } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: Math.round(w * layout.textMaxFrac), gap: s(14) }, children: [
            { type: 'div', props: { style: { fontSize: isDisplay(headline) ? sd(46) : sh(46), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, letterSpacing: tk.headlineLetterSpacing * scale, textTransform: tk.headlineTransform, lineHeight: 1.1, color: ptxtDark, textAlign, width: Math.round(w * layout.textMaxFrac) }, children: headline.slice(0, 60) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(14), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: tk.subheadlineLineHeight, color: pbodyDark, textAlign, width: Math.round(w * layout.textMaxFrac) }, children: subheadline.slice(0, 70) } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'tip-card': {
      const warmBg = aesthetic === 'bold-condensed' ? tk.panelBg : (aesthetic === 'luxury' || aesthetic === 'editorial-serif' ? tk.panelBg : palette.tint100)
      // Dark-panel aesthetics (bold-condensed, brutalist, glassmorphism) get white text from tk;
      // all light-panel aesthetics get brand-hued shade900 via ptxtLight/pmutedLight.
      const tcPanelIsDark = aesthetic === 'bold-condensed' || aesthetic === 'brutalist' || aesthetic === 'glassmorphism'
      const tcTxt   = tcPanelIsDark ? lightTxt   : ptxtLight
      const tcMuted = tcPanelIsDark ? lightMuted : pmutedLight
      const circlePos = rtl ? { top: s(36), left: s(44) } : { top: s(36), right: s(44) }
      const barStyle  = rtl
        ? { position: 'absolute' as const, top: 0, right: 0, width: s(6), height: h, background: accentBar }
        : { position: 'absolute' as const, top: 0, left: 0,  width: s(6), height: h, background: accentBar }
      const textPad = rtl
        ? { paddingTop: sp(48), paddingBottom: sp(48), paddingRight: sp(52), paddingLeft: s(230) }
        : { paddingTop: sp(48), paddingBottom: sp(48), paddingLeft:  sp(52), paddingRight: s(230) }
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: warmBg, direction: textDir }, children: [
        { type: 'div', props: { style: { position: 'absolute', right: s(-10), top: s(-40), fontSize: s(400), fontWeight: 900, color: primaryColor, opacity: 0.06, lineHeight: 1 }, children: '1' } },
        ...(bgImageData ? [{ type: 'div', props: { style: { position: 'absolute', ...circlePos, width: s(180), height: s(180), borderRadius: 999, overflow: 'hidden', border: `3px solid ${primaryColor}`, background: primaryColor }, children: [
          { type: 'img', props: { src: bgImageData, style: { width: s(180), height: s(180), objectFit: 'cover', objectPosition: 'center' } } },
        ] } }] : []),
        { type: 'div', props: { style: barStyle } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', ...textPad }, children: [
          { type: 'div', props: { style: { fontSize: s(11), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: accentBar, marginBottom: s(16), textAlign }, children: brandName } },
          { type: 'div', props: { style: { fontSize: isDisplay(headline) ? sd(32) : sh(32), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, letterSpacing: tk.headlineLetterSpacing * scale, textTransform: tk.headlineTransform, lineHeight: 1.25, color: tcTxt, textAlign }, children: headline.slice(0, 65) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(12), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: tk.subheadlineLineHeight, color: tcMuted, marginTop: s(14), textAlign }, children: subheadline.slice(0, 100) } }] : []),
        ] } },
      ] } }
    }

    case 'editorial-hero': {
      const useD      = !!bgImageData && !bgIsLight
      const cardTxt   = useD ? ptxtDark   : ptxt
      const cardBody  = useD ? pbodyDark  : pbody
      const cardMuted = useD ? pmutedDark : pmuted
      // On dark (photo), subtle white bar; on light canvas, use accent color instead
      const editBarColor = useD ? 'rgba(255,255,255,0.35)' : accentBar
      const editBar = rtl
        ? { position: 'absolute' as const, top: 0, right: 0, width: s(6), height: h, background: editBarColor }
        : { position: 'absolute' as const, top: 0, left:  0, width: s(6), height: h, background: editBarColor }
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor, direction: textDir }, children: [
        ...photoBgLayers(useD ? 0.15 : Math.max(0.52, tk.overlayOpacity * 0.65)),
        ...photoBgAccents(),
        { type: 'div', props: { style: editBar } },
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(h * 0.72), background: useD ? 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.58) 50%, rgba(0,0,0,0.90) 100%)' : 'transparent' } } },
        // Top vignette ensures brand name is legible on any photo background
        ...(useD ? [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: Math.round(h * 0.36), background: 'linear-gradient(to bottom, rgba(0,0,0,0.62) 0%, transparent 100%)' } } }] : []),
        ...(layout.brandTop ? [{ type: 'div', props: { style: { position: 'absolute', top: sp(36), left: sp(72), right: sp(64), display: 'flex' }, children: [
          { type: 'div', props: { style: { fontSize: s(12), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: useD ? 'rgba(255,255,255,0.82)' : cardMuted, textAlign }, children: brandName } },
        ] } }] : []),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', padding: `0 ${sp(64)}px ${sp(52)}px ${sp(72)}px` }, children: [
          ...(layout.brandTop ? [] : [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: useD ? 'rgba(255,255,255,0.72)' : cardMuted, marginBottom: s(16), textAlign }, children: brandName } }]),
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: Math.round(w * layout.textMaxFrac), gap: s(18) }, children: [
            { type: 'div', props: { style: { fontSize: isDisplay(headline) ? sd(54) : sh(54), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, letterSpacing: tk.headlineLetterSpacing * scale, textTransform: tk.headlineTransform, lineHeight: 1.1, color: cardTxt, textAlign, width: Math.round(w * layout.textMaxFrac) }, children: headline.slice(0, layout.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(15), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: tk.subheadlineLineHeight, color: cardBody, textAlign, width: Math.round(w * layout.textMaxFrac) }, children: subheadline.slice(0, 100) } }] : []),
          ] } },
        ] } },
      ] } }
    }

    // ── 5 new ad creative variants ────────────────────────────────────────────

    case 'product-showcase': {
      const priceText = opts.price ?? ''
      const ctaLabel  = opts.ctaText ?? 'Shop Now'
      const ctaBg     = opts.ctaColor ?? accentBar
      const ctaTxt2   = contrastText(ctaBg)
      const useD      = !!bgImageData && !bgIsLight
      const cardTxt   = useD ? ptxtDark   : ptxt
      const cardBody  = useD ? pbodyDark  : pbody
      const cardMuted = useD ? pmutedDark : pmuted
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor, direction: textDir }, children: [
        ...photoBgLayers(useD ? 0.20 : tk.overlayOpacity),
        ...photoBgAccents(),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(h * 0.75), background: useD ? 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.60) 45%, rgba(0,0,0,0.88) 100%)' : 'transparent' } } },
        // Brand name — top left
        { type: 'div', props: { style: { position: 'absolute', top: s(28), left: s(40), fontSize: s(11), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: cardMuted, textAlign }, children: brandName } },
        // Headline — vertically centered above bottom bar
        { type: 'div', props: { style: { position: 'absolute', top: s(60), left: s(40), right: s(40), bottom: s(priceText ? 112 : 80), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(14) }, children: [
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: Math.round(w * layout.textMaxFrac), gap: s(14) }, children: [
            { type: 'div', props: { style: { fontSize: isDisplay(headline) ? sd(44) : sh(44), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, letterSpacing: tk.headlineLetterSpacing * scale, textTransform: tk.headlineTransform, lineHeight: 1.1, color: cardTxt, textAlign: 'center', width: Math.round(w * layout.textMaxFrac) }, children: headline.slice(0, layout.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(14), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: tk.subheadlineLineHeight, color: cardBody, textAlign: 'center', width: Math.round(w * layout.textMaxFrac * 0.85) }, children: subheadline.slice(0, 90) } }] : []),
          ] } },
        ] } },
        // Bottom bar: price left, CTA right
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: s(18), paddingBottom: s(24), paddingLeft: s(40), paddingRight: s(40), background: useD ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.08)' }, children: [
          ...(priceText ? [{ type: 'div', props: { style: { fontSize: s(42), fontWeight: 900, color: cardTxt, letterSpacing: -1, lineHeight: 1 }, children: priceText } }]
            : [{ type: 'div', props: { style: {} } }]),
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: ctaBg, color: ctaTxt2, fontSize: s(13), fontWeight: 700, fontFamily: tk.brandFamily, letterSpacing: 1.5, textTransform: 'uppercase' as const, paddingTop: s(13), paddingBottom: s(13), paddingLeft: s(30), paddingRight: s(30), borderRadius: s(3) }, children: ctaLabel } },
        ] } },
      ] } }
    }

    case 'coupon-offer': {
      const code      = opts.couponCode ?? 'SAVE20'
      const expiry    = opts.expiryText ?? ''
      const ctaLabel  = opts.ctaText ?? ''
      const useD      = !!bgImageData && !bgIsLight
      const cardTxt   = useD ? ptxtDark   : ptxt
      const cardBody  = useD ? pbodyDark  : pbody
      const cardMuted = useD ? pmutedDark : pmuted
      const codeBorder = useD ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.25)'
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor, direction: textDir }, children: [
        ...photoBgLayers(0.88),
        ...photoBgAccents(),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: sp(36), paddingBottom: sp(36), paddingLeft: sp(60), paddingRight: sp(60) }, children: [
          // Brand name
          { type: 'div', props: { style: { fontSize: s(11), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: cardMuted, textAlign: 'center', marginBottom: s(16) }, children: brandName } },
          // Big discount headline
          { type: 'div', props: { style: { fontSize: sh(72), fontWeight: 900, lineHeight: 1, color: cardTxt, textAlign: 'center', letterSpacing: s(-2), marginBottom: s(8) }, children: headline.slice(0, Math.min(layout.headlineChars, 30)) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(18), color: cardBody, textAlign: 'center', marginBottom: s(8) }, children: subheadline.slice(0, 80) } }] : []),
          // Dashed coupon code box
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(36), paddingRight: s(36), borderWidth: 2, borderStyle: 'dashed', borderColor: codeBorder, borderRadius: s(4), marginTop: s(20) }, children: [
            { type: 'div', props: { style: { fontSize: s(11), color: cardMuted, textTransform: 'uppercase' as const, letterSpacing: 2, marginBottom: s(6) }, children: 'Use code' } },
            { type: 'div', props: { style: { fontSize: s(30), fontWeight: 800, color: cardTxt, letterSpacing: s(6), textTransform: 'uppercase' as const } , children: code } },
          ] } },
          ...(expiry ? [{ type: 'div', props: { style: { fontSize: s(12), color: cardMuted, textAlign: 'center', marginTop: s(14) }, children: expiry } }] : []),
          ...(ctaLabel ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: accentBar, color: contrastText(accentBar), fontSize: s(13), fontWeight: 700, fontFamily: tk.brandFamily, letterSpacing: 1.5, textTransform: 'uppercase' as const, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(32), paddingRight: s(32), borderRadius: s(3), marginTop: s(20) }, children: ctaLabel } }] : []),
        ] } },
      ] } }
    }

    case 'testimonial': {
      const quote       = opts.reviewText ?? headline
      const reviewer    = opts.reviewerName ?? brandName
      const reviewTitle = opts.reviewerTitle ?? ''
      const stars       = Math.max(1, Math.min(5, Math.round(opts.rating ?? 5)))
      const starFilled  = '\u2605'.repeat(stars)
      const starEmpty   = '\u2606'.repeat(5 - stars)
      const avatarData  = bgImageData
      // tk.panelBg is near-white for all light-panel aesthetics, near-black for dark-panel ones.
      // Dark-panel aesthetics use the register's hardcoded white text; light-panel ones get
      // brand-hued shade900 via ptxtLight/pmutedLight (brand-cohesive dark tone on near-white bg).
      const tmPanelIsDark = aesthetic === 'bold-condensed' || aesthetic === 'brutalist' || aesthetic === 'glassmorphism'
      const tmTxt   = tmPanelIsDark ? lightTxt   : ptxtLight
      const tmMuted = tmPanelIsDark ? lightMuted : pmutedLight
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg, direction: textDir }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: sp(40), paddingBottom: sp(40), paddingLeft: sp(56), paddingRight: sp(56) }, children: [
          // Brand name
          { type: 'div', props: { style: { fontSize: s(10), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: accentBar, marginBottom: s(24) }, children: brandName } },
          // Star rating
          { type: 'div', props: { style: { fontSize: s(18), color: accentBar, letterSpacing: s(2), marginBottom: s(18) }, children: starFilled + starEmpty } },
          // Decorative open-quote glyph
          { type: 'div', props: { style: { fontSize: s(80), fontWeight: tk.quoteWeight, lineHeight: 0.5, color: accentBar, opacity: 0.30, marginBottom: s(10), fontFamily: tk.quoteFamily }, children: '\u201C' } },
          // Quote text
          { type: 'div', props: { style: { fontSize: sb(22), fontFamily: tk.headlineFamily, fontStyle: tk.quoteStyle, fontWeight: tk.quoteWeight, lineHeight: 1.5, color: tmTxt, width: Math.round(w * layout.textMaxFrac) }, children: quote.slice(0, 160) } },
          // Reviewer row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16), marginTop: s(28) }, children: [
            ...(avatarData ? [{ type: 'div', props: { style: { width: s(44), height: s(44), borderRadius: 999, overflow: 'hidden', flexShrink: 0 }, children: [
              { type: 'img', props: { src: avatarData, style: { width: s(44), height: s(44), objectFit: 'cover' } } },
            ] } }] : []),
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2), flex: 1 }, children: [
              { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: tmTxt }, children: reviewer } },
              ...(reviewTitle ? [{ type: 'div', props: { style: { fontSize: s(12), color: tmMuted }, children: reviewTitle } }] : []),
            ] } },
            { type: 'div', props: { style: { width: s(40), height: 1, background: tmMuted } } },
          ] } },
        ] } },
      ] } }
    }

    case 'event-card': {
      const dateText     = opts.eventDate ?? ''
      const timeText     = opts.eventTime ?? ''
      const locationText = opts.eventLocation ?? ''
      // Parse "Dec 14" or "14 Dec" into day+month parts
      const dayMatch   = dateText.match(/\b(\d{1,2})\b/)
      const monthMatch = dateText.match(/\b([A-Za-z]{3,})\b/)
      const dayNum     = dayMatch?.[1] ?? ''
      const monthStr   = (monthMatch?.[1] ?? '').slice(0, 3).toUpperCase()
      const useD       = !!bgImageData && !bgIsLight
      const cardTxt    = useD ? ptxtDark   : ptxt
      const cardBody   = useD ? pbodyDark  : pbody
      const cardMuted  = useD ? pmutedDark : pmuted
      const evtDivider = useD ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.20)'
      // Badge text must pass WCAG contrast against accentBar — light brands like #E8A598
      // (lum≈0.37) need dark text, not hardcoded white.
      const badgeTxt = contrastText(accentBar)
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor, direction: textDir }, children: [
        ...photoBgLayers(tk.overlayOpacity),
        ...photoBgAccents(),
        // Date badge — top right
        ...(dateText ? [{ type: 'div', props: { style: { position: 'absolute', top: s(24), right: s(32), display: 'flex', flexDirection: 'column', alignItems: 'center', background: accentBar, borderRadius: s(4), paddingTop: s(8), paddingBottom: s(10), paddingLeft: s(14), paddingRight: s(14), minWidth: s(56) }, children: [
          ...(monthStr ? [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 2, color: badgeTxt, opacity: 0.80, textAlign: 'center' }, children: monthStr } }] : []),
          ...(dayNum ? [{ type: 'div', props: { style: { fontSize: s(34), fontWeight: 900, lineHeight: 1, color: badgeTxt, letterSpacing: -1, textAlign: 'center' }, children: dayNum } }]
            : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: badgeTxt, textAlign: 'center' }, children: dateText.slice(0, 12) } }]),
        ] } }] : []),
        // Bottom content
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', paddingTop: 0, paddingBottom: sp(44), paddingLeft: sp(52), paddingRight: sp(52) }, children: [
          { type: 'div', props: { style: { fontSize: s(12), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: cardMuted, marginBottom: s(14), textAlign }, children: brandName } },
          { type: 'div', props: { style: { fontSize: sh(48), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, letterSpacing: tk.headlineLetterSpacing * scale, textTransform: tk.headlineTransform, lineHeight: 1.1, color: cardTxt, width: Math.round(w * layout.textMaxFrac), textAlign }, children: headline.slice(0, layout.headlineChars) } },
          ...(timeText || locationText ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12), marginTop: s(16) }, children: [
            ...(timeText ? [{ type: 'div', props: { style: { fontSize: sb(14), color: cardBody }, children: `\u23F0 ${timeText}` } }] : []),
            ...(timeText && locationText ? [{ type: 'div', props: { style: { width: 1, height: s(14), background: evtDivider } } }] : []),
            ...(locationText ? [{ type: 'div', props: { style: { fontSize: sb(14), color: cardBody }, children: `\uD83D\uDCCD ${locationText}` } }] : []),
          ] } }] : []),
        ] } },
      ] } }
    }

    case 'video-thumbnail': {
      const duration = stat ?? ''
      const ctaLabel = opts.ctaText ?? ''
      const playSize = s(68)
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: palette.shade900, direction: textDir }, children: [
        // Full-bleed background photo
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', objectPosition: 'center' } } }] : []),
        // Heavy gradient scrim — bottom 65%
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(h * 0.65), background: 'rgba(0,0,0,0.78)' } } },
        // Lighter top scrim — top 22%
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: Math.round(h * 0.22), background: 'rgba(0,0,0,0.32)' } } },
        // Brand name + accent bar — top left
        { type: 'div', props: { style: { position: 'absolute', top: s(18), left: s(22), display: 'flex', alignItems: 'center', gap: s(8) }, children: [
          { type: 'div', props: { style: { width: s(4), height: s(20), background: accentBar, borderRadius: s(2) } } },
          { type: 'div', props: { style: { fontSize: s(12), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: 'rgba(255,255,255,0.80)' }, children: brandName } },
        ] } },
        // Duration badge — top right
        ...(duration ? [{ type: 'div', props: { style: { position: 'absolute', top: s(18), right: s(22), background: 'rgba(0,0,0,0.72)', borderRadius: s(3), paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), fontSize: s(13), fontWeight: 700, color: '#ffffff', letterSpacing: 0.5 }, children: duration } }] : []),
        // Headline + subheadline + optional cta text — bottom left
        { type: 'div', props: { style: { position: 'absolute', bottom: s(40), left: s(26), right: s(26 + playSize + s(16)), display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
          { type: 'div', props: { style: { fontSize: sh(36), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, letterSpacing: tk.headlineLetterSpacing * scale, textTransform: tk.headlineTransform, lineHeight: 1.15, color: '#ffffff' }, children: headline.slice(0, layout.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(15), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: 1.4, color: 'rgba(255,255,255,0.65)' }, children: subheadline.slice(0, 80) } }] : []),
          ...(ctaLabel ? [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: 700, color: accentBar, letterSpacing: 1, textTransform: 'uppercase' as const, marginTop: s(2) }, children: ctaLabel } }] : []),
        ] } },
        // Play button — bottom right
        { type: 'div', props: { style: { position: 'absolute', bottom: s(36), right: s(24), width: playSize, height: playSize, borderRadius: 999, borderWidth: s(2), borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.70)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.10)' }, children: [
          // Play triangle via Unicode right-pointing triangle
          { type: 'div', props: { style: { fontSize: Math.round(playSize * 0.5), color: 'rgba(255,255,255,0.90)', marginLeft: Math.round(playSize * 0.08) }, children: '\u25B6' } },
        ] } },
      ] } }
    }

    case 'before-after': {
      const bLabel  = opts.beforeLabel ?? 'Before'
      const aLabel  = opts.afterLabel  ?? 'After'
      const bText   = opts.beforeText  ?? subheadline ?? ''
      const aText   = opts.afterText   ?? headline
      const halfW   = Math.floor(w / 2)
      // Adaptive text for the right "after" panel — the composite is primaryColor at 0.55 opacity
      // over whatever is behind it. Use paletteText against primaryColor luminance.
      const baTxt   = paletteText(primaryColor, palette, 'headline')
      const baBody  = paletteText(primaryColor, palette, 'body')
      const baMuted = paletteText(primaryColor, palette, 'muted')
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', position: 'relative' }, children: [
        // ── LEFT: "before" panel ──
        { type: 'div', props: { style: { width: halfW, height: h, display: 'flex', position: 'relative', overflow: 'hidden', flexShrink: 0 }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: halfW, height: h, objectFit: 'cover', objectPosition: 'center' } } }] : []),
          { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(30,30,30,0.80)' } } },
          { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(20), background: 'rgba(255,255,255,0.15)', borderRadius: s(3), paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), display: 'flex' }, children: [
            { type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, color: ptxtDark, letterSpacing: 2, textTransform: 'uppercase' as const }, children: bLabel } },
          ] } },
          { type: 'div', props: { style: { position: 'absolute', bottom: s(28), left: s(20), right: s(10), display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            { type: 'div', props: { style: { width: s(24), height: s(3), background: 'rgba(255,255,255,0.35)', borderRadius: s(2) } } },
            { type: 'div', props: { style: { fontSize: s(16), fontWeight: 500, color: pbodyDark, lineHeight: 1.4 }, children: bText.slice(0, 60) } },
          ] } },
        ] } },
        // ── Divider ──
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: halfW - s(2), width: s(4), height: h, background: 'rgba(255,255,255,0.90)', zIndex: 10 } } },
        { type: 'div', props: { style: { position: 'absolute', top: Math.round(h / 2) - s(22), left: halfW - s(22), width: s(44), height: s(44), borderRadius: 999, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11, boxShadow: `0 2px ${s(10)} rgba(0,0,0,0.30)` }, children: [
          { type: 'div', props: { style: { fontSize: s(10), fontWeight: 900, color: '#111', letterSpacing: 0.5 }, children: '→' } },
        ] } },
        // ── RIGHT: "after" panel ──
        { type: 'div', props: { style: { width: w - halfW, height: h, display: 'flex', position: 'relative', overflow: 'hidden', flexShrink: 0 }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w - halfW, height: h, objectFit: 'cover', objectPosition: 'center' } } }] : []),
          { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor, opacity: 0.55 } } },
          { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(16), background: accentBar, borderRadius: s(3), paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), display: 'flex' }, children: [
            { type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, color: contrastText(accentBar), letterSpacing: 2, textTransform: 'uppercase' as const }, children: aLabel } },
          ] } },
          { type: 'div', props: { style: { position: 'absolute', bottom: s(28), left: s(16), right: s(20), display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            { type: 'div', props: { style: { width: s(24), height: s(3), background: accentBar, borderRadius: s(2) } } },
            { type: 'div', props: { style: { fontSize: s(16), fontWeight: 700, color: baTxt, lineHeight: 1.4 }, children: aText.slice(0, 60) } },
          ] } },
        ] } },
        // ── Bottom brand strip ──
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', paddingTop: s(8), paddingBottom: s(10), paddingLeft: s(20), paddingRight: s(20), display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: [
          { type: 'div', props: { style: { fontSize: s(10), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: baMuted }, children: brandName } },
        ] } },
      ] } }
    }

    case 'pricing-card': {
      const rawPlans = opts.plans ?? [
        { name: 'Starter', price: '$9',  period: '/mo', features: ['Up to 5 users', '10 GB storage', 'Email support'] },
        { name: 'Pro',     price: '$29', period: '/mo', features: ['Unlimited users', '100 GB storage', 'Priority support'], highlighted: true },
        { name: 'Enterprise', price: '$99', period: '/mo', features: ['Custom limits', '1 TB storage', 'Dedicated support'] },
      ]
      const plans = rawPlans.slice(0, 3)
      const colW   = Math.floor((w - s(6)) / plans.length)
      const gutter = s(16)
      const planCols = plans.map((plan: { name: string; price: string; period?: string; features?: string[]; highlighted?: boolean }) => {
        const isHl  = plan.highlighted ?? false
        const colBg = isHl ? primaryColor   : tk.panelBg
        const colTx = isHl ? '#ffffff'       : lightTxt
        const colMt = isHl ? 'rgba(255,255,255,0.65)' : lightMuted
        const colAc = isHl ? accentBar       : primaryColor
        return { type: 'div', props: { style: { width: colW, height: h, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingTop: s(28), paddingBottom: s(24), paddingLeft: gutter, paddingRight: gutter, background: colBg, flexShrink: 0, position: 'relative', overflow: 'hidden' }, children: [
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
            ...(isHl ? [{ type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: colAc, marginBottom: s(6) }, children: 'Most Popular' } }] : []),
            { type: 'div', props: { style: { fontSize: s(14), fontWeight: tk.brandWeight, color: colTx, letterSpacing: 0.5 }, children: plan.name } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: s(2), marginTop: s(8) }, children: [
              { type: 'div', props: { style: { fontSize: s(42), fontWeight: 900, lineHeight: 1, color: colTx, letterSpacing: -1 }, children: plan.price } },
              ...(plan.period ? [{ type: 'div', props: { style: { fontSize: s(13), color: colMt, fontWeight: 500 }, children: plan.period } }] : []),
            ] } },
            { type: 'div', props: { style: { width: s(28), height: s(2), background: colAc, marginTop: s(12), borderRadius: s(1) } } },
          ] } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(7) }, children: [
            ...(plan.features ?? []).slice(0, 4).map((feat: string) => ({
              type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(7) }, children: [
                { type: 'div', props: { style: { width: s(14), height: s(14), borderRadius: 999, background: colAc, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: [
                  { type: 'div', props: { style: { fontSize: s(8), color: contrastText(colAc), fontWeight: 700 }, children: '✓' } },
                ] } },
                { type: 'div', props: { style: { fontSize: s(12), color: colMt, lineHeight: 1.3, flex: 1 }, children: feat } },
              ] },
            })),
          ] } },
          // CTA at bottom
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: isHl ? accentBar : 'transparent', borderWidth: isHl ? 0 : s(1), borderStyle: 'solid', borderColor: primaryColor, borderRadius: s(3), paddingTop: s(10), paddingBottom: s(10), fontSize: s(11), fontWeight: 700, color: isHl ? contrastText(accentBar) : primaryColor, letterSpacing: 1, textTransform: 'uppercase' as const }, children: opts.ctaText ?? 'Get Started' } },
          // Highlight glow strip
          ...(isHl ? [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: s(4), background: accentBar } } }] : []),
        ] } }
      })
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg, flexDirection: 'column' }, children: [
        // Header bar
        { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: s(16), paddingBottom: s(16), paddingLeft: s(20), paddingRight: s(20), background: aesthetic === 'bold-condensed' ? tk.panelBg : '#ffffff', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'rgba(0,0,0,0.08)' }, children: [
          { type: 'div', props: { style: { fontSize: s(12), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: lightTxt }, children: brandName } },
          { type: 'div', props: { style: { fontSize: s(13), fontWeight: 600, color: lightTxt }, children: headline.slice(0, 40) } },
        ] } },
        // Plan columns
        { type: 'div', props: { style: { display: 'flex', flex: 1, gap: s(2) }, children: planCols } },
      ] } }
    }

    case 'social-proof': {
      const rawLogos  = opts.logos ?? ['Stripe', 'Notion', 'Figma', 'Linear', 'Vercel', 'GitHub']
      const logoList  = rawLogos.slice(0, 6)
      const tagline   = opts.tagline ?? ''
      const useDark   = aesthetic === 'bold-condensed'
      const cardBg    = useDark ? palette.shade900 : tk.panelBg
      const headColor = useDark ? '#ffffff' : lightTxt
      const mutedC    = useDark ? 'rgba(255,255,255,0.50)' : lightMuted
      const logoBg    = useDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)'
      const logoBdr   = useDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'
      const logoTxt   = useDark ? 'rgba(255,255,255,0.65)' : lightMuted
      const row1      = logoList.slice(0, Math.ceil(logoList.length / 2))
      const row2      = logoList.slice(Math.ceil(logoList.length / 2))
      const logoBox   = (name: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: logoBg, borderWidth: 1, borderStyle: 'solid', borderColor: logoBdr, borderRadius: s(4), paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(16), paddingRight: s(16), flex: 1 }, children: [
        { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: logoTxt, letterSpacing: 0.5, fontFamily: tk.brandFamily } , children: name } },
      ] } })
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: cardBg, direction: textDir }, children: [
        ...(bgImageData ? [
          { type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', objectPosition: 'center', opacity: 0.08 } } },
        ] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: sp(36), paddingBottom: sp(36), paddingLeft: sp(48), paddingRight: sp(48), gap: s(28) }, children: [
          // Headline section
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(10) }, children: [
            { type: 'div', props: { style: { fontSize: s(10), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: accentBar, textAlign: 'center' }, children: brandName } },
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: Math.round(w * layout.textMaxFrac), gap: s(10) }, children: [
              { type: 'div', props: { style: { fontSize: sh(34), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, lineHeight: 1.15, color: headColor, textAlign: 'center' }, children: headline.slice(0, layout.headlineChars) } },
              ...(tagline ? [{ type: 'div', props: { style: { fontSize: sb(15), color: mutedC, textAlign: 'center' }, children: tagline } }] : []),
            ] } },
          ] } },
          // Logo grid: row1
          { type: 'div', props: { style: { display: 'flex', gap: s(10), width: '100%', maxWidth: s(780) }, children: row1.map(logoBox) } },
          // Logo grid: row2
          ...(row2.length ? [{ type: 'div', props: { style: { display: 'flex', gap: s(10), width: '100%', maxWidth: s(780) }, children: row2.map(logoBox) } }] : []),
        ] } },
      ] } }
    }

    case 'countdown-timer': {
      const days  = String(opts.timerDays  ?? 0).padStart(2, '0')
      const hours = String(opts.timerHours ?? 0).padStart(2, '0')
      const mins  = String(opts.timerMins  ?? 0).padStart(2, '0')
      const secs  = String(opts.timerSecs  ?? 0).padStart(2, '0')
      const units = [{ val: days, label: 'DAYS' }, { val: hours, label: 'HRS' }, { val: mins, label: 'MIN' }, { val: secs, label: 'SEC' }]
      const unitW = Math.floor((Math.min(w, s(520)) - s(24)) / 4)
      const numSz = Math.min(s(64), Math.round(unitW * 0.60))
      const lblSz = s(9)
      // countdown always renders on dark canvas (hardcoded #0d0d0d + photoBgLayers)
      // but unit boxes use primaryColor as their bg — text on that needs contrast-safe colors
      const unitTxt   = paletteContrastText(primaryColor, palette)
      const unitMuted = paletteText(primaryColor, palette, 'muted')
      const useD      = !!bgImageData && !bgIsLight
      const cardTxt   = useD ? ptxtDark   : ptxt
      const cardMuted = useD ? pmutedDark : pmuted
      const colonColor = useD ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'
      const unitBox = (u: { val: string; label: string }) => ({ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: unitW, paddingTop: s(14), paddingBottom: s(14), background: primaryColor, borderRadius: s(6), gap: s(4), borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.18)' }, children: [
        { type: 'div', props: { style: { fontSize: numSz, fontWeight: 900, lineHeight: 1, color: unitTxt, letterSpacing: -2, fontFamily: 'Inter' }, children: u.val } },
        { type: 'div', props: { style: { fontSize: lblSz, fontWeight: 700, color: unitMuted, letterSpacing: 2 }, children: u.label } },
      ] } })
      const colonDiv = { type: 'div', props: { style: { fontSize: Math.round(numSz * 0.8), fontWeight: 900, color: colonColor, lineHeight: 1, alignSelf: 'center', paddingBottom: s(6) }, children: ':' } }
      const clockUnits: object[] = []
      units.forEach((u, i) => {
        clockUnits.push(unitBox(u))
        if (i < units.length - 1) clockUnits.push(colonDiv)
      })
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0d0d0d', direction: textDir }, children: [
        ...photoBgLayers(0.90),
        ...photoBgAccents(),
        // Radial accent glow behind clock
        { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.35), left: Math.round(w * 0.25), width: Math.round(w * 0.50), height: Math.round(h * 0.40), borderRadius: 999, background: primaryColor, opacity: 0.20, filter: 'blur(60px)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingLeft: sp(40), paddingRight: sp(40), gap: s(24) }, children: [
          // Brand + headline
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(10) }, children: [
            { type: 'div', props: { style: { fontSize: s(10), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: cardMuted, textAlign: 'center' }, children: brandName } },
            { type: 'div', props: { style: { fontSize: sh(36), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, lineHeight: 1.2, color: cardTxt, textAlign: 'center', width: Math.round(w * layout.textMaxFrac) }, children: headline.slice(0, layout.headlineChars) } },
          ] } },
          // Clock row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: clockUnits } },
          // Expiry / subheadline
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(13), color: cardMuted, textAlign: 'center' }, children: subheadline.slice(0, 80) } }] : []),
          // Optional CTA
          ...(opts.ctaText ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: accentBar, color: contrastText(accentBar), fontSize: s(13), fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' as const, paddingTop: s(13), paddingBottom: s(13), paddingLeft: s(36), paddingRight: s(36), borderRadius: s(3), marginTop: s(4) }, children: opts.ctaText } }] : []),
        ] } },
      ] } }
    }

    case 'app-screenshot': {
      const rating      = Math.max(1, Math.min(5, Math.round(opts.appRating ?? 4.8)))
      const downloads   = opts.appDownloads ?? ''
      const isAndroid   = (opts as Record<string, unknown>)['platform'] === 'android'
      const phoneW      = Math.min(Math.round(w * 0.38), s(240))
      const phoneH      = Math.round(phoneW * 2.10)
      const phoneR      = Math.round(phoneW * 0.14)
      const notchW      = Math.round(phoneW * 0.35)
      const notchH      = Math.round(phoneW * 0.07)
      const screenPad   = Math.round(phoneW * 0.06)
      const screenH     = phoneH - screenPad * 2
      const screenW     = phoneW - screenPad * 2
      const phoneLeft   = Math.round(w * 0.50)
      const phoneTop    = Math.round((h - phoneH) / 2)
      const starFilled  = '\u2605'.repeat(rating)
      const starEmpty   = '\u2606'.repeat(5 - rating)
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg, direction: textDir }, children: [
        // Background tint
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', objectPosition: 'center', opacity: 0.08 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: Math.round(w * 0.55), bottom: 0, background: tintColor(primaryColor, 0.07) } } },
        // Left text panel
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: phoneLeft - s(16), bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: s(44), paddingRight: s(20), gap: s(16) }, children: [
          { type: 'div', props: { style: { fontSize: s(10), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: accentBar }, children: brandName } },
          { type: 'div', props: { style: { fontSize: s(36), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, lineHeight: 1.2, color: lightTxt, maxWidth: s(360) }, children: headline.slice(0, 55) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(15), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: 1.5, color: lightMuted, maxWidth: s(340) }, children: subheadline.slice(0, 80) } }] : []),
          // Rating row
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(16), color: accentBar, letterSpacing: s(2) }, children: starFilled + starEmpty } },
            { type: 'div', props: { style: { display: 'flex', gap: s(12), alignItems: 'center' }, children: [
              { type: 'div', props: { style: { fontSize: s(12), color: lightMuted }, children: `${opts.appRating ?? 4.8} rating` } },
              ...(downloads ? [{ type: 'div', props: { style: { fontSize: s(12), color: lightMuted } , children: `· ${downloads} downloads` } }] : []),
            ] } },
          ] } },
          // CTA
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: primaryColor, color: contrastText(primaryColor), fontSize: s(12), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(24), paddingRight: s(24), borderRadius: s(3), alignSelf: 'flex-start' }, children: opts.ctaText ?? (isAndroid ? 'Get on Google Play' : 'Download on App Store') } },
        ] } },
        // Phone frame
        { type: 'div', props: { style: { position: 'absolute', top: phoneTop, left: phoneLeft, width: phoneW, height: phoneH, borderRadius: phoneR, background: '#1a1a1a', borderWidth: s(3), borderStyle: 'solid', borderColor: '#333333', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center' }, children: [
          // Notch
          ...(!isAndroid ? [{ type: 'div', props: { style: { width: notchW, height: notchH, background: '#1a1a1a', borderRadius: Math.round(notchH / 2), marginTop: 0 } } }] : []),
          // Screen content (screenshot)
          { type: 'div', props: { style: { flex: 1, width: phoneW - s(6), overflow: 'hidden', position: 'relative', background: '#0a0a0a', display: 'flex' }, children: [
            ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' } } }] : [
              { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', padding: s(8), gap: s(6), background: '#0f0f0f' }, children: [
                { type: 'div', props: { style: { height: s(8), background: 'rgba(255,255,255,0.15)', borderRadius: s(2), width: '60%' } } },
                { type: 'div', props: { style: { height: s(6), background: 'rgba(255,255,255,0.08)', borderRadius: s(2), width: '80%' } } },
                { type: 'div', props: { style: { height: s(40), background: primaryColor, opacity: 0.6, borderRadius: s(4), marginTop: s(4) } } },
                { type: 'div', props: { style: { height: s(6), background: 'rgba(255,255,255,0.08)', borderRadius: s(2), width: '70%' } } },
                { type: 'div', props: { style: { height: s(6), background: 'rgba(255,255,255,0.08)', borderRadius: s(2), width: '55%' } } },
              ] } },
            ]),
          ] } },
          // Home indicator
          { type: 'div', props: { style: { width: Math.round(phoneW * 0.35), height: Math.round(phoneW * 0.012), background: 'rgba(255,255,255,0.40)', borderRadius: 999, marginBottom: Math.round(phoneW * 0.035) } } },
        ] } },
      ] } }
    }

    case 'job-posting': {
      const jobTitle    = opts.jobTitle ?? headline
      const location    = opts.location ?? ''
      const jobType     = opts.jobType  ?? ''
      const salary      = opts.salary   ?? ''
      const skillList   = (opts.skills  ?? []).slice(0, 6)
      const pillBg      = aesthetic === 'bold-condensed' ? 'rgba(255,255,255,0.10)' : tintColor(primaryColor, 0.10)
      const pillTx      = aesthetic === 'bold-condensed' ? 'rgba(255,255,255,0.75)' : lightTxt
      const pill        = (text: string, accent = false) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(12), paddingRight: s(12), background: accent ? primaryColor : pillBg, borderRadius: s(3), fontSize: s(11), fontWeight: 600, color: accent ? contrastText(primaryColor) : pillTx, letterSpacing: 0.3, flexShrink: 0 }, children: text } })
      const useDark2    = aesthetic === 'bold-condensed'
      const bgColor2    = useDark2 ? tk.panelBg : '#ffffff'
      const htColor     = useDark2 ? tk.lightPanelText : '#1a1a1a'
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: bgColor2, direction: textDir }, children: [
        // Accent sidebar
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: s(5), height: h, background: primaryColor } } },
        // Content
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: s(5), right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingTop: s(36), paddingBottom: s(32), paddingLeft: s(44), paddingRight: s(44) }, children: [
          // Top section
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(12) }, children: [
            // Company
            { type: 'div', props: { style: { fontSize: s(11), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: accentBar }, children: brandName } },
            // Job title
            { type: 'div', props: { style: { fontSize: s(46), fontWeight: 900, lineHeight: 1.1, color: htColor, letterSpacing: -1, maxWidth: s(820) }, children: jobTitle.slice(0, 55) } },
            // Meta pills row
            { type: 'div', props: { style: { display: 'flex', gap: s(8), flexWrap: 'nowrap' as const, marginTop: s(4) }, children: [
              ...(location ? [pill(`📍 ${location}`)] : []),
              ...(jobType  ? [pill(jobType, true)] : []),
              ...(salary   ? [pill(`💰 ${salary}`)] : []),
            ] } },
          ] } },
          // Bottom section: skills + CTA
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(16) }, children: [
            // Skills
            ...(skillList.length ? [{ type: 'div', props: { style: { display: 'flex', gap: s(6) }, children: skillList.map((sk: string) => pill(sk)) } }] : []),
            // Divider
            { type: 'div', props: { style: { width: '100%', height: 1, background: 'rgba(0,0,0,0.08)' } } },
            // Bottom row: subheadline + apply button
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
              { type: 'div', props: { style: { fontSize: s(13), color: htColor, opacity: 0.55, flex: 1, paddingRight: s(16) }, children: (subheadline ?? '').slice(0, 80) } },
              { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: primaryColor, color: contrastText(primaryColor), fontSize: s(13), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(3), flexShrink: 0 }, children: opts.ctaText ?? 'Apply Now' } },
            ] } },
          ] } },
        ] } },
      ] } }
    }

    case 'podcast-cover': {
      const epNum   = opts.episodeNumber ?? ''
      const hostName = opts.host ?? ''
      const dur     = stat ?? opts.timerMins ? `${opts.timerMins} min` : ''
      const useD    = !!bgImageData && !bgIsLight
      const cardTxt   = useD ? ptxtDark   : ptxt
      const cardBody  = useD ? pbodyDark  : pbody
      const cardMuted = useD ? pmutedDark : pmuted
      const playBg    = useD ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'
      const playBorder = useD ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.25)'
      const durBg     = useD ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'
      const ringA     = useD ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
      const ringB     = useD ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'
      // Waveform bars: decorative
      const barCount = 18
      const barMaxH  = s(40)
      const barW     = s(4)
      const barGap   = s(3)
      const waveHeights = [0.4,0.7,0.55,0.9,0.65,0.80,0.45,1.0,0.70,0.55,0.85,0.60,0.95,0.50,0.75,0.40,0.80,0.55]
      const waveBars = Array.from({ length: barCount }, (_, i) => ({
        type: 'div', props: { style: { width: barW, height: Math.round(barMaxH * waveHeights[i % waveHeights.length]), background: i % 3 === 0 ? accentBar : pmuted, borderRadius: barW, alignSelf: 'center' } },
      }))
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor, direction: textDir }, children: [
        ...photoBgLayers(tk.overlayOpacity),
        ...photoBgAccents(),
        // Diagonal accent stripe — top right
        { type: 'div', props: { style: { position: 'absolute', top: s(-80), right: s(-60), width: Math.round(w * 0.55), height: Math.round(w * 0.55), borderRadius: 999, background: ringA, display: 'flex' } } },
        { type: 'div', props: { style: { position: 'absolute', top: s(-40), right: s(-30), width: Math.round(w * 0.35), height: Math.round(w * 0.35), borderRadius: 999, background: ringB, display: 'flex' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingTop: sp(44), paddingBottom: sp(44), paddingLeft: sp(52), paddingRight: sp(52) }, children: [
          // Top: episode badge + brand
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
              ...(epNum ? [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 800, letterSpacing: 3, color: accentBar, textTransform: 'uppercase' as const }, children: epNum } }] : []),
              { type: 'div', props: { style: { fontSize: s(13), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing * scale, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: cardMuted }, children: brandName } },
            ] } },
            // Play button badge
            { type: 'div', props: { style: { width: s(48), height: s(48), borderRadius: 999, background: playBg, borderWidth: 2, borderStyle: 'solid', borderColor: playBorder, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: [
              { type: 'div', props: { style: { fontSize: s(18), color: cardTxt, marginLeft: s(3) }, children: '▶' } },
            ] } },
          ] } },
          // Middle: big episode title
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(14) }, children: [
            { type: 'div', props: { style: { fontSize: sh(52), fontWeight: tk.headlineWeight, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle, lineHeight: 1.1, color: cardTxt, width: Math.round(w * layout.textMaxFrac), letterSpacing: tk.headlineLetterSpacing * scale } , children: headline.slice(0, layout.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(18), fontFamily: tk.subheadlineFamily, fontWeight: tk.subheadlineWeight, lineHeight: 1.5, color: cardBody, width: Math.round(w * layout.textMaxFrac * 0.88) }, children: subheadline.slice(0, 100) } }] : []),
          ] } },
          // Bottom: waveform + host + duration
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(16) }, children: [
            // Waveform
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: barGap, height: barMaxH }, children: waveBars } },
            // Host row
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
              { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
                ...(hostName ? [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: cardTxt }, children: hostName } }] : []),
                { type: 'div', props: { style: { fontSize: s(11), color: cardMuted, letterSpacing: 0.5 }, children: 'Hosted by' } },
              ] } },
              ...(dur ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: durBg, borderRadius: s(3), paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(12), paddingRight: s(12), fontSize: s(12), fontWeight: 700, color: cardTxt, gap: s(4) }, children: [
                { type: 'div', props: { style: { fontSize: s(12) }, children: '🎙' } },
                { type: 'div', props: { style: {} }, children: dur },
              ] } }] : []),
            ] } },
          ] } },
        ] } },
      ] } }
    }

    // ── E-commerce variants ───────────────────────────────────────────────────

    case 'product-shot': {
      const badgeText = opts.badge ?? ''
      const origPrice = opts.originalPrice ?? ''
      const ctaLabel  = opts.ctaText ?? 'Shop Now'
      const ctaBg     = opts.ctaColor ?? accentBar
      const ctaTxt2   = contrastText(ctaBg)
      const category  = opts.productCategory ?? ''
      const stockNum  = opts.stockCount
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        // left: product image / bg
        { type: 'div', props: { style: { width: Math.round(w * 0.5), height: h, display: 'flex', position: 'relative', overflow: 'hidden', background: accent }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: Math.round(w * 0.5), height: h, objectFit: 'cover' } } }] : []),
          ...(badgeText ? [{ type: 'div', props: { style: { position: 'absolute', top: s(16), left: s(16), background: primaryColor, color: txt, fontSize: s(11), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: badgeText } }] : []),
        ] } },
        // right: info panel
        { type: 'div', props: { style: { flex: 1, height: h, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingTop: s(32), paddingBottom: s(32), paddingLeft: s(36), paddingRight: s(36), background: tk.panelBg }, children: [
          // top: category + brand
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
            ...(category ? [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, color: primaryColor }, children: category } }] : []),
            opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(100) } } } : { type: 'div', props: { style: { fontSize: s(11), fontWeight: tk.brandWeight, letterSpacing: tk.brandLetterSpacing, textTransform: tk.brandTransform, fontFamily: tk.brandFamily, color: muted }, children: brandName } },
          ] } },
          // middle: product name
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(32), fontWeight: 900, lineHeight: 1.1, color: lightTxt, letterSpacing: -0.5 }, children: headline.slice(0, 40) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(13), color: lightMuted, lineHeight: 1.4 }, children: subheadline.slice(0, 80) } }] : []),
          ] } },
          // bottom: price + CTA
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              ...(origPrice ? [{ type: 'div', props: { style: { fontSize: s(12), color: lightMuted, textDecoration: 'line-through' }, children: origPrice } }] : []),
              { type: 'div', props: { style: { fontSize: s(36), fontWeight: 900, color: primaryColor, letterSpacing: -1, lineHeight: 1 }, children: opts.price ?? '' } },
              ...(stockNum && stockNum <= 5 ? [{ type: 'div', props: { style: { fontSize: s(10), color: '#ef4444', fontWeight: 700 }, children: `Only ${stockNum} left` } }] : []),
            ] } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: ctaBg, color: ctaTxt2, fontSize: s(12), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(24), paddingRight: s(24), borderRadius: s(4) }, children: ctaLabel } },
          ] } },
        ] } },
      ] } }
    }

    case 'price-drop': {
      const origPrice = opts.originalPrice ?? ''
      const newPrice  = opts.price ?? ''
      const savings   = opts.badge ?? ''
      const expiry    = opts.expiryText ?? ''
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', background: primaryColor, fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [
          { type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', opacity: 0.15 } } },
        ] : []),
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(12), zIndex: 1 }, children: [
          opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(32), objectFit: 'contain', maxWidth: s(140), marginBottom: s(8) } } } : { type: 'div', props: { style: { fontSize: s(12), fontWeight: tk.brandWeight, letterSpacing: 3, textTransform: 'uppercase' as const, fontFamily: tk.brandFamily, color: 'rgba(255,255,255,0.7)' }, children: brandName } },
          { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.8)' }, children: 'Price Drop' } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(20) }, children: [
            { type: 'div', props: { style: { fontSize: s(36), color: 'rgba(255,255,255,0.45)', textDecoration: 'line-through', fontWeight: 700 }, children: origPrice } },
            { type: 'div', props: { style: { fontSize: s(80), fontWeight: 900, color: '#ffffff', letterSpacing: -3, lineHeight: 1 }, children: newPrice } },
          ] } },
          { type: 'div', props: { style: { fontSize: s(18), fontWeight: 600, color: 'rgba(255,255,255,0.9)', textAlign: 'center' }, children: headline.slice(0, 50) } },
          ...(savings ? [{ type: 'div', props: { style: { background: '#ffffff', color: primaryColor, fontSize: s(13), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(8), paddingBottom: s(8), paddingLeft: s(20), paddingRight: s(20), borderRadius: s(40) }, children: `Save ${savings}` } }] : []),
          ...(expiry ? [{ type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.55)', letterSpacing: 1 }, children: expiry } }] : []),
        ] } },
      ] } }
    }

    case 'new-arrival': {
      const category = opts.productCategory ?? 'New Collection'
      const ctaLabel = opts.ctaText ?? 'Discover Now'
      const ctaBg    = opts.ctaColor ?? '#ffffff'
      const ctaTxt2  = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover' } } }] : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } }]),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: s(40) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(120) } } } : { type: 'div', props: { style: { fontSize: s(12), fontWeight: tk.brandWeight, letterSpacing: 3, textTransform: 'uppercase' as const, fontFamily: tk.brandFamily, color: '#ffffff' }, children: brandName } },
            { type: 'div', props: { style: { fontSize: s(10), fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase' as const, color: primaryColor, background: '#ffffff', paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(2) }, children: 'NEW ARRIVAL' } },
          ] } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(10) }, children: [
            { type: 'div', props: { style: { fontSize: s(11), fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.7)' }, children: category } },
            { type: 'div', props: { style: { fontSize: s(48), fontWeight: 900, lineHeight: 1.05, color: '#ffffff', letterSpacing: -1 }, children: headline.slice(0, 40) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(15), color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }, children: subheadline.slice(0, 80) } }] : []),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16) }, children: [
              { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: ctaBg, color: ctaTxt2, fontSize: s(12), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(3) }, children: ctaLabel } },
              ...(opts.price ? [{ type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: '#ffffff' }, children: opts.price } }] : []),
            ] } },
          ] } },
        ] } },
      ] } }
    }

    case 'flash-deal': {
      const timeLeft = `${opts.timerHours ?? 2}h ${opts.timerMins ?? 30}m`
      const discount = opts.badge ?? '50% OFF'
      const ctaLabel = opts.ctaText ?? 'Grab Deal'
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', background: '#111111', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', opacity: 0.2 } } }] : []),
        { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(14), padding: s(40), zIndex: 1 }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(16) }, children: '⚡' } },
            { type: 'div', props: { style: { fontSize: s(11), fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase' as const, color: primaryColor }, children: 'Flash Deal' } },
          ] } },
          { type: 'div', props: { style: { fontSize: s(80), fontWeight: 900, color: primaryColor, letterSpacing: -2, lineHeight: 1 }, children: discount } },
          { type: 'div', props: { style: { fontSize: s(26), fontWeight: 700, color: '#ffffff', textAlign: 'center' }, children: headline.slice(0, 45) } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.5)', letterSpacing: 1, textTransform: 'uppercase' as const }, children: 'Ends in' } },
            { type: 'div', props: { style: { fontSize: s(18), fontWeight: 800, color: '#ef4444' }, children: timeLeft } },
          ] } },
          ...(opts.price && opts.originalPrice ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16) }, children: [
            { type: 'div', props: { style: { fontSize: s(18), color: 'rgba(255,255,255,0.35)', textDecoration: 'line-through', fontWeight: 500 }, children: opts.originalPrice } },
            { type: 'div', props: { style: { fontSize: s(32), fontWeight: 900, color: '#ffffff' }, children: opts.price } },
          ] } }] : []),
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: primaryColor, color: contrastText(primaryColor), fontSize: s(13), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(40), paddingRight: s(40), borderRadius: s(4) }, children: ctaLabel } },
          opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(80), opacity: 0.6, marginTop: s(8) } } } : { type: 'div', props: { style: { fontSize: s(9), fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.3)' }, children: brandName } },
        ] } },
      ] } }
    }

    // ── Real estate variants ──────────────────────────────────────────────────

    case 'property-listing': {
      const beds    = opts.bedrooms ?? 3
      const baths   = opts.bathrooms ?? 2
      const area    = opts.sqft ?? ''
      const addr    = opts.propertyAddress ?? subheadline ?? ''
      const agent   = opts.agentName ?? brandName
      const propPx  = opts.propertyPrice ?? opts.price ?? ''
      const pill2   = (icon: string, val: string | number) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(5), background: 'rgba(255,255,255,0.12)', paddingTop: s(6), paddingBottom: s(6), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(4) }, children: [
        { type: 'div', props: { style: { fontSize: s(14) }, children: icon } },
        { type: 'div', props: { style: { fontSize: s(12), fontWeight: 600, color: '#ffffff' }, children: String(val) } },
      ] } })
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover' } } }] : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } }]),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(h * 0.55), background: 'rgba(0,0,0,0.6)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: s(36) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(120) } } } : { type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, letterSpacing: 2, color: '#ffffff', fontFamily: tk.brandFamily }, children: brandName } },
            { type: 'div', props: { style: { background: primaryColor, color: contrastText(primaryColor), fontSize: s(10), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(6), paddingBottom: s(6), paddingLeft: s(14), paddingRight: s(14), borderRadius: s(3) }, children: 'For Sale' } },
          ] } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(12) }, children: [
            { type: 'div', props: { style: { display: 'flex', gap: s(8) }, children: [pill2('🛏', `${beds} Beds`), pill2('🚿', `${baths} Baths`), ...(area ? [pill2('📐', area)] : [])] } },
            { type: 'div', props: { style: { fontSize: s(40), fontWeight: 900, color: '#ffffff', letterSpacing: -1, lineHeight: 1 }, children: propPx } },
            { type: 'div', props: { style: { fontSize: s(15), color: 'rgba(255,255,255,0.8)', lineHeight: 1.3 }, children: addr.slice(0, 60) } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { width: s(24), height: s(24), borderRadius: s(12), background: primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: { type: 'div', props: { style: { fontSize: s(10), color: contrastText(primaryColor), fontWeight: 700 }, children: agent.slice(0,1).toUpperCase() } } } },
              { type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.7)', fontWeight: 500 }, children: agent } },
            ] } },
          ] } },
        ] } },
      ] } }
    }

    case 'open-house': {
      const addr     = opts.propertyAddress ?? subheadline ?? ''
      const propPx   = opts.propertyPrice ?? opts.price ?? ''
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        { type: 'div', props: { style: { width: Math.round(w * 0.48), height: h, display: 'flex', position: 'relative', overflow: 'hidden' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: Math.round(w * 0.48), height: h, objectFit: 'cover' } } }] : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } }]),
          { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(20), background: '#ffffff', paddingTop: s(8), paddingBottom: s(8), paddingLeft: s(14), paddingRight: s(14), borderRadius: s(3), display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
            { type: 'div', props: { style: { fontSize: s(9), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, color: primaryColor }, children: 'Open House' } },
            { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: '#111' }, children: opts.eventDate ?? '' } },
            { type: 'div', props: { style: { fontSize: s(11), color: '#555' }, children: opts.eventTime ?? '' } },
          ] } },
        ] } },
        { type: 'div', props: { style: { flex: 1, height: h, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(16), paddingTop: s(40), paddingBottom: s(40), paddingLeft: s(36), paddingRight: s(36), background: '#ffffff' }, children: [
          opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(100), marginBottom: s(8) } } } : { type: 'div', props: { style: { fontSize: s(10), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, color: primaryColor }, children: brandName } },
          { type: 'div', props: { style: { fontSize: s(36), fontWeight: 900, color: '#111', lineHeight: 1.1, letterSpacing: -0.5 }, children: propPx || headline.slice(0, 20) } },
          { type: 'div', props: { style: { fontSize: s(13), color: '#555', lineHeight: 1.5 }, children: addr.slice(0, 70) } },
          { type: 'div', props: { style: { display: 'flex', gap: s(12) }, children: [
            ...(opts.bedrooms ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 900, color: primaryColor }, children: String(opts.bedrooms) } },
              { type: 'div', props: { style: { fontSize: s(10), color: '#888', letterSpacing: 1 }, children: 'BEDS' } },
            ] } }] : []),
            ...(opts.bathrooms ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 900, color: primaryColor }, children: String(opts.bathrooms) } },
              { type: 'div', props: { style: { fontSize: s(10), color: '#888', letterSpacing: 1 }, children: 'BATHS' } },
            ] } }] : []),
            ...(opts.sqft ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 900, color: primaryColor }, children: opts.sqft } },
              { type: 'div', props: { style: { fontSize: s(10), color: '#888', letterSpacing: 1 }, children: 'SQ FT' } },
            ] } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'sold-announcement': {
      const propPx = opts.propertyPrice ?? opts.price ?? ''
      const addr   = opts.propertyAddress ?? subheadline ?? ''
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover' } } }] : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: '#f8f5f1' } } }]),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)' } } },
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(16), zIndex: 1, padding: s(40) }, children: [
          { type: 'div', props: { style: { background: '#ef4444', color: '#ffffff', fontSize: s(22), fontWeight: 900, letterSpacing: 6, textTransform: 'uppercase' as const, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(36), paddingRight: s(36), borderRadius: s(4) }, children: 'SOLD' } },
          { type: 'div', props: { style: { fontSize: s(48), fontWeight: 900, color: '#ffffff', letterSpacing: -1, lineHeight: 1, textAlign: 'center' }, children: propPx || headline.slice(0, 20) } },
          { type: 'div', props: { style: { fontSize: s(15), color: 'rgba(255,255,255,0.8)', textAlign: 'center' }, children: addr.slice(0, 60) } },
          { type: 'div', props: { style: { width: s(40), height: s(2), background: '#ffffff', opacity: 0.4 } } },
          opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(120) } } } : { type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.7)' }, children: brandName } },
          { type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.5)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Thank You For Your Trust' } },
        ] } },
      ] } }
    }

    // ── SaaS / Tech variants ──────────────────────────────────────────────────

    case 'feature-launch': {
      const icon     = opts.featureIcon ?? '✦'
      const version  = opts.version ?? ''
      const ctaLabel = opts.ctaText ?? 'Try It Free'
      const ctaBg    = opts.ctaColor ?? accentBar
      const ctaTxt2  = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg }, children: [
        // accent bar left
        { type: 'div', props: { style: { width: s(6), height: h, background: primaryColor, flexShrink: 0 } } },
        { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(20), paddingTop: s(48), paddingBottom: s(48), paddingLeft: s(52), paddingRight: s(52) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10) }, children: [
            { type: 'div', props: { style: { fontSize: s(24) }, children: icon } },
            ...(version ? [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: primaryColor, background: `${primaryColor}18`, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: version } }] : []),
            opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(80), marginLeft: s(4) } } } : { type: 'div', props: { style: { fontSize: s(10), fontWeight: tk.brandWeight, letterSpacing: 2, textTransform: 'uppercase' as const, color: muted, fontFamily: tk.brandFamily }, children: brandName } },
          ] } },
          { type: 'div', props: { style: { fontSize: s(52), fontWeight: 900, lineHeight: 1.05, color: lightTxt, letterSpacing: -1.5 }, children: headline.slice(0, 45) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(16), color: lightMuted, lineHeight: 1.6, maxWidth: s(640) }, children: subheadline.slice(0, 120) } }] : []),
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16) }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: ctaBg, color: ctaTxt2, fontSize: s(13), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(32), paddingRight: s(32), borderRadius: s(4) }, children: ctaLabel } },
            ...(opts.price ? [{ type: 'div', props: { style: { fontSize: s(13), color: lightMuted }, children: opts.price } }] : []),
          ] } },
        ] } },
        ...(bgImageData ? [{ type: 'div', props: { style: { width: Math.round(w * 0.38), height: h, position: 'relative', overflow: 'hidden', flexShrink: 0 }, children: [
          { type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: Math.round(w * 0.38), height: h, objectFit: 'cover' } } },
        ] } }] : []),
      ] } }
    }

    case 'changelog': {
      const items   = opts.changelogItems ?? [headline]
      const version = opts.version ?? 'v1.0'
      const date    = opts.eventDate ?? ''
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg }, children: [
        { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(28), paddingTop: s(48), paddingBottom: s(48), paddingLeft: s(56), paddingRight: s(56) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12) }, children: [
            { type: 'div', props: { style: { background: primaryColor, color: contrastText(primaryColor), fontSize: s(11), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(3) }, children: version } },
            ...(date ? [{ type: 'div', props: { style: { fontSize: s(11), color: muted }, children: date } }] : []),
          ] } },
          { type: 'div', props: { style: { fontSize: s(42), fontWeight: 900, color: lightTxt, lineHeight: 1.1, letterSpacing: -1 }, children: headline.slice(0, 40) } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(10) }, children: items.slice(0, 4).map((item: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'flex-start', gap: s(10) }, children: [
            { type: 'div', props: { style: { width: s(6), height: s(6), borderRadius: s(3), background: primaryColor, marginTop: s(6), flexShrink: 0 } } },
            { type: 'div', props: { style: { fontSize: s(14), color: lightMuted, lineHeight: 1.5 }, children: item } },
          ] } })) } },
        ] } },
        { type: 'div', props: { style: { width: s(4), height: h, background: primaryColor, flexShrink: 0 } } },
      ] } }
    }

    case 'waitlist-signup': {
      const count    = opts.waitlistCount ?? ''
      const launch   = opts.launchDate ?? ''
      const ctaLabel = opts.ctaText ?? 'Join Waitlist'
      const ctaBg    = opts.ctaColor ?? primaryColor
      const ctaTxt2  = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', opacity: 0.12 } } }] : []),
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(18), zIndex: 1, padding: s(40) }, children: [
          opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(36), objectFit: 'contain', maxWidth: s(150), marginBottom: s(8) } } } : { type: 'div', props: { style: { fontSize: s(13), fontWeight: tk.brandWeight, letterSpacing: 3, textTransform: 'uppercase' as const, fontFamily: tk.brandFamily, color: 'rgba(255,255,255,0.7)' }, children: brandName } },
          { type: 'div', props: { style: { fontSize: s(56), fontWeight: 900, color: '#ffffff', lineHeight: 1.05, letterSpacing: -1.5, textAlign: 'center' }, children: headline.slice(0, 40) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(16), color: 'rgba(255,255,255,0.75)', textAlign: 'center', lineHeight: 1.5, maxWidth: s(560) }, children: subheadline.slice(0, 100) } }] : []),
          ...(count ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: '#ffffff' }, children: count } },
            { type: 'div', props: { style: { fontSize: s(13), color: 'rgba(255,255,255,0.65)' }, children: 'already signed up' } },
          ] } }] : []),
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16) }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', color: primaryColor, fontSize: s(13), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(36), paddingRight: s(36), borderRadius: s(4) }, children: ctaLabel } },
            ...(launch ? [{ type: 'div', props: { style: { fontSize: s(12), color: 'rgba(255,255,255,0.6)' }, children: `Launching ${launch}` } }] : []),
          ] } },
        ] } },
      ] } }
    }

    // ── Fitness variants ──────────────────────────────────────────────────────

    case 'transformation': {
      const bStat   = opts.beforeStat ?? stat ?? ''
      const aStat   = opts.afterStat ?? ''
      const dur     = opts.duration ?? ''
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        // left: before
        { type: 'div', props: { style: { width: Math.round(w * 0.5), height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', position: 'relative', overflow: 'hidden', background: '#e5e7eb', paddingBottom: s(28) }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: Math.round(w * 0.5), height: h, objectFit: 'cover' } } }] : []),
          { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.3)' } } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4), zIndex: 1 }, children: [
            { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.7)' }, children: 'Before' } },
            { type: 'div', props: { style: { fontSize: s(40), fontWeight: 900, color: '#ffffff', letterSpacing: -1 }, children: bStat } },
          ] } },
        ] } },
        // right: after
        { type: 'div', props: { style: { width: Math.round(w * 0.5), height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', position: 'relative', overflow: 'hidden', background: primaryColor, paddingBottom: s(28) }, children: [
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4), zIndex: 1 }, children: [
            { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.7)' }, children: 'After' } },
            { type: 'div', props: { style: { fontSize: s(40), fontWeight: 900, color: '#ffffff', letterSpacing: -1 }, children: aStat } },
          ] } },
        ] } },
        // center divider + label
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: s(28), gap: s(8) }, children: [
          opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(100) } } } : { type: 'div', props: { style: { fontSize: s(11), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, color: '#ffffff' }, children: brandName } },
          { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: '#ffffff', textAlign: 'center', letterSpacing: -0.5 }, children: headline.slice(0, 30) } },
          ...(dur ? [{ type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.65)', letterSpacing: 1 }, children: `In ${dur}` } }] : []),
        ] } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, bottom: 0, left: Math.round(w * 0.5) - s(2), width: s(4), background: '#ffffff' } } },
        { type: 'div', props: { style: { position: 'absolute', top: Math.round(h * 0.5) - s(16), left: Math.round(w * 0.5) - s(16), width: s(32), height: s(32), borderRadius: s(16), background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: { type: 'div', props: { style: { fontSize: s(14) }, children: '↔' } } } },
      ] } }
    }

    case 'class-schedule': {
      const classT   = opts.classType ?? headline
      const time     = opts.classTime ?? ''
      const dur      = opts.classDuration ?? ''
      const instr    = opts.instructor ?? ''
      const ctaLabel = opts.ctaText ?? 'Book Class'
      const ctaBg    = opts.ctaColor ?? primaryColor
      const ctaTxt2  = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover' } } }] : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } }]),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: s(36) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(100) } } } : { type: 'div', props: { style: { fontSize: s(11), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.8)', fontFamily: tk.brandFamily }, children: brandName } },
            { type: 'div', props: { style: { background: primaryColor, color: contrastText(primaryColor), fontSize: s(9), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(3) }, children: 'Class Schedule' } },
          ] } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(12) }, children: [
            { type: 'div', props: { style: { fontSize: s(52), fontWeight: 900, color: '#ffffff', lineHeight: 1, letterSpacing: -1 }, children: classT.slice(0, 22) } },
            { type: 'div', props: { style: { display: 'flex', gap: s(16) }, children: [
              ...(time ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
                { type: 'div', props: { style: { fontSize: s(22), fontWeight: 800, color: '#ffffff' }, children: time } },
                { type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.6)', letterSpacing: 1, textTransform: 'uppercase' as const }, children: 'Time' } },
              ] } }] : []),
              ...(dur ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
                { type: 'div', props: { style: { fontSize: s(22), fontWeight: 800, color: primaryColor }, children: dur } },
                { type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.6)', letterSpacing: 1, textTransform: 'uppercase' as const }, children: 'Duration' } },
              ] } }] : []),
            ] } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
              ...(instr ? [{ type: 'div', props: { style: { fontSize: s(12), color: 'rgba(255,255,255,0.7)' }, children: `with ${instr}` } }] : [{ type: 'div', props: { style: {} } }]),
              { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: ctaBg, color: ctaTxt2, fontSize: s(12), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(4) }, children: ctaLabel } },
            ] } },
          ] } },
        ] } },
      ] } }
    }

    // ── Food & Beverage variants ──────────────────────────────────────────────

    case 'menu-special': {
      const dish     = opts.dishName ?? headline
      const dishPx   = opts.dishPrice ?? opts.price ?? ''
      const tags     = opts.dietaryTags ?? []
      const prep     = opts.prepTime ?? ''
      const cals     = opts.calories ?? ''
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover' } } }] : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } }]),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(h * 0.5), background: 'rgba(0,0,0,0.7)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(20), right: s(20), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
          opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(120) } } } : { type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, color: '#ffffff', fontFamily: tk.brandFamily }, children: brandName } },
          { type: 'div', props: { style: { background: primaryColor, color: contrastText(primaryColor), fontSize: s(9), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(3) }, children: "Today's Special" } },
        ] } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(28), right: s(28), display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
          { type: 'div', props: { style: { display: 'flex', gap: s(6) }, children: tags.slice(0, 3).map((tag: string) => ({ type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, color: primaryColor, background: 'rgba(255,255,255,0.12)', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(8), paddingRight: s(8), borderRadius: s(3) }, children: tag } })) } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { fontSize: s(40), fontWeight: 900, color: '#ffffff', lineHeight: 1, letterSpacing: -0.5 }, children: dish.slice(0, 28) } },
            { type: 'div', props: { style: { fontSize: s(36), fontWeight: 900, color: primaryColor, letterSpacing: -1 }, children: dishPx } },
          ] } },
          { type: 'div', props: { style: { display: 'flex', gap: s(16) }, children: [
            ...(prep ? [{ type: 'div', props: { style: { fontSize: s(12), color: 'rgba(255,255,255,0.6)' }, children: `⏱ ${prep}` } }] : []),
            ...(cals ? [{ type: 'div', props: { style: { fontSize: s(12), color: 'rgba(255,255,255,0.6)' }, children: `🔥 ${cals}` } }] : []),
          ] } },
        ] } },
      ] } }
    }

    // ── Education variants ────────────────────────────────────────────────────

    case 'course-launch': {
      const course   = opts.courseName ?? headline
      const level    = opts.courseLevel ?? ''
      const lessons  = opts.lessonCount
      const students = opts.studentCount ?? ''
      const ctaLabel = opts.ctaText ?? 'Enroll Now'
      const ctaBg    = opts.ctaColor ?? primaryColor
      const ctaTxt2  = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg }, children: [
        { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(20), paddingTop: s(48), paddingBottom: s(48), paddingLeft: s(52), paddingRight: s(40) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(80) } } } : { type: 'div', props: { style: { fontSize: s(10), fontWeight: tk.brandWeight, letterSpacing: 2, textTransform: 'uppercase' as const, color: primaryColor, fontFamily: tk.brandFamily }, children: brandName } },
            ...(level ? [{ type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: primaryColor, background: `${primaryColor}18`, paddingTop: s(3), paddingBottom: s(3), paddingLeft: s(8), paddingRight: s(8), borderRadius: s(3) }, children: level } }] : []),
          ] } },
          { type: 'div', props: { style: { fontSize: s(46), fontWeight: 900, lineHeight: 1.1, color: lightTxt, letterSpacing: -1 }, children: course.slice(0, 45) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(15), color: lightMuted, lineHeight: 1.5 }, children: subheadline.slice(0, 100) } }] : []),
          { type: 'div', props: { style: { display: 'flex', gap: s(24) }, children: [
            ...(lessons ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(24), fontWeight: 900, color: primaryColor }, children: String(lessons) },},
              { type: 'div', props: { style: { fontSize: s(10), color: muted, letterSpacing: 1 }, children: 'LESSONS' } },
            ] } }] : []),
            ...(students ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(24), fontWeight: 900, color: primaryColor }, children: students },},
              { type: 'div', props: { style: { fontSize: s(10), color: muted, letterSpacing: 1 }, children: 'STUDENTS' } },
            ] } }] : []),
            ...(opts.price ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(24), fontWeight: 900, color: primaryColor }, children: opts.price },},
              { type: 'div', props: { style: { fontSize: s(10), color: muted, letterSpacing: 1 }, children: 'PRICE' } },
            ] } }] : []),
          ] } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: ctaBg, color: ctaTxt2, fontSize: s(13), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(32), paddingRight: s(32), borderRadius: s(4), alignSelf: 'flex-start' }, children: ctaLabel } },
        ] } },
        ...(bgImageData ? [{ type: 'div', props: { style: { width: Math.round(w * 0.4), height: h, position: 'relative', overflow: 'hidden', flexShrink: 0 }, children: [
          { type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: Math.round(w * 0.4), height: h, objectFit: 'cover' } } },
        ] } }] : []),
      ] } }
    }

    case 'certification': {
      const certName  = opts.certificateName ?? headline
      const recipient = opts.recipientName ?? ''
      const date      = opts.completionDate ?? opts.eventDate ?? ''
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#fffdf7' }, children: [
        // border frame
        { type: 'div', props: { style: { position: 'absolute', top: s(12), left: s(12), right: s(12), bottom: s(12), borderWidth: s(3), borderStyle: 'solid', borderColor: primaryColor, borderRadius: s(4), opacity: 0.3 } } },
        { type: 'div', props: { style: { position: 'absolute', top: s(18), left: s(18), right: s(18), bottom: s(18), borderWidth: s(1), borderStyle: 'solid', borderColor: primaryColor, borderRadius: s(2), opacity: 0.15 } } },
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(12), padding: s(48), zIndex: 1 }, children: [
          opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(40), objectFit: 'contain', maxWidth: s(160), marginBottom: s(8) } } } : { type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase' as const, color: primaryColor, fontFamily: tk.brandFamily }, children: brandName } },
          { type: 'div', props: { style: { fontSize: s(10), fontWeight: 600, letterSpacing: 4, textTransform: 'uppercase' as const, color: muted }, children: 'Certificate of Completion' } },
          { type: 'div', props: { style: { width: s(60), height: s(2), background: primaryColor, opacity: 0.3 } } },
          ...(recipient ? [{ type: 'div', props: { style: { fontSize: s(36), fontWeight: 700, color: '#222', fontFamily: tk.headlineFamily, letterSpacing: 0.5, textAlign: 'center' }, children: recipient } }] : []),
          { type: 'div', props: { style: { fontSize: s(11), color: muted }, children: 'has successfully completed' } },
          { type: 'div', props: { style: { fontSize: s(28), fontWeight: 800, color: primaryColor, textAlign: 'center', letterSpacing: -0.5 }, children: certName.slice(0, 50) } },
          { type: 'div', props: { style: { width: s(60), height: s(2), background: primaryColor, opacity: 0.3 } } },
          ...(date ? [{ type: 'div', props: { style: { fontSize: s(11), color: muted, letterSpacing: 1 }, children: date } }] : []),
        ] } },
      ] } }
    }

    // ── Finance variants ──────────────────────────────────────────────────────

    case 'market-update': {
      const ticker   = opts.ticker ?? brandName.slice(0, 5).toUpperCase()
      const change   = opts.priceChange ?? stat ?? ''
      const isPos    = opts.positive ?? (!change.startsWith('-'))
      const chgColor = isPos ? '#22c55e' : '#ef4444'
      const currentPx = opts.price ?? ''
      const chartPts  = opts.chartData ?? [40, 55, 45, 60, 52, 68, 58, 72, 65, 80, 70, 85]
      const chartW   = s(200)
      const chartH   = s(60)
      const minV     = Math.min(...chartPts)
      const maxV     = Math.max(...chartPts)
      const chartPath = chartPts.map((v, i) => {
        const x = Math.round((i / (chartPts.length - 1)) * chartW)
        const y = Math.round(chartH - ((v - minV) / (maxV - minV || 1)) * chartH)
        return `${i === 0 ? 'M' : 'L'}${x},${y}`
      }).join(' ')
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0a0a0f' }, children: [
        { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(16), paddingTop: s(40), paddingBottom: s(40), paddingLeft: s(48), paddingRight: s(48) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12) }, children: [
            opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } } : { type: 'div', props: { style: { fontSize: s(10), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.4)' }, children: brandName } },
            { type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.3)', letterSpacing: 1 }, children: 'Market Update' } },
          ] } },
          { type: 'div', props: { style: { fontSize: s(42), fontWeight: 900, letterSpacing: 2, color: '#ffffff' }, children: ticker } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: s(16) }, children: [
            { type: 'div', props: { style: { fontSize: s(52), fontWeight: 900, color: '#ffffff', letterSpacing: -1, lineHeight: 1 }, children: currentPx } },
            { type: 'div', props: { style: { fontSize: s(24), fontWeight: 700, color: chgColor }, children: change } },
          ] } },
          { type: 'div', props: { style: { fontSize: s(14), color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }, children: headline.slice(0, 80) } },
        ] } },
        { type: 'div', props: { style: { width: Math.round(w * 0.35), height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, paddingRight: s(36) }, children: [
          { type: 'svg', props: { width: chartW, height: chartH, viewBox: `0 0 ${chartW} ${chartH}`, style: {}, children: [
            { type: 'path', props: { d: chartPath, fill: 'none', stroke: chgColor, 'stroke-width': String(s(2.5)), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' } },
          ] } },
        ] } },
      ] } }
    }

    case 'rate-announcement': {
      const rate     = opts.interestRate ?? stat ?? ''
      const rateType = opts.rateType ?? 'APY'
      const ctaLabel = opts.ctaText ?? 'Open Account'
      return { type: 'div', props: { style: { width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: h, objectFit: 'cover', opacity: 0.1 } } }] : []),
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(16), zIndex: 1, padding: s(40) }, children: [
          opts.logoData ? { type: 'img', props: { src: opts.logoData, style: { height: s(36), objectFit: 'contain', maxWidth: s(150), marginBottom: s(8) } } } : { type: 'div', props: { style: { fontSize: s(13), fontWeight: tk.brandWeight, letterSpacing: 3, textTransform: 'uppercase' as const, fontFamily: tk.brandFamily, color: 'rgba(255,255,255,0.7)' }, children: brandName } },
          { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.7)' }, children: headline.slice(0, 40) } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(96), fontWeight: 900, color: '#ffffff', lineHeight: 1, letterSpacing: -3 }, children: rate } },
            { type: 'div', props: { style: { fontSize: s(28), fontWeight: 700, color: 'rgba(255,255,255,0.8)' }, children: rateType } },
          ] } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(15), color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 1.5, maxWidth: s(520) }, children: subheadline.slice(0, 100) } }] : []),
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', color: primaryColor, fontSize: s(13), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(36), paddingRight: s(36), borderRadius: s(4), marginTop: s(8) }, children: ctaLabel } },
        ] } },
      ] } }
    }

    // ── 65+ new variants delegated to variant group files ─────────────────────
    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const helpers: any = {
        s, sh, sb, sp, w, h,
        txt:   ptxt,   // ec-wrapped alias (legacy variant files use h.txt)
        muted: pmuted, // ec-wrapped alias (legacy variant files use h.muted)
        accent, lightTxt, lightMuted,
        primaryColor, brandName, headline, subheadline, stat,
        bgImageData, logoData: opts.logoData, tk, accentBar, contrastText,
        // vertical theme — variant files use canvasBg for dark/light backgrounds
        canvasBg: opts.canvasBg ?? primaryColor,
        isDark:   opts.isDark   ?? false,
        // palette-aware colors — brand-hued tones instead of flat #fff/#000
        palette,
        ptxt,
        pbody,
        pmuted,
        // pre-computed dark-surface and light-surface text variants
        ptxtDark,
        pbodyDark,
        pmutedDark,
        ptxtLight,
        pbodyLight,
        pmutedLight,
        // palette-hued contrast text for platform-coloured badges
        paletteContrastText: (bgHex: string) => paletteContrastText(bgHex, palette),
        // WCAG contrast enforcer — use when a variant renders on its own background
        // e.g. h.ec(h.ptxt, primaryColor) ensures legibility when bg ≠ canvasBg
        ec: (color: string, bg: string, minRatio?: number) => ec(color, bg, minRatio),
        // ── Smart text colors — THE universal solution ────────────────────────
        // Photo mode  (bgImageData present): forced white — always readable on dark photo scrims
        // Canvas mode (no photo):            ec-safe palette tone on primaryColor
        // Use h.sTxt / h.sBody / h.sMuted everywhere in external variant files instead
        // of h.ptxt / h.pbody / h.pmuted — branches automatically, zero per-variant logic.
        sTxt:   bgImageData ? '#ffffff'              : ec(ptxt,   primaryColor),
        sBody:  bgImageData ? 'rgba(255,255,255,0.88)' : ec(pbody,  primaryColor, 3.5),
        sMuted: bgImageData ? 'rgba(255,255,255,0.65)' : ec(pmuted, primaryColor, 3.0),
        // layout tokens
        lk: layout,
        lta,
      }
      const mediaResult = buildMediaVariants(variant, opts, helpers)
      if (mediaResult) return mediaResult

      const socialResult = buildSocialVariants(variant, opts, helpers)
      if (socialResult) return socialResult

      const businessResult = buildBusinessVariants(variant, opts, helpers)
      if (businessResult) return businessResult

      const contentResult = buildContentVariants(variant, opts, helpers)
      if (contentResult) return contentResult

      const lifestyleResult = buildLifestyleVariants(variant, opts, helpers)
      if (lifestyleResult) return lifestyleResult

      const automotiveResult = buildAutomotiveVariants(variant, opts, helpers)
      if (automotiveResult) return automotiveResult

      const fashionResult = buildFashionVariants(variant, opts, helpers)
      if (fashionResult) return fashionResult

      const web3Result = buildWeb3Variants(variant, opts, helpers)
      if (web3Result) return web3Result

      const nonprofitResult = buildNonprofitVariants(variant, opts, helpers)
      if (nonprofitResult) return nonprofitResult

      const interiorResult = buildInteriorVariants(variant, opts, helpers)
      if (interiorResult) return interiorResult

      const hrResult = buildHrCultureVariants(variant, opts, helpers)
      if (hrResult) return hrResult

      // Final fallback — render as editorial-hero
      return buildCardJSX('editorial-hero', opts)
    }
  }
}

// ── SatoriDO — Durable Object ─────────────────────────────────────────────────

export class SatoriDO extends DurableObject {
  private readonly fonts: Array<{ name: string; data: ArrayBuffer; weight: number; style: 'normal' | 'italic' }>
  private active = 0
  private readonly MAX = 2
  private readonly queue: Array<() => void> = []
  private readonly lru        = new LRUCache<Uint8Array>(20)
  private readonly imageCache = new LRUCache<string>(10)
  private readonly fontCache  = new Map<string, ArrayBuffer>()

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.fonts = [
      { name: 'Inter', data: inter400 as ArrayBuffer, weight: 400, style: 'normal' },
      { name: 'Inter', data: inter700 as ArrayBuffer, weight: 700, style: 'normal' },
      { name: 'Inter', data: inter800 as ArrayBuffer, weight: 800, style: 'normal' },
      { name: 'Inter', data: inter900 as ArrayBuffer, weight: 900, style: 'normal' },
      { name: 'Playfair Display', data: playfair400Normal as ArrayBuffer, weight: 400, style: 'normal' },
      { name: 'Playfair Display', data: playfair400Italic as ArrayBuffer, weight: 400, style: 'italic' },
      { name: 'Cormorant Garamond', data: cormorant400Normal as ArrayBuffer, weight: 400, style: 'normal' },
      { name: 'Cormorant Garamond', data: cormorant400Italic as ArrayBuffer, weight: 400, style: 'italic' },
      { name: 'Cormorant Garamond', data: cormorant600Normal as ArrayBuffer, weight: 600, style: 'normal' },
      { name: 'Cormorant Garamond', data: cormorant600Italic as ArrayBuffer, weight: 600, style: 'italic' },
      { name: 'Dancing Script', data: dancing400Normal as ArrayBuffer, weight: 400, style: 'normal' },
      { name: 'Dancing Script', data: dancing700Normal as ArrayBuffer, weight: 700, style: 'normal' },
      { name: 'Bebas Neue', data: bebas400Normal as ArrayBuffer, weight: 400, style: 'normal' },
    ]
  }

  private acquire(): Promise<void> {
    if (this.active < this.MAX) { this.active++; return Promise.resolve() }
    return new Promise<void>(resolve => this.queue.push(resolve))
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) { next() } else { this.active-- }
  }

  private async loadFontsForText(
    text: string,
  ): Promise<Array<{ name: string; data: ArrayBuffer; weight: number; style: 'normal' | 'italic' }>> {
    const extra: Array<{ name: string; data: ArrayBuffer; weight: number; style: 'normal' | 'italic' }> = []

    const extractUnique = (re: RegExp) =>
      [...new Set((text.match(re) ?? []))].join('')

    const scriptFamilies: Array<{ re: RegExp; family: string }> = [
      { re: /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF]/g, family: 'Noto Sans JP' },
      { re: /[\uAC00-\uD7AF]/g,       family: 'Noto Sans KR' },
      { re: /[\u0600-\u06FF\u0750-\u077F]/g, family: 'Noto Sans Arabic' },
      { re: /[\u0590-\u05FF]/g,       family: 'Noto Sans Hebrew' },
      { re: /[\u0900-\u097F]/g,       family: 'Noto Sans Devanagari' },
      { re: /[\u0E00-\u0E7F]/g,       family: 'Noto Sans Thai' },
    ]

    for (const { re, family } of scriptFamilies) {
      const uniqueChars = extractUnique(re)
      if (!uniqueChars) continue

      const storageKey = `font:${family.replace(/ /g, '-').toLowerCase()}:${await sha256Hex(uniqueChars)}`

      const memHit = this.fontCache.get(storageKey)
      if (memHit) { extra.push({ name: family, data: memHit, weight: 400, style: 'normal' }); continue }

      try {
        const stored = await this.ctx.storage.get<ArrayBuffer>(storageKey)
        if (stored) {
          this.fontCache.set(storageKey, stored)
          extra.push({ name: family, data: stored, weight: 400, style: 'normal' })
          continue
        }
      } catch { /* fall through */ }

      try {
        const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&text=${encodeURIComponent(uniqueChars)}&display=block`
        const cssResp = await fetch(cssUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
        })
        if (!cssResp.ok) { console.warn(`[font-load] Google Fonts ${family} ${cssResp.status}`); continue }
        const css = await cssResp.text()

        const urlMatch = css.match(/src:\s*url\(([^)]+\.woff2?)\)/)
        if (!urlMatch) continue

        const fontResp = await fetch(urlMatch[1])
        if (!fontResp.ok) continue

        const fontData = await fontResp.arrayBuffer()
        this.fontCache.set(storageKey, fontData)
        this.ctx.storage.put(storageKey, fontData).catch(() => {})
        this.ctx.storage.put(`font-ts:${storageKey}`, Date.now()).catch(() => {})
        extra.push({ name: family, data: fontData, weight: 400, style: 'normal' })
        console.log(`[font-load] fetched ${family} subset (${fontData.byteLength} B)`)
      } catch (e) {
        console.warn(`[font-load] failed for ${family}:`, e)
      }
    }

    return extra
  }

  async fetchLogo(url: string): Promise<string | null> {
    const cached = this.imageCache.get(`logo:${url}`)
    if (cached) return cached
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const ct = res.headers.get('Content-Type') ?? 'image/png'
      const dataUri = `data:${ct};base64,${btoa(binary)}`
      this.imageCache.set(`logo:${url}`, dataUri)
      return dataUri
    } catch { return null }
  }

  async loadBrandFont(fontUrl: string, fontFamily: string): Promise<{ data: ArrayBuffer; name: string; weight: number; style: string } | null> {
    const cacheKey = fontUrl
    if (this.fontCache.has(cacheKey)) {
      return { data: this.fontCache.get(cacheKey)!, name: fontFamily, weight: 400, style: 'normal' }
    }
    try {
      // Handle Google Fonts CSS URL — extract first woff2 URL
      let finalUrl = fontUrl
      if (fontUrl.includes('fonts.googleapis.com')) {
        const cssRes = await fetch(fontUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!cssRes.ok) return null
        const css = await cssRes.text()
        const match = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+\.woff2)\)/)
        if (!match) return null
        finalUrl = match[1]
      }
      const res = await fetch(finalUrl)
      if (!res.ok) return null
      const buf = await res.arrayBuffer()
      this.fontCache.set(cacheKey, buf)
      return { data: buf, name: fontFamily, weight: 400, style: 'normal' }
    } catch { return null }
  }

  /**
   * Fetch a 4×4 pixel thumbnail from Pexels CDN and decode the JPEG DC Y
   * coefficient to estimate average luminance. A 4×4 JPEG fits in ~300–900 bytes.
   * Returns 0–1 (0 = black, 1 = white). Falls back to 0.5 on any error.
   */
  private async fetchBgLuminance(url: string): Promise<number> {
    try {
      const base = url.split('?')[0]
      const tinyUrl = `${base}?auto=compress&cs=tinysrgb&w=4&h=4&fit=crop`
      const res = await fetch(tinyUrl)
      if (!res.ok) return 0.5
      const buf   = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      return decodeJpegLuma(bytes)
    } catch {
      return 0.5
    }
  }

  private async fetchBgImage(url: string): Promise<string | null> {
    const hit = this.imageCache.get(url)
    if (hit) return hit
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const buf   = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary  = ''
      const chunk = 8192
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
      }
      const dataUri = `data:image/jpeg;base64,${btoa(binary)}`
      this.imageCache.set(url, dataUri)
      return dataUri
    } catch {
      return null
    }
  }

  private async evictStale(
    imgTtlMs  = 30 * 24 * 60 * 60 * 1000,
    fontTtlMs = 90 * 24 * 60 * 60 * 1000,
  ): Promise<{ deletedImages: number; deletedFonts: number }> {
    const now = Date.now()
    const toDelete: string[] = []

    const tsEntries = await this.ctx.storage.list<number>({ prefix: 'ts:' })
    for (const [tsKey, ts] of tsEntries) {
      if (typeof ts === 'number' && ts < now - imgTtlMs) {
        toDelete.push(tsKey)
        toDelete.push(tsKey.slice(3))
      }
    }
    const deletedImages = Math.floor(toDelete.length / 2)

    const fontTsEntries = await this.ctx.storage.list<number>({ prefix: 'font-ts:' })
    for (const [ftKey, ts] of fontTsEntries) {
      if (typeof ts === 'number' && ts < now - fontTtlMs) {
        toDelete.push(ftKey)
        toDelete.push(ftKey.slice(8))
        this.fontCache.delete(ftKey.slice(8))
      }
    }
    const deletedFonts = Math.floor((toDelete.length - deletedImages * 2) / 2)

    for (let i = 0; i < toDelete.length; i += 128) {
      await this.ctx.storage.delete(toDelete.slice(i, i + 128)).catch(() => {})
    }

    return { deletedImages, deletedFonts }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/evict') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
      const result = await this.evictStale()
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
    }

    // ── /render-tree — renders a pre-hydrated SatoriNode tree directly ─────
    if (url.pathname === '/render-tree') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
      let body: { tree: SatoriNode; width: number; height: number; format?: string }
      try { body = await request.json() } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }
      if (!body.tree || !body.width || !body.height) {
        return new Response(JSON.stringify({ error: 'tree, width, height required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }
      await this.acquire()
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svg   = await satori(body.tree as any, { width: body.width, height: body.height, fonts: this.fonts as any })
        const fmt   = (body.format ?? 'png') as 'png' | 'webp'
        const rsvg  = await Resvg.async(svg, { fitTo: { mode: 'width', value: body.width } })
        let   output: Uint8Array = rsvg.render().asPng()
        if (fmt === 'webp') {
          const photonImg = PhotonImage.new_from_byteslice(output)
          output = photonImg.get_bytes_webp()
          photonImg.free()
        }
        const ct = fmt === 'webp' ? 'image/webp' : 'image/png'
        return new Response(output, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } })
      } finally {
        this.release()
      }
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    let opts: CardOpts
    try {
      opts = await request.json() as CardOpts
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!opts.headline || !opts.brandName || (!opts.primaryColor && !opts.brandUrl)) {
      return new Response(JSON.stringify({ error: 'headline, brandName, primaryColor (or brandUrl) required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Resolve format preset → w/h (preset takes precedence over explicit width/height)
    let w = opts.width  ?? 600
    let h = opts.height ?? 314
    if (opts.preset && FORMAT_PRESETS[opts.preset]) {
      w = FORMAT_PRESETS[opts.preset].w
      h = FORMAT_PRESETS[opts.preset].h
    }

    // Apply personalization tokens to text fields
    const tok         = opts.tokens ?? {}
    const headline    = applyTokens(opts.headline, tok)!
    const subheadline = applyTokens(opts.subheadline, tok)
    const stat        = applyTokens(opts.stat, tok)
    const reviewText  = applyTokens(opts.reviewText, tok)

    const cacheKey   = makeCacheKey({ ...opts, width: w, height: h })
    const storageKey = await sha256Hex(cacheKey)

    const fmt      = (opts.format ?? 'png') as 'png' | 'webp'
    const ctForFmt = fmt === 'webp' ? 'image/webp' : 'image/png'

    // ── L1: in-memory LRU ─────────────────────────────────────────────────────
    const l1 = this.lru.get(cacheKey)
    if (l1) {
      return new Response(l1, {
        headers: { 'Content-Type': ctForFmt, 'Cache-Control': 'public, max-age=86400',
                   'X-Variant': opts.variant ?? 'editorial-hero', 'X-Cache': 'L1' },
      })
    }

    // ── L2: DO persistent storage ─────────────────────────────────────────────
    try {
      const l2 = await this.ctx.storage.get<Uint8Array>(storageKey)
      if (l2) {
        this.lru.set(cacheKey, l2)
        return new Response(l2, {
          headers: { 'Content-Type': ctForFmt, 'Cache-Control': 'public, max-age=86400',
                     'X-Variant': opts.variant ?? 'editorial-hero', 'X-Cache': 'L2' },
        })
      }
    } catch { /* fall through to render */ }

    // ── Render ────────────────────────────────────────────────────────────────
    await this.acquire()
    try {
      // ── Resolve all colors via color-pipeline (single source of truth) ────────
      // This replaces: brand URL extraction + fallback chain + vertical context
      // resolution — all three previously inlined here independently of index.ts.
      const variant = (opts.variant ?? 'editorial-hero') as CardVariantName
      const resolved = await resolveColors({
        primaryColor:        opts.primaryColor,
        brandUrl:            opts.brandUrl,
        variant,
        kv:                  (this.env as Env).API_KEYS,
        extractBrandColorFn: extractBrandColor,
        aesthetic:           opts.aesthetic,
      })
      const bg      = resolved.primary
      const vertCtx = resolved.ctx      // raw VerticalContext for buildSmartBgLayers
      const txt     = resolved.ptxt     // headline text (WCAG AA, most prominent)
      const muted   = resolved.pmuted   // muted text (WCAG AA at 3.0:1)
      const accent  = resolved.accent   // overlay rgba

      const format = (opts.format ?? 'png') as 'png' | 'webp'

      // Fetch full bg image + 1×1 luma thumbnail concurrently (zero extra latency)
      const [bgImageData, bgLuma] = await Promise.all([
        opts.bgImageUrl ? this.fetchBgImage(opts.bgImageUrl) : Promise.resolve(opts.bgImageData ?? null),
        opts.bgImageUrl ? this.fetchBgLuminance(opts.bgImageUrl) : Promise.resolve(
          opts.bgImageData ? estimateBgLuminance(opts.bgImageData) : 0.5
        ),
      ])

      // Light bg images (luma > 0.55) get a white scrim + dark text for readability
      const bgIsLight = bgLuma > 0.55

      const logoData = opts.logoUrl ? await this.fetchLogo(opts.logoUrl) : null

      const allText  = [headline, opts.brandName, subheadline].filter(Boolean).join(' ')
      const extraFonts = await this.loadFontsForText(allText)
      let fonts    = extraFonts.length > 0 ? [...this.fonts, ...extraFonts] : this.fonts

      // Load custom brand font if provided
      if (opts.brandFontUrl && opts.brandFontFamily) {
        const brandFont = await this.loadBrandFont(opts.brandFontUrl, opts.brandFontFamily)
        if (brandFont) {
          fonts = [...fonts, brandFont as { name: string; data: ArrayBuffer; weight: number; style: 'normal' | 'italic' }]
        }
      }

      const rtl = isRTL([headline, opts.brandName, subheadline].filter(Boolean).join(' '))

      const jsxTree = buildCardJSX(variant, {
        headline, subheadline, stat,
        brandName: opts.brandName, primaryColor: bg,
        bgImageData: bgImageData ?? undefined,
        bgIsLight,
        w, h, txt, muted, accent, rtl,
        aesthetic: vertCtx.aesthetic,
        canvasBg:  vertCtx.canvasBg,
        bgStyle:   vertCtx.bgStyle,
        isDark:    vertCtx.isDark,
        palette:   vertCtx.palette,
        // ad creative fields
        price:         opts.price,
        ctaText:       opts.ctaText,
        ctaColor:      opts.ctaColor,
        couponCode:    opts.couponCode,
        expiryText:    opts.expiryText,
        reviewText,
        reviewerName:  opts.reviewerName,
        reviewerTitle: opts.reviewerTitle,
        rating:        opts.rating,
        eventDate:     opts.eventDate,
        eventTime:     opts.eventTime,
        eventLocation: opts.eventLocation,
        // new variant fields
        beforeText:    opts.beforeText,
        afterText:     opts.afterText,
        beforeLabel:   opts.beforeLabel,
        afterLabel:    opts.afterLabel,
        plans:         opts.plans,
        logos:         opts.logos,
        tagline:       opts.tagline,
        timerDays:     opts.timerDays,
        timerHours:    opts.timerHours,
        timerMins:     opts.timerMins,
        timerSecs:     opts.timerSecs,
        appRating:     opts.appRating,
        appDownloads:  opts.appDownloads,
        jobTitle:      opts.jobTitle,
        location:      opts.location,
        jobType:       opts.jobType,
        salary:        opts.salary,
        skills:        opts.skills,
        episodeNumber: opts.episodeNumber,
        host:          opts.host,
        // logo + new variant fields
        logoData:         logoData ?? undefined,
        originalPrice:    opts.originalPrice,
        badge:            opts.badge,
        productCategory:  opts.productCategory,
        stockCount:       opts.stockCount,
        propertyPrice:    opts.propertyPrice,
        bedrooms:         opts.bedrooms,
        bathrooms:        opts.bathrooms,
        sqft:             opts.sqft,
        agentName:        opts.agentName,
        propertyAddress:  opts.propertyAddress,
        beforeStat:       opts.beforeStat,
        afterStat:        opts.afterStat,
        duration:         opts.duration,
        classTime:        opts.classTime,
        classDuration:    opts.classDuration,
        instructor:       opts.instructor,
        classType:        opts.classType,
        courseName:       opts.courseName,
        courseLevel:      opts.courseLevel,
        lessonCount:      opts.lessonCount,
        studentCount:     opts.studentCount,
        certificateName:  opts.certificateName,
        recipientName:    opts.recipientName,
        completionDate:   opts.completionDate,
        ticker:           opts.ticker,
        priceChange:      opts.priceChange,
        positive:         opts.positive,
        interestRate:     opts.interestRate,
        rateType:         opts.rateType,
        chartData:        opts.chartData,
        dishName:         opts.dishName,
        dishPrice:        opts.dishPrice,
        dietaryTags:      opts.dietaryTags,
        prepTime:         opts.prepTime,
        calories:         opts.calories,
        changelogItems:   opts.changelogItems,
        version:          opts.version,
        waitlistCount:    opts.waitlistCount,
        launchDate:       opts.launchDate,
        featureIcon:      opts.featureIcon,
        // media
        spotifyTrack:     opts.spotifyTrack,
        spotifyArtist:    opts.spotifyArtist,
        spotifyProgress:  opts.spotifyProgress,
        streamViewers:    opts.streamViewers,
        releaseDate:      opts.releaseDate,
        genre:            opts.genre,
        gameTitle:        opts.gameTitle,
        listens:          opts.listens,
        trackCount:       opts.trackCount,
        podcastEpisodes:  opts.podcastEpisodes,
        podcastListeners: opts.podcastListeners,
        // social/tech
        tweetText:        opts.tweetText,
        tweetHandle:      opts.tweetHandle,
        tweetLikes:       opts.tweetLikes,
        tweetRetweets:    opts.tweetRetweets,
        githubRepo:       opts.githubRepo,
        githubStars:      opts.githubStars,
        githubForks:      opts.githubForks,
        packageName:      opts.packageName,
        packageVersion:   opts.packageVersion,
        packageDownloads: opts.packageDownloads,
        statusItems:      opts.statusItems,
        codeLanguage:     opts.codeLanguage,
        codeLines:        opts.codeLines,
        uptime:           opts.uptime,
        releaseVersion:   opts.releaseVersion,
        releaseChanges:   opts.releaseChanges,
        upvotes:          opts.upvotes,
        comments:         opts.comments,
        subreddit:        opts.subreddit,
        // business/sports/gaming
        teamA:            opts.teamA,
        teamB:            opts.teamB,
        scoreA:           opts.scoreA,
        scoreB:           opts.scoreB,
        matchStatus:      opts.matchStatus,
        leaderboardItems: opts.leaderboardItems,
        invoiceNumber:    opts.invoiceNumber,
        invoiceAmount:    opts.invoiceAmount,
        invoiceDue:       opts.invoiceDue,
        achievement:      opts.achievement,
        xpGained:         opts.xpGained,
        playerSport:      opts.playerSport,
        playerPosition:   opts.playerPosition,
        playerStats:      opts.playerStats,
        matchDate:        opts.matchDate,
        matchVenue:       opts.matchVenue,
        phone:            opts.phone,
        email:            opts.email,
        website:          opts.website,
        proposalClient:   opts.proposalClient,
        proposalValue:    opts.proposalValue,
        proposalDue:      opts.proposalDue,
        // content/reviews
        issueNumber:      opts.issueNumber,
        author:           opts.author,
        isbn:             opts.isbn,
        readTime:         opts.readTime,
        category:         opts.category,
        publishDate:      opts.publishDate,
        reviewCount:      opts.reviewCount,
        reviewPlatform:   opts.reviewPlatform,
        npsScore:         opts.npsScore,
        promoters:        opts.promoters,
        detractors:       opts.detractors,
        giftAmount:       opts.giftAmount,
        giftFrom:         opts.giftFrom,
        loyaltyPoints:    opts.loyaltyPoints,
        loyaltyTier:      opts.loyaltyTier,
        caseStudyResult:  opts.caseStudyResult,
        caseStudyClient:  opts.caseStudyClient,
        // lifestyle/health/finance
        referralBonus:    opts.referralBonus,
        alcoholContent:   opts.alcoholContent,
        servings:         opts.servings,
        exercises:        opts.exercises,
        habitItems:       opts.habitItems,
        cryptoSymbol:     opts.cryptoSymbol,
        cryptoPrice:      opts.cryptoPrice,
        marketCap:        opts.marketCap,
        portfolioValue:   opts.portfolioValue,
        portfolioChange:  opts.portfolioChange,
        savingsGoal:      opts.savingsGoal,
        savedAmount:      opts.savedAmount,
        savingsProgress:  opts.savingsProgress,
        steps:            opts.steps,
        heartRate:        opts.heartRate,
        sleepHours:       opts.sleepHours,
        appointmentType:  opts.appointmentType,
        appointmentTime:  opts.appointmentTime,
        providerName:     opts.providerName,
        destination:      opts.destination,
        travelDuration:   opts.travelDuration,
        travelPrice:      opts.travelPrice,
        rsvpDeadline:     opts.rsvpDeadline,
        cocktailIngredients: opts.cocktailIngredients,
        // automotive
        vehicleMake:      opts.vehicleMake,
        vehicleModel:     opts.vehicleModel,
        vehicleYear:      opts.vehicleYear,
        vehicleMileage:   opts.vehicleMileage,
        vehicleEngine:    opts.vehicleEngine,
        vehicleColor:     opts.vehicleColor,
        vehicleFeatures:  opts.vehicleFeatures,
        vehicleCondition: opts.vehicleCondition,
        // fashion
        lookbookItems:    opts.lookbookItems,
        styleTag:         opts.styleTag,
        collection:       opts.collection,
        sizes:            opts.sizes,
        material:         opts.material,
        colorways:        opts.colorways,
        // web3/nft
        nftName:          opts.nftName,
        nftPrice:         opts.nftPrice,
        nftEdition:       opts.nftEdition,
        blockchain:       opts.blockchain,
        mintDate:         opts.mintDate,
        totalSupply:      opts.totalSupply,
        floorPrice:       opts.floorPrice,
        holderCount:      opts.holderCount,
        daoName:          opts.daoName,
        proposalId:       opts.proposalId,
        tokenSymbol:      opts.tokenSymbol,
        tokenPrice:       opts.tokenPrice,
        tokenChange:      opts.tokenChange,
        // nonprofit
        donationGoal:     opts.donationGoal,
        donationRaised:   opts.donationRaised,
        donationProgress: opts.donationProgress,
        donorCount:       opts.donorCount,
        impactStat:       opts.impactStat,
        impactLabel:      opts.impactLabel,
        causeTag:         opts.causeTag,
        volunteerCount:   opts.volunteerCount,
        // interior
        roomType:         opts.roomType,
        designStyle:      opts.designStyle,
        projectBudget:    opts.projectBudget,
        projectDuration:  opts.projectDuration,
        materials:        opts.materials,
        swatchColors:     opts.swatchColors,
        // hr/culture
        employeeName:     opts.employeeName,
        employeeYears:    opts.employeeYears,
        employeeDept:     opts.employeeDept,
        employeeQuote:    opts.employeeQuote,
        benefits:         opts.benefits,
        openRoles:        opts.openRoles,
        cultureStats:     opts.cultureStats,
      })

      const loadAdditionalAsset = async (languageCode: string, segment: string): Promise<string> => {
        if (languageCode !== 'emoji') return segment
        const codepoint = [...segment]
          .map(c => c.codePointAt(0)!)
          .filter(cp => cp !== 0xFE0F)
          .map(cp => cp.toString(16))
          .join('-')
        const emojiUrl = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codepoint}.png`
        const cached = this.imageCache.get(emojiUrl)
        if (cached) return cached
        try {
          const res = await fetch(emojiUrl)
          if (!res.ok) return segment
          const buf    = await res.arrayBuffer()
          const bytes  = new Uint8Array(buf)
          let binary   = ''
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
          const dataUri = `data:image/png;base64,${btoa(binary)}`
          this.imageCache.set(emojiUrl, dataUri)
          return dataUri
        } catch {
          return segment
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svg   = await satori(jsxTree, { width: w, height: h, fonts: fonts as any, loadAdditionalAsset })
      const resvg = await Resvg.async(svg, { fitTo: { mode: 'width', value: w } })
      const png   = resvg.render().asPng()

      let output: Uint8Array = png
      if (format === 'webp') {
        const photonImg = PhotonImage.new_from_byteslice(png)
        output = photonImg.get_bytes_webp()
        photonImg.free()
      }

      this.lru.set(cacheKey, output)
      this.ctx.storage.put(storageKey, output).catch(() => {})
      this.ctx.storage.put(`ts:${storageKey}`, Date.now()).catch(() => {})

      const ct = format === 'webp' ? 'image/webp' : 'image/png'
      return new Response(output, {
        headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400',
                   'X-Variant': variant, 'X-Cache': 'MISS' },
      })
    } catch (err) {
      console.error('[satori-do] Render failed:', err)
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    } finally {
      this.release()
    }
  }
}

// ── Carousel handler ──────────────────────────────────────────────────────────

async function handleCarousel(request: Request, env: Env): Promise<Response> {
  let body: { slides: CardOpts[]; format?: 'png' | 'webp' }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!Array.isArray(body?.slides) || body.slides.length === 0) {
    return new Response(JSON.stringify({ error: 'slides array required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (body.slides.length > 10) {
    return new Response(JSON.stringify({ error: 'max 10 slides per request' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const results = await Promise.all(body.slides.map(async (slide, index) => {
    let slideOpts = { ...slide, format: slide.format ?? body.format ?? 'png' }
    // Auto-source background image from Pexels if none provided for this slide
    slideOpts = await maybeAutoSourceBg(slideOpts, env) as typeof slideOpts
    const bodyText  = JSON.stringify(slideOpts)
    const brandName = slide.brandName ?? ''
    const shard     = murmurHash32(brandName) % SHARD_COUNT
    try {
      const res = await callDO(env.SATORI_DO, shard, new Request('https://internal/', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    bodyText,
      }))
      if (!res.ok) {
        const errText = await res.text()
        return { index, error: errText }
      }
      const buf    = await res.arrayBuffer()
      const bytes  = new Uint8Array(buf)
      let binary   = ''
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const fmt      = slideOpts.format ?? 'png'
      const mimeType = fmt === 'webp' ? 'image/webp' : 'image/png'
      return { index, image: `data:${mimeType};base64,${btoa(binary)}` }
    } catch (e) {
      return { index, error: String(e) }
    }
  }))

  return new Response(JSON.stringify({ slides: results, count: results.length }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

// ── RateLimiterDO — per-key sliding-window rate limiter ───────────────────────

export class RateLimiterDO extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url    = new URL(request.url)
    const limit  = parseInt(url.searchParams.get('limit')  ?? '60')
    const window = parseInt(url.searchParams.get('window') ?? '60')  // seconds
    const now      = Date.now()
    const windowMs = window * 1000
    const windowStart = Math.floor(now / windowMs) * windowMs

    const key  = `cnt:${windowStart}`
    let count: number = (await this.ctx.storage.get<number>(key)) ?? 0

    if (count >= limit) {
      const resetAt = windowStart + windowMs
      return new Response(JSON.stringify({
        allowed: false, remaining: 0, resetAt,
        retryAfter: Math.ceil((resetAt - now) / 1000),
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    count++
    this.ctx.storage.put(key, count).catch(() => {})

    // Async cleanup of expired windows
    this.ctx.storage.list<number>({ prefix: 'cnt:' }).then(entries => {
      for (const [k] of entries) {
        if (parseInt(k.slice(4)) < windowStart - windowMs)
          this.ctx.storage.delete(k).catch(() => {})
      }
    }).catch(() => {})

    return new Response(JSON.stringify({
      allowed: true,
      remaining: limit - count,
      resetAt: windowStart + windowMs,
    }), { headers: { 'Content-Type': 'application/json' } })
  }
}

// ── Stateless Worker shell ────────────────────────────────────────────────────

const SHARD_COUNT = 4

/**
 * Call a SATORI_DO shard, retrying automatically when the DO responds with
 * "The Durable Object's code has been updated" — this fires transiently for
 * ~30 s after a wrangler deploy while old instances drain.  A fresh stub
 * always resolves to the new code version, so we just need to wait briefly
 * and retry.
 */
async function callDO(
  ns:      DurableObjectNamespace,
  shard:   number,
  req:     Request,
  maxRetries = 2,
): Promise<Response> {
  let attempt = 0
  while (true) {
    const stub = ns.get(ns.idFromName(`shard-${shard}`))
    try {
      return await stub.fetch(req.clone())
    } catch (err: unknown) {
      if (attempt < maxRetries && err instanceof TypeError) {
        // Full-jitter exponential backoff: random in [0, base * 2^attempt].
        // Prevents thundering herd when many requests retry the same DO shard
        // simultaneously during a post-deploy drain window.
        const base = 200 * 2 ** attempt
        await new Promise(r => setTimeout(r, Math.random() * base))
        attempt++
        continue
      }
      throw err
    }
  }
}

const WARM_PAYLOAD = JSON.stringify({
  variant: 'editorial-hero', headline: 'warm', brandName: 'warm',
  primaryColor: '#000000', width: 60, height: 32,
})

// ── Auth middleware ───────────────────────────────────────────────────────────

// ── Custom template helpers ───────────────────────────────────────────────────

/**
 * Recursively walk a SatoriNode tree and replace `{{token}}` placeholders
 * in every string value (text nodes, style values, src attributes).
 */
function substituteTokens(node: SatoriNode | string, values: Record<string, string>): SatoriNode | string {
  if (typeof node === 'string') {
    return node.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in values ? values[k] : `{{${k}}}`))
  }
  const substitute = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in values ? values[k] : `{{${k}}}`))
    if (Array.isArray(v)) return v.map(substitute)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = substitute(val)
      return out
    }
    return v
  }
  return substitute(node) as SatoriNode
}

/**
 * Scan a SatoriNode tree and return all unique `{{token}}` references found.
 */
function collectTokenRefs(node: SatoriNode | string | undefined | null): Set<string> {
  const refs = new Set<string>()
  const RE = /\{\{(\w+)\}\}/g
  const scan = (v: unknown) => {
    if (typeof v === 'string') { let m; while ((m = RE.exec(v)) !== null) refs.add(m[1]); RE.lastIndex = 0 }
    else if (Array.isArray(v)) v.forEach(scan)
    else if (v && typeof v === 'object') Object.values(v as object).forEach(scan)
  }
  scan(node)
  return refs
}

/**
 * Fetch a remote URL and return it as a base64 data URI.
 * Used for `{{image}}` tokens so Satori can render them without CORS issues.
 */
async function fetchImageAsDataUri(url: string): Promise<string> {
  const res = await fetch(url, { cf: { cacheTtl: 86400 } } as RequestInit)
  if (!res.ok) throw new Error(`fetchImageAsDataUri: ${res.status} ${url}`)
  const ct    = res.headers.get('Content-Type') ?? 'image/jpeg'
  const bytes = new Uint8Array(await res.arrayBuffer())
  const b64   = btoa(String.fromCharCode(...bytes))
  return `data:${ct};base64,${b64}`
}

interface AuthContext { keyId: string; limit: number }

/**
 * Validate X-API-Key header and enforce rate limit.
 * Returns `null` (allow) when API_KEYS KV is not configured — dev mode.
 * Returns `AuthContext` on success or a `Response` (401/429) on failure.
 */
async function checkAuth(request: Request, env: Env): Promise<AuthContext | null | Response> {
  if (!env.API_KEYS) return null  // KV not bound → open access (dev mode)

  const apiKey = request.headers.get('X-API-Key')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'X-API-Key header required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const stored = await env.API_KEYS.get(apiKey, { type: 'json' }) as AuthContext | null
  if (!stored) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Rate limit check
  if (env.RATE_LIMITER) {
    const stub  = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(stored.keyId))
    const rlRes = await stub.fetch(new Request(`https://internal/?limit=${stored.limit}&window=60`))
    const rl    = await rlRes.json<{ allowed: boolean; remaining: number; resetAt: number }>()
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded', resetAt: rl.resetAt }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rl.resetAt),
          'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      })
    }
  }

  return stored
}

// ── R2 CDN helpers ────────────────────────────────────────────────────────────

/** Store rendered bytes in R2 and return the asset key (or null if R2 not bound). */
async function storeToR2(
  env:         Env,
  cacheKey:    string,
  bytes:       Uint8Array,
  contentType: string,
): Promise<string | null> {
  if (!env.RENDER_CACHE) return null
  const hash = await sha256Hex(cacheKey)
  const ext  = contentType === 'image/webp' ? 'webp'
             : contentType === 'image/gif'  ? 'gif'
             : 'png'
  const key  = `renders/${hash}.${ext}`
  try {
    await env.RENDER_CACHE.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { generatedAt: new Date().toISOString() },
    })
    return key
  } catch {
    return null
  }
}

/** Construct a stable CDN URL from a worker request and an R2 key. */
function cdnUrl(request: Request, key: string): string {
  const origin = new URL(request.url).origin
  return `${origin}/assets/${key}`
}

/** GET /assets/:key — serve from R2 CDN with long-lived cache. */
async function handleAssetGet(request: Request, env: Env): Promise<Response> {
  if (!env.RENDER_CACHE) {
    return new Response(JSON.stringify({ error: 'R2 storage not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }
  const key = new URL(request.url).pathname.slice('/assets/'.length)
  if (!key) return new Response('Not Found', { status: 404 })

  const obj = await env.RENDER_CACHE.get(key)
  if (!obj) return new Response('Not Found', { status: 404 })

  const ct = obj.httpMetadata?.contentType ?? 'image/png'
  return new Response(obj.body, {
    headers: {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=2592000',  // 30 days
      'ETag': obj.etag ?? '',
      'X-R2-Key': key,
    },
  })
}

// ── Custom template CRUD ──────────────────────────────────────────────────────

/** POST /templates — create or overwrite a custom template in R2. */
async function handleCreateTemplate(request: Request, env: Env, keyId: string): Promise<Response> {
  if (!env.RENDER_CACHE) {
    return new Response(JSON.stringify({ error: 'R2 storage not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { id?: string; name?: string; width?: number; height?: number; tokens?: Record<string, TemplateToken>; tree?: SatoriNode }
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!body.name || !body.width || !body.height || !body.tree) {
    return new Response(JSON.stringify({ error: 'name, width, height, tree required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const id = body.id ?? `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Auto-detect tokens from tree if none provided
  const detectedRefs = collectTokenRefs(body.tree)
  const tokens: Record<string, TemplateToken> = body.tokens ?? {}
  for (const ref of detectedRefs) {
    if (!(ref in tokens)) {
      // Heuristic: names ending in _img / _image / _photo → image type
      const t = /img|image|photo|logo|icon/.test(ref) ? 'image'
              : /color|colour|bg|background/.test(ref) ? 'color'
              : /size|width|height|radius|gap/.test(ref) ? 'number'
              : 'text'
      tokens[ref] = { type: t as TemplateToken['type'] }
    }
  }

  const tpl: StoredTemplate = {
    id, name: body.name, width: body.width, height: body.height,
    tokens, tree: body.tree,
    createdAt: new Date().toISOString(), keyId,
  }

  const r2Key = `templates/${keyId}/${id}.json`
  await env.RENDER_CACHE.put(r2Key, JSON.stringify(tpl), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { templateId: id, keyId },
  })

  return new Response(JSON.stringify({ id, name: tpl.name, width: tpl.width, height: tpl.height, tokens, createdAt: tpl.createdAt }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}

/** GET /templates — list all templates for this API key. */
async function handleListTemplates(env: Env, keyId: string): Promise<Response> {
  if (!env.RENDER_CACHE) {
    return new Response(JSON.stringify({ error: 'R2 storage not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }

  const prefix  = `templates/${keyId}/`
  const listing = await env.RENDER_CACHE.list({ prefix, limit: 200 })
  const items: { id: string; name: string; width: number; height: number; createdAt: string }[] = []

  for (const obj of listing.objects) {
    const meta = obj.customMetadata ?? {}
    // Fetch minimal data — just parse the stored JSON
    const stored = await env.RENDER_CACHE.get(obj.key)
    if (!stored) continue
    try {
      const tpl = await stored.json<StoredTemplate>()
      items.push({ id: tpl.id, name: tpl.name, width: tpl.width, height: tpl.height, createdAt: tpl.createdAt })
    } catch { /* skip corrupt entries */ }
  }

  return new Response(JSON.stringify({ templates: items, count: items.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/** GET /templates/:id — get a template schema (without rendering). */
async function handleGetTemplate(env: Env, keyId: string, id: string): Promise<Response> {
  if (!env.RENDER_CACHE) {
    return new Response(JSON.stringify({ error: 'R2 storage not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }

  const r2Key = `templates/${keyId}/${id}.json`
  const obj   = await env.RENDER_CACHE.get(r2Key)
  if (!obj) return new Response(JSON.stringify({ error: 'Template not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })

  try {
    const tpl = await obj.json<StoredTemplate>()
    return new Response(JSON.stringify(tpl), { headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ error: 'Corrupt template data' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

/** DELETE /templates/:id — permanently delete a template. */
async function handleDeleteTemplate(env: Env, keyId: string, id: string): Promise<Response> {
  if (!env.RENDER_CACHE) {
    return new Response(JSON.stringify({ error: 'R2 storage not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }

  const r2Key = `templates/${keyId}/${id}.json`
  const obj   = await env.RENDER_CACHE.get(r2Key)
  if (!obj) return new Response(JSON.stringify({ error: 'Template not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })

  await env.RENDER_CACHE.delete(r2Key)
  return new Response(JSON.stringify({ deleted: id }), { headers: { 'Content-Type': 'application/json' } })
}

/**
 * POST /render/:templateId — fetch template, substitute {{tokens}}, resolve images, render.
 *
 * Body: Record<string, string>  — token values to substitute.
 * Query params: ?format=png|webp, ?store=1 (save to R2 CDN).
 */
async function handleCustomRender(request: Request, env: Env, keyId: string, templateId: string): Promise<Response> {
  if (!env.RENDER_CACHE) {
    return new Response(JSON.stringify({ error: 'R2 storage not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Load template
  const r2Key  = `templates/${keyId}/${templateId}.json`
  const r2Obj  = await env.RENDER_CACHE.get(r2Key)
  if (!r2Obj) {
    return new Response(JSON.stringify({ error: 'Template not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  let tpl: StoredTemplate
  try { tpl = await r2Obj.json<StoredTemplate>() } catch {
    return new Response(JSON.stringify({ error: 'Corrupt template data' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  // Parse token values from request body
  let values: Record<string, string> = {}
  try { values = await request.json() } catch { /* empty body → use defaults */ }

  // Fill in defaults for missing tokens
  for (const [k, def] of Object.entries(tpl.tokens)) {
    if (!(k in values) && def.default !== undefined) {
      values[k] = String(def.default)
    }
  }

  // Resolve image tokens: URL → base64 data URI (so Satori can render them)
  const imageTokens = Object.entries(tpl.tokens)
    .filter(([, v]) => v.type === 'image')
    .map(([k]) => k)

  await Promise.all(imageTokens.map(async (k) => {
    if (values[k] && values[k].startsWith('http')) {
      try { values[k] = await fetchImageAsDataUri(values[k]) } catch { /* keep original URL */ }
    }
  }))

  // Substitute all tokens into the tree
  const hydratedTree = substituteTokens(tpl.tree, values) as SatoriNode

  // Dispatch to a SatoriDO shard for rendering
  const url    = new URL(request.url)
  const fmt    = (url.searchParams.get('format') ?? 'png') as 'png' | 'webp'
  const shard  = Math.floor(Math.random() * SHARD_COUNT)
  const doRes = await callDO(env.SATORI_DO, shard, new Request('https://internal/render-tree', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ tree: hydratedTree, width: tpl.width, height: tpl.height, format: fmt }),
  }))

  if (!doRes.ok) {
    const err = await doRes.text()
    return new Response(JSON.stringify({ error: 'Render failed', detail: err }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const bytes = new Uint8Array(await doRes.arrayBuffer())
  const ct    = fmt === 'webp' ? 'image/webp' : 'image/png'

  // Optionally store to R2 CDN
  const store = url.searchParams.get('store') === '1'
  let cdnKey  = ''
  if (store && env.RENDER_CACHE) {
    const hash = await sha256Hex(`custom:${keyId}:${templateId}:${JSON.stringify(values)}`)
    const ext  = fmt === 'webp' ? 'webp' : 'png'
    cdnKey     = `renders/${hash}.${ext}`
    await env.RENDER_CACHE.put(cdnKey, bytes, {
      httpMetadata:  { contentType: ct },
      customMetadata: { templateId, keyId, generatedAt: new Date().toISOString() },
    }).catch(() => {})
  }

  const headers = new Headers({
    'Content-Type':  ct,
    'Cache-Control': 'public, max-age=86400',
    'X-Template-Id': templateId,
  })
  if (cdnKey) {
    headers.set('X-CDN-URL', `${url.origin}/assets/${cdnKey}`)
    headers.set('X-R2-Key', cdnKey)
  }
  return new Response(bytes, { headers })
}

// ── Brand kit validation ──────────────────────────────────────────────────────

function validateBrandKit(opts: Partial<CardOpts>): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!opts.headline)     errors.push('headline is required')
  if (!opts.brandName)    errors.push('brandName is required')
  if (!opts.primaryColor && !opts.brandUrl) errors.push('primaryColor or brandUrl is required')
  if (opts.primaryColor && !/^#[0-9a-fA-F]{6}$/.test(opts.primaryColor))
    errors.push(`primaryColor must be a 6-digit hex color (got "${opts.primaryColor}")`)
  if (opts.ctaColor && !/^#[0-9a-fA-F]{6}$/.test(opts.ctaColor))
    errors.push(`ctaColor must be a 6-digit hex color (got "${opts.ctaColor}")`)
  if (opts.width  && (opts.width  < 50 || opts.width  > 5000)) errors.push('width must be 50–5000')
  if (opts.height && (opts.height < 50 || opts.height > 5000)) errors.push('height must be 50–5000')
  if (opts.format && !['png', 'webp'].includes(opts.format))   errors.push('format must be png or webp')
  return { valid: errors.length === 0, errors }
}

// ── Discovery endpoints ───────────────────────────────────────────────────────

function handleListVariants(): Response {
  const variants: Record<string, { description: string; vertical: string; fields: string[] }> = {
    'editorial-hero':    { description: 'Full-bleed editorial with large headline', vertical: 'general', fields: ['headline', 'subheadline', 'bgImageUrl'] },
    'stat-hero':         { description: 'Large stat/metric hero card', vertical: 'general', fields: ['headline', 'stat', 'subheadline'] },
    'feature-split':     { description: 'Two-column feature split', vertical: 'general', fields: ['headline', 'subheadline', 'bgImageUrl'] },
    'announcement':      { description: 'Bold centered announcement', vertical: 'general', fields: ['headline', 'subheadline'] },
    'quote-overlay':     { description: 'Quote with photo overlay', vertical: 'general', fields: ['headline', 'reviewerName', 'bgImageUrl'] },
    'benefit-strip':     { description: 'Horizontal benefit strip banner', vertical: 'general', fields: ['headline', 'subheadline', 'stat'] },
    'recipe-hero':       { description: 'Food/recipe hero card', vertical: 'food', fields: ['headline', 'subheadline', 'bgImageUrl', 'stat'] },
    'tip-card':          { description: 'Tip/advice card', vertical: 'general', fields: ['headline', 'subheadline', 'stat'] },
    'product-showcase':  { description: 'Product showcase with price and CTA', vertical: 'ecommerce', fields: ['headline', 'price', 'ctaText', 'bgImageUrl'] },
    'coupon-offer':      { description: 'Coupon code offer card', vertical: 'ecommerce', fields: ['headline', 'couponCode', 'expiryText'] },
    'testimonial':       { description: 'Customer testimonial with rating', vertical: 'general', fields: ['reviewText', 'reviewerName', 'reviewerTitle', 'rating'] },
    'event-card':        { description: 'Event announcement card', vertical: 'events', fields: ['headline', 'eventDate', 'eventTime', 'eventLocation'] },
    'video-thumbnail':   { description: 'YouTube/video thumbnail', vertical: 'media', fields: ['headline', 'subheadline', 'bgImageUrl'] },
    'before-after':      { description: 'Before/after comparison', vertical: 'fitness', fields: ['headline', 'beforeText', 'afterText', 'beforeLabel', 'afterLabel'] },
    'pricing-card':      { description: 'Multi-tier pricing card', vertical: 'saas', fields: ['headline', 'plans'] },
    'social-proof':      { description: 'Social proof with logo grid', vertical: 'saas', fields: ['headline', 'logos', 'tagline', 'stat'] },
    'countdown-timer':   { description: 'Countdown timer with urgency', vertical: 'ecommerce', fields: ['headline', 'timerDays', 'timerHours', 'timerMins', 'timerSecs', 'ctaText'] },
    'app-screenshot':    { description: 'Mobile app screenshot card', vertical: 'saas', fields: ['headline', 'subheadline', 'appRating', 'appDownloads', 'ctaText'] },
    'job-posting':       { description: 'Job posting/hiring card', vertical: 'hr', fields: ['headline', 'jobTitle', 'location', 'jobType', 'salary', 'skills'] },
    'podcast-cover':     { description: 'Podcast episode cover', vertical: 'media', fields: ['headline', 'episodeNumber', 'host', 'bgImageUrl'] },
    'product-shot':      { description: 'E-commerce product shot with price', vertical: 'ecommerce', fields: ['headline', 'price', 'originalPrice', 'badge', 'productCategory', 'bgImageUrl'] },
    'price-drop':        { description: 'Price drop announcement', vertical: 'ecommerce', fields: ['headline', 'price', 'originalPrice', 'badge', 'expiryText'] },
    'new-arrival':       { description: 'New product arrival reveal', vertical: 'ecommerce', fields: ['headline', 'subheadline', 'price', 'productCategory', 'ctaText', 'bgImageUrl'] },
    'flash-deal':        { description: 'Flash sale with countdown', vertical: 'ecommerce', fields: ['headline', 'badge', 'price', 'originalPrice', 'timerHours', 'timerMins', 'ctaText'] },
    'property-listing':  { description: 'Real estate property listing', vertical: 'realestate', fields: ['headline', 'propertyPrice', 'bedrooms', 'bathrooms', 'sqft', 'propertyAddress', 'bgImageUrl'] },
    'open-house':        { description: 'Open house event card', vertical: 'realestate', fields: ['headline', 'propertyPrice', 'bedrooms', 'bathrooms', 'sqft', 'propertyAddress', 'eventDate', 'eventTime', 'bgImageUrl'] },
    'sold-announcement': { description: 'Property sold announcement', vertical: 'realestate', fields: ['headline', 'propertyPrice', 'propertyAddress', 'bgImageUrl'] },
    'feature-launch':    { description: 'SaaS feature launch card', vertical: 'saas', fields: ['headline', 'subheadline', 'version', 'featureIcon', 'ctaText', 'bgImageUrl'] },
    'changelog':         { description: 'Product changelog card', vertical: 'saas', fields: ['headline', 'version', 'changelogItems', 'eventDate'] },
    'waitlist-signup':   { description: 'Product waitlist signup card', vertical: 'saas', fields: ['headline', 'subheadline', 'waitlistCount', 'launchDate', 'ctaText'] },
    'transformation':    { description: 'Fitness transformation before/after', vertical: 'fitness', fields: ['headline', 'beforeStat', 'afterStat', 'duration', 'bgImageUrl'] },
    'class-schedule':    { description: 'Fitness class schedule card', vertical: 'fitness', fields: ['headline', 'classType', 'classTime', 'classDuration', 'instructor', 'ctaText', 'bgImageUrl'] },
    'menu-special':      { description: "Restaurant menu special", vertical: 'food', fields: ['headline', 'dishName', 'dishPrice', 'dietaryTags', 'prepTime', 'calories', 'bgImageUrl'] },
    'course-launch':     { description: 'Online course launch card', vertical: 'education', fields: ['headline', 'courseName', 'courseLevel', 'lessonCount', 'studentCount', 'price', 'ctaText', 'bgImageUrl'] },
    'certification':     { description: 'Course completion certificate', vertical: 'education', fields: ['headline', 'certificateName', 'recipientName', 'completionDate'] },
    'market-update':     { description: 'Financial market update card', vertical: 'finance', fields: ['headline', 'ticker', 'price', 'priceChange', 'positive', 'chartData'] },
    'rate-announcement': { description: 'Interest rate announcement', vertical: 'finance', fields: ['headline', 'interestRate', 'rateType', 'subheadline', 'ctaText'] },
    // Media/Entertainment
    'spotify-now-playing': { description: 'Spotify now-playing card', vertical: 'media', fields: ['headline', 'spotifyTrack', 'spotifyArtist', 'spotifyProgress', 'bgImageUrl'] },
    'album-art':         { description: 'Music album art card', vertical: 'media', fields: ['headline', 'spotifyArtist', 'releaseDate', 'genre', 'trackCount', 'bgImageUrl'] },
    'movie-poster':      { description: 'Movie/show poster card', vertical: 'media', fields: ['headline', 'subheadline', 'releaseDate', 'genre', 'bgImageUrl'] },
    'music-release':     { description: 'New music release announcement', vertical: 'media', fields: ['headline', 'spotifyArtist', 'releaseDate', 'genre', 'ctaText', 'bgImageUrl'] },
    'twitch-banner':     { description: 'Twitch live stream banner', vertical: 'media', fields: ['headline', 'streamViewers', 'gameTitle', 'bgImageUrl'] },
    'youtube-stats':     { description: 'YouTube channel stats card', vertical: 'media', fields: ['headline', 'stat', 'subheadline', 'bgImageUrl'] },
    'soundcloud-track':  { description: 'SoundCloud track card', vertical: 'media', fields: ['headline', 'spotifyArtist', 'genre', 'listens', 'bgImageUrl'] },
    'live-stream-alert': { description: 'Live stream going-live alert', vertical: 'media', fields: ['headline', 'streamViewers', 'gameTitle', 'bgImageUrl'] },
    'podcast-stats':     { description: 'Podcast stats overview card', vertical: 'media', fields: ['headline', 'podcastEpisodes', 'podcastListeners', 'bgImageUrl'] },
    // Social/Tech/Developer
    'tweet-card':        { description: 'Twitter/X tweet screenshot card', vertical: 'social', fields: ['tweetText', 'tweetHandle', 'tweetLikes', 'tweetRetweets'] },
    'linkedin-article':  { description: 'LinkedIn article preview card', vertical: 'social', fields: ['headline', 'subheadline', 'author', 'readTime', 'bgImageUrl'] },
    'product-hunt':      { description: 'Product Hunt launch card', vertical: 'saas', fields: ['headline', 'subheadline', 'upvotes', 'bgImageUrl'] },
    'reddit-post':       { description: 'Reddit post card', vertical: 'social', fields: ['headline', 'upvotes', 'comments', 'subreddit'] },
    'instagram-quote':   { description: 'Instagram quote card', vertical: 'social', fields: ['headline', 'subheadline', 'bgImageUrl'] },
    'tiktok-caption':    { description: 'TikTok video caption card', vertical: 'social', fields: ['headline', 'subheadline', 'bgImageUrl'] },
    'discord-announcement': { description: 'Discord server announcement card', vertical: 'social', fields: ['headline', 'subheadline', 'bgImageUrl'] },
    'github-stats':      { description: 'GitHub repository stats card', vertical: 'tech', fields: ['headline', 'githubRepo', 'githubStars', 'githubForks', 'subheadline'] },
    'npm-package':       { description: 'npm package info card', vertical: 'tech', fields: ['packageName', 'packageVersion', 'packageDownloads', 'subheadline'] },
    'api-status':        { description: 'API status page card', vertical: 'tech', fields: ['headline', 'uptime', 'statusItems'] },
    'code-snippet':      { description: 'Code snippet showcase card', vertical: 'tech', fields: ['headline', 'codeLanguage', 'codeLines'] },
    'status-page':       { description: 'Service status page overview', vertical: 'tech', fields: ['headline', 'uptime', 'statusItems'] },
    'release-notes':     { description: 'Software release notes card', vertical: 'tech', fields: ['headline', 'releaseVersion', 'releaseChanges'] },
    // Business/Sports/Gaming
    'receipt-card':      { description: 'Purchase receipt card', vertical: 'ecommerce', fields: ['headline', 'invoiceNumber', 'invoiceAmount', 'subheadline'] },
    'business-card':     { description: 'Digital business card', vertical: 'business', fields: ['headline', 'subheadline', 'phone', 'email', 'website', 'logoUrl'] },
    'qr-code-card':      { description: 'QR code sharing card', vertical: 'business', fields: ['headline', 'subheadline', 'website'] },
    'team-member':       { description: 'Team member profile card', vertical: 'business', fields: ['headline', 'subheadline', 'bgImageUrl', 'logoUrl'] },
    'org-announcement':  { description: 'Company/org announcement card', vertical: 'business', fields: ['headline', 'subheadline', 'bgImageUrl', 'logoUrl'] },
    'invoice-summary':   { description: 'Invoice summary card', vertical: 'business', fields: ['headline', 'invoiceNumber', 'invoiceAmount', 'invoiceDue'] },
    'proposal-cover':    { description: 'Business proposal cover card', vertical: 'business', fields: ['headline', 'proposalClient', 'proposalValue', 'proposalDue', 'bgImageUrl'] },
    'sports-score':      { description: 'Sports live score card', vertical: 'sports', fields: ['teamA', 'teamB', 'scoreA', 'scoreB', 'matchStatus', 'bgImageUrl'] },
    'sports-player':     { description: 'Sports player stats card', vertical: 'sports', fields: ['headline', 'playerSport', 'playerPosition', 'playerStats', 'bgImageUrl'] },
    'sports-schedule':   { description: 'Sports match schedule card', vertical: 'sports', fields: ['teamA', 'teamB', 'matchDate', 'matchVenue', 'bgImageUrl'] },
    'leaderboard-card':  { description: 'Leaderboard rankings card', vertical: 'gaming', fields: ['headline', 'leaderboardItems'] },
    'gaming-achievement': { description: 'Gaming achievement unlock card', vertical: 'gaming', fields: ['headline', 'achievement', 'xpGained', 'bgImageUrl'] },
    'esports-match':     { description: 'Esports match announcement card', vertical: 'gaming', fields: ['teamA', 'teamB', 'matchDate', 'matchVenue', 'bgImageUrl'] },
    'award-badge':       { description: 'Award or recognition badge card', vertical: 'business', fields: ['headline', 'subheadline', 'recipientName', 'completionDate'] },
    'trust-badge':       { description: 'Trust/certification badge card', vertical: 'business', fields: ['headline', 'subheadline', 'stat'] },
    // Content/Publishing/Reviews
    'newsletter-header': { description: 'Email newsletter header card', vertical: 'content', fields: ['headline', 'subheadline', 'issueNumber', 'publishDate', 'bgImageUrl'] },
    'book-cover':        { description: 'Book cover card', vertical: 'content', fields: ['headline', 'author', 'subheadline', 'bgImageUrl'] },
    'magazine-cover':    { description: 'Magazine cover card', vertical: 'content', fields: ['headline', 'subheadline', 'issueNumber', 'publishDate', 'bgImageUrl'] },
    'blog-post-card':    { description: 'Blog post preview card', vertical: 'content', fields: ['headline', 'subheadline', 'author', 'readTime', 'category', 'bgImageUrl'] },
    'infographic-stat':  { description: 'Single large stat infographic card', vertical: 'content', fields: ['headline', 'stat', 'subheadline'] },
    'press-release':     { description: 'Press release header card', vertical: 'content', fields: ['headline', 'subheadline', 'publishDate', 'bgImageUrl'] },
    'google-review':     { description: 'Google review showcase card', vertical: 'reviews', fields: ['reviewText', 'reviewerName', 'reviewerTitle', 'rating', 'reviewPlatform'] },
    'star-rating':       { description: 'Star rating summary card', vertical: 'reviews', fields: ['headline', 'rating', 'reviewCount', 'subheadline'] },
    'nps-score':         { description: 'NPS score card', vertical: 'reviews', fields: ['headline', 'npsScore', 'promoters', 'detractors'] },
    'case-study':        { description: 'Case study result card', vertical: 'content', fields: ['headline', 'caseStudyClient', 'caseStudyResult', 'subheadline', 'bgImageUrl'] },
    'gift-card':         { description: 'Digital gift card', vertical: 'ecommerce', fields: ['headline', 'giftAmount', 'giftFrom', 'subheadline'] },
    'loyalty-card':      { description: 'Loyalty program card', vertical: 'ecommerce', fields: ['headline', 'loyaltyPoints', 'loyaltyTier', 'subheadline'] },
    // Lifestyle/Health/Events/Finance
    'referral-card':     { description: 'Referral program card', vertical: 'marketing', fields: ['headline', 'referralBonus', 'subheadline', 'ctaText'] },
    'nutrition-facts':   { description: 'Nutrition facts label card', vertical: 'food', fields: ['headline', 'calories', 'subheadline'] },
    'cocktail-recipe':   { description: 'Cocktail recipe card', vertical: 'food', fields: ['headline', 'cocktailIngredients', 'alcoholContent', 'servings', 'bgImageUrl'] },
    'workout-plan':      { description: 'Workout plan card', vertical: 'fitness', fields: ['headline', 'exercises', 'duration', 'bgImageUrl'] },
    'travel-destination': { description: 'Travel destination card', vertical: 'travel', fields: ['headline', 'destination', 'travelDuration', 'travelPrice', 'bgImageUrl'] },
    'birthday-card':     { description: 'Birthday celebration card', vertical: 'events', fields: ['headline', 'subheadline', 'bgImageUrl'] },
    'wedding-card':      { description: 'Wedding invitation/save-the-date card', vertical: 'events', fields: ['headline', 'subheadline', 'eventDate', 'eventLocation', 'bgImageUrl'] },
    'holiday-greeting':  { description: 'Holiday greeting card', vertical: 'events', fields: ['headline', 'subheadline', 'bgImageUrl'] },
    'rsvp-card':         { description: 'Event RSVP card', vertical: 'events', fields: ['headline', 'eventDate', 'eventLocation', 'rsvpDeadline', 'ctaText', 'bgImageUrl'] },
    'crypto-price':      { description: 'Cryptocurrency price card', vertical: 'finance', fields: ['cryptoSymbol', 'cryptoPrice', 'priceChange', 'marketCap', 'chartData'] },
    'portfolio-snapshot': { description: 'Investment portfolio snapshot card', vertical: 'finance', fields: ['headline', 'portfolioValue', 'portfolioChange', 'chartData'] },
    'savings-goal':      { description: 'Savings goal progress card', vertical: 'finance', fields: ['headline', 'savingsGoal', 'savedAmount', 'savingsProgress'] },
    'appointment-card':  { description: 'Appointment reminder card', vertical: 'health', fields: ['headline', 'appointmentType', 'appointmentTime', 'providerName'] },
    'health-metrics':    { description: 'Daily health metrics card', vertical: 'health', fields: ['headline', 'steps', 'heartRate', 'sleepHours'] },
    'habit-tracker':     { description: 'Daily habit tracker card', vertical: 'health', fields: ['headline', 'habitItems'] },
    // Automotive
    'car-listing':       { description: 'Vehicle listing card with specs and CTA', vertical: 'automotive', fields: ['vehicleMake', 'vehicleModel', 'vehicleYear', 'price', 'vehicleMileage', 'vehicleEngine', 'vehicleFeatures', 'vehicleCondition', 'bgImageUrl'] },
    'vehicle-specs':     { description: 'Technical vehicle spec card', vertical: 'automotive', fields: ['vehicleMake', 'vehicleModel', 'vehicleYear', 'vehicleEngine', 'vehicleMileage', 'vehicleColor', 'bgImageUrl'] },
    'dealership-ad':     { description: 'Bold dealership promotional ad', vertical: 'automotive', fields: ['headline', 'stat', 'subheadline', 'ctaText', 'expiryText', 'bgImageUrl'] },
    'test-drive-cta':    { description: 'Test drive booking card', vertical: 'automotive', fields: ['vehicleModel', 'eventDate', 'eventTime', 'eventLocation', 'ctaText', 'bgImageUrl'] },
    // Fashion
    'lookbook-card':     { description: 'Editorial fashion lookbook card', vertical: 'fashion', fields: ['headline', 'collection', 'styleTag', 'price', 'ctaText', 'bgImageUrl'] },
    'ootd-card':         { description: 'Outfit of the Day card with item list', vertical: 'fashion', fields: ['headline', 'lookbookItems', 'styleTag', 'bgImageUrl'] },
    'style-drop':        { description: 'Hype streetwear drop announcement', vertical: 'fashion', fields: ['collection', 'badge', 'releaseDate', 'subheadline', 'ctaText', 'bgImageUrl'] },
    'fashion-sale':      { description: 'Fashion sale card with price and sizes', vertical: 'fashion', fields: ['headline', 'badge', 'originalPrice', 'price', 'sizes', 'collection', 'ctaText', 'bgImageUrl'] },
    // Web3/NFT
    'nft-showcase':      { description: 'NFT showcase card with stats', vertical: 'web3', fields: ['nftName', 'nftPrice', 'nftEdition', 'blockchain', 'floorPrice', 'holderCount', 'bgImageUrl'] },
    'mint-announcement': { description: 'NFT mint launch announcement', vertical: 'web3', fields: ['nftName', 'nftPrice', 'mintDate', 'totalSupply', 'ctaText'] },
    'dao-proposal':      { description: 'DAO governance proposal card', vertical: 'web3', fields: ['headline', 'proposalId', 'daoName', 'subheadline', 'stat', 'eventDate', 'ctaText'] },
    'token-launch':      { description: 'Token/coin launch card with price', vertical: 'web3', fields: ['tokenSymbol', 'headline', 'tokenPrice', 'tokenChange', 'totalSupply', 'blockchain', 'ctaText'] },
    'web3-stats':        { description: 'NFT collection stats dashboard card', vertical: 'web3', fields: ['nftName', 'floorPrice', 'stat', 'holderCount', 'totalSupply', 'tokenChange'] },
    // Non-profit
    'donation-progress': { description: 'Fundraising progress card with progress bar', vertical: 'nonprofit', fields: ['headline', 'donationGoal', 'donationRaised', 'donationProgress', 'donorCount', 'causeTag', 'ctaText'] },
    'impact-stats':      { description: 'Org impact report card', vertical: 'nonprofit', fields: ['headline', 'impactStat', 'impactLabel', 'donorCount', 'volunteerCount', 'causeTag'] },
    'charity-appeal':    { description: 'Emotional charity appeal card', vertical: 'nonprofit', fields: ['headline', 'subheadline', 'causeTag', 'plans', 'ctaText', 'bgImageUrl'] },
    'volunteer-cta':     { description: 'Volunteer recruitment card', vertical: 'nonprofit', fields: ['headline', 'subheadline', 'volunteerCount', 'classDuration', 'eventLocation', 'ctaText'] },
    // Interior Design
    'room-reveal':       { description: 'Before/after room reveal card', vertical: 'interior', fields: ['headline', 'roomType', 'bgImageUrl'] },
    'project-showcase':  { description: 'Interior design portfolio card', vertical: 'interior', fields: ['headline', 'designStyle', 'projectBudget', 'projectDuration', 'ctaText', 'bgImageUrl'] },
    'material-moodboard':{ description: 'Material palette and moodboard card', vertical: 'interior', fields: ['headline', 'collection', 'designStyle', 'materials', 'swatchColors'] },
    'design-consultation':{ description: 'Design consultation service card', vertical: 'interior', fields: ['headline', 'designStyle', 'projectBudget', 'benefits', 'ctaText', 'bgImageUrl'] },
    // HR/Culture
    'employee-spotlight':{ description: 'Employee spotlight people card', vertical: 'hr', fields: ['employeeName', 'employeeDept', 'employeeYears', 'employeeQuote', 'bgImageUrl'] },
    'company-benefits':  { description: 'Benefits showcase card for recruitment', vertical: 'hr', fields: ['headline', 'benefits', 'ctaText', 'bgImageUrl'] },
    'culture-stats':     { description: 'Company culture metrics dashboard', vertical: 'hr', fields: ['headline', 'cultureStats', 'stat', 'bgImageUrl'] },
    'open-roles':        { description: 'Hiring announcement with open role count', vertical: 'hr', fields: ['headline', 'openRoles', 'skills', 'ctaText'] },
    'team-culture':      { description: 'Team culture snapshot with keywords', vertical: 'hr', fields: ['headline', 'subheadline', 'changelogItems', 'ctaText', 'bgImageUrl'] },
  }
  return new Response(JSON.stringify({ variants, count: Object.keys(variants).length }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

function handleListPresets(): Response {
  const presets: Record<string, { w: number; h: number; label?: string; platforms: string[] }> = {}
  for (const [key, val] of Object.entries(FORMAT_PRESETS)) {
    const platforms: string[] = []
    if (key.includes('instagram')) platforms.push('instagram')
    if (key.includes('twitter') || key.includes('twitter-x')) platforms.push('twitter')
    if (key.includes('linkedin')) platforms.push('linkedin')
    if (key.includes('facebook')) platforms.push('facebook')
    if (key.includes('youtube')) platforms.push('youtube')
    if (key.includes('google') || key.includes('display') || key.includes('leaderboard') || key.includes('skyscraper') || key.includes('mobile-banner') || key.includes('billboard')) platforms.push('google-display')
    if (key.includes('pinterest')) platforms.push('pinterest')
    if (key.includes('spotify')) platforms.push('spotify')
    if (key.includes('tiktok')) platforms.push('tiktok')
    if (key.includes('og-image') || key.includes('email')) platforms.push('email-seo')
    presets[key] = { ...val, platforms: platforms.length ? platforms : ['general'] }
  }
  return new Response(JSON.stringify({ presets, count: Object.keys(presets).length }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

// ── OpenAPI spec ──────────────────────────────────────────────────────────────

function handleOpenApiSpec(request: Request): Response {
  const origin = new URL(request.url).origin
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'MailCraft Satori Image API',
      version: '1.0.0',
      description: 'Edge-rendered image generation API. Brand kit in → multi-format creatives out. Sub-200ms, no cold starts.',
      contact: { url: 'https://mailcraft.io' },
    },
    servers: [{ url: origin, description: 'Production' }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
    paths: {
      '/render': {
        post: {
          summary: 'Render a single image',
          description: 'Render a single card/creative image. Returns PNG or WebP bytes.',
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/RenderRequest' } } } },
          responses: { '200': { description: 'PNG or WebP image bytes', content: { 'image/png': {}, 'image/webp': {} } }, '400': { description: 'Invalid request' }, '401': { description: 'Invalid API key' }, '429': { description: 'Rate limit exceeded' } },
        },
      },
      '/render-collection': {
        post: {
          summary: 'Render a collection of formats',
          description: 'Render multiple formats from a single brand kit in one call. Returns JSON array of base64 images.',
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CollectionRequest' } } } },
          responses: { '200': { description: 'Collection results', content: { 'application/json': { schema: { '$ref': '#/components/schemas/CollectionResponse' } } } } },
        },
      },
      '/render-carousel': {
        post: {
          summary: 'Render a carousel of slides',
          description: 'Render multiple slides as individual PNG images.',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { slides: { type: 'array', items: { '$ref': '#/components/schemas/RenderRequest' } }, format: { type: 'string', enum: ['png', 'webp'] } } } } } },
          responses: { '200': { description: 'Carousel result with base64 slide images' } },
        },
      },
      '/jobs': {
        post: {
          summary: 'Create async render job',
          description: 'Queue a render job. Result POSTed to webhookUrl when complete.',
          requestBody: { required: true, content: { 'application/json': { schema: { allOf: [{ '$ref': '#/components/schemas/RenderRequest' }, { type: 'object', required: ['webhookUrl'], properties: { webhookUrl: { type: 'string', format: 'uri' } } }] } } } },
          responses: { '202': { description: 'Job accepted', content: { 'application/json': { schema: { type: 'object', properties: { jobId: { type: 'string' }, status: { type: 'string' } } } } } } },
        },
      },
      '/jobs/{jobId}': {
        get: {
          summary: 'Get job status',
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Job status' }, '404': { description: 'Job not found' } },
        },
      },
      '/templates': {
        post: { summary: 'Create custom template', responses: { '201': { description: 'Template created' } } },
        get: { summary: 'List custom templates', responses: { '200': { description: 'Template list' } } },
      },
      '/templates/{id}': {
        get: { summary: 'Get template schema', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Template schema' } } },
        delete: { summary: 'Delete template', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
      },
      '/render/{templateId}': {
        post: { summary: 'Render custom template', parameters: [{ name: 'templateId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Rendered image' } } },
      },
      '/compliance-check': {
        post: { summary: 'Check platform compliance', responses: { '200': { description: 'Compliance result' } } },
      },
      '/openapi.json': {
        get: { summary: 'OpenAPI specification', security: [], responses: { '200': { description: 'This spec' } } },
      },
      '/variants': {
        get: { summary: 'List all card variants', security: [], responses: { '200': { description: 'Variant list' } } },
      },
      '/presets': {
        get: { summary: 'List all format presets', security: [], responses: { '200': { description: 'Preset list' } } },
      },
    },
  }

  return new Response(JSON.stringify(spec, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

// ── Collection renderer ───────────────────────────────────────────────────────

async function handleCollection(request: Request, env: Env, keyId: string): Promise<Response> {
  let body: { brandKit: CardOpts; formats?: Array<{ variant?: string; preset?: string; width?: number; height?: number }> }
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (!body.brandKit) {
    return new Response(JSON.stringify({ error: 'brandKit required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const validation = validateBrandKit(body.brandKit)
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: 'Invalid brandKit', errors: validation.errors }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const defaultFormats = [
    { variant: 'editorial-hero', preset: 'og-image' },
    { variant: 'editorial-hero', preset: 'instagram-square' },
    { variant: 'editorial-hero', preset: 'instagram-story' },
    { variant: 'editorial-hero', preset: 'twitter-card' },
    { variant: 'editorial-hero', preset: 'linkedin-post' },
    { variant: 'editorial-hero', preset: 'facebook-feed' },
  ]

  const formats = body.formats ?? defaultFormats
  const t0 = Date.now()

  const outputs = await Promise.all(formats.map(async (fmt, i) => {
    const opts: CardOpts = {
      ...body.brandKit,
      variant: (fmt.variant as CardVariantName) ?? body.brandKit.variant ?? 'editorial-hero',
    }
    if (fmt.preset && FORMAT_PRESETS[fmt.preset as FormatPreset]) {
      const p = FORMAT_PRESETS[fmt.preset as FormatPreset]
      opts.width  = p.w
      opts.height = p.h
    } else {
      const fmtFull = fmt as { variant?: string; preset?: string; width?: number; height?: number }
      opts.width  = fmtFull.width  ?? opts.width  ?? 1200
      opts.height = fmtFull.height ?? opts.height ?? 628
    }

    const shard = i % SHARD_COUNT
    const res   = await callDO(env.SATORI_DO, shard, new Request('https://internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }))

    if (!res.ok) return { variant: opts.variant, preset: fmt.preset ?? null, width: opts.width, height: opts.height, error: `render failed: ${res.status}` }

    const bytes  = new Uint8Array(await res.arrayBuffer())
    let b64full  = ''
    for (let j = 0; j < bytes.length; j += 8192)
      b64full += String.fromCharCode(...bytes.subarray(j, j + 8192))
    const dataUri = `data:image/png;base64,${btoa(b64full)}`

    let cdnUrlStr: string | undefined
    if (env.RENDER_CACHE) {
      const cacheKey = `collection:${keyId}:${opts.variant}:${opts.width}x${opts.height}:${JSON.stringify(body.brandKit).slice(0, 200)}`
      const hash = await sha256Hex(cacheKey)
      const r2Key = `renders/${hash}.png`
      await env.RENDER_CACHE.put(r2Key, bytes, { httpMetadata: { contentType: 'image/png' }, customMetadata: { generatedAt: new Date().toISOString() } }).catch(() => {})
      const origin = new URL(request.url).origin
      cdnUrlStr = `${origin}/assets/${r2Key}`
    }

    return { variant: opts.variant, preset: fmt.preset ?? null, width: opts.width, height: opts.height, image: dataUri, cdnUrl: cdnUrlStr }
  }))

  const totalMs = Date.now() - t0
  console.log(JSON.stringify({ event: 'collection', keyId, count: outputs.length, latencyMs: totalMs }))

  return new Response(JSON.stringify({ outputs, count: outputs.length, latencyMs: totalMs }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Async job renderer ────────────────────────────────────────────────────────

async function handleCreateJob(request: Request, env: Env, keyId: string, ctx: ExecutionContext): Promise<Response> {
  let opts: CardOpts
  try { opts = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!opts.headline || !opts.brandName || !opts.primaryColor) {
    return new Response(JSON.stringify({ error: 'headline, brandName, primaryColor required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!opts.webhookUrl) {
    return new Response(JSON.stringify({ error: 'webhookUrl required for async jobs' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const job = { jobId, status: 'pending', keyId, createdAt: new Date().toISOString(), opts }

  if (env.API_KEYS) {
    await env.API_KEYS.put(`job:${jobId}`, JSON.stringify(job), { expirationTtl: 86400 })
  }

  ctx.waitUntil((async () => {
    try {
      const shard = Math.floor(Math.random() * SHARD_COUNT)
      const res   = await callDO(env.SATORI_DO, shard, new Request('https://internal/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      }))

      if (!res.ok) throw new Error(`render failed: ${res.status}`)

      const bytes = new Uint8Array(await res.arrayBuffer())
      let b64 = ''
      for (let j = 0; j < bytes.length; j += 8192)
        b64 += String.fromCharCode(...bytes.subarray(j, j + 8192))
      const dataUri = `data:image/png;base64,${btoa(b64)}`

      let cdnUrl: string | undefined
      if (env.RENDER_CACHE) {
        const hash  = await sha256Hex(`job:${jobId}`)
        const r2Key = `renders/${hash}.png`
        await env.RENDER_CACHE.put(r2Key, bytes, { httpMetadata: { contentType: 'image/png' } }).catch(() => {})
        cdnUrl = `${new URL(request.url).origin}/assets/${r2Key}`
      }

      const payload = { jobId, status: 'completed', image: dataUri, cdnUrl, completedAt: new Date().toISOString() }
      await fetch(opts.webhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})

      if (env.API_KEYS) {
        await env.API_KEYS.put(`job:${jobId}`, JSON.stringify({ ...job, status: 'completed', cdnUrl }), { expirationTtl: 86400 }).catch(() => {})
      }
    } catch (e) {
      const errPayload = { jobId, status: 'failed', error: String(e), failedAt: new Date().toISOString() }
      await fetch(opts.webhookUrl!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(errPayload) }).catch(() => {})
      if (env.API_KEYS) {
        await env.API_KEYS.put(`job:${jobId}`, JSON.stringify({ ...job, status: 'failed', error: String(e) }), { expirationTtl: 86400 }).catch(() => {})
      }
    }
  })())

  return new Response(JSON.stringify({ jobId, status: 'pending', message: 'Job queued. Result will be POSTed to webhookUrl.' }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  })
}

async function handleGetJob(request: Request, env: Env): Promise<Response> {
  const jobId = new URL(request.url).pathname.split('/').pop() ?? ''
  if (!env.API_KEYS) return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  const job = await env.API_KEYS.get(`job:${jobId}`, { type: 'json' })
  if (!job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  return new Response(JSON.stringify(job), { headers: { 'Content-Type': 'application/json' } })
}

// ── Admin: create API key ─────────────────────────────────────────────────────

async function handleAdminCreateKey(request: Request, env: Env): Promise<Response> {
  const masterKey = request.headers.get('X-Master-Key')
  if (!env.SATORI_MASTER_KEY || masterKey !== env.SATORI_MASTER_KEY) {
    return new Response(JSON.stringify({ error: 'Invalid master key' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!env.API_KEYS) {
    return new Response(JSON.stringify({ error: 'API_KEYS KV not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { keyId?: string; plan?: string; limit?: number }
  try { body = await request.json() } catch { body = {} }

  const keyId = body.keyId ?? `key-${Date.now()}`
  const plan  = body.plan  ?? 'pro'
  const limit = body.limit ?? (plan === 'enterprise' ? 600 : plan === 'pro' ? 120 : 30)

  // Generate a random API key: 32 hex chars
  const raw    = new Uint8Array(16)
  crypto.getRandomValues(raw)
  const apiKey = Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('')

  const value: AuthContext = { keyId, limit }
  await env.API_KEYS.put(apiKey, JSON.stringify(value))

  return new Response(JSON.stringify({ apiKey, keyId, plan, limit }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}

// ── Animated GIF renderer ─────────────────────────────────────────────────────

type AnimationPreset =
  | 'fade-in' | 'pulse' | 'shimmer' | 'counter' | 'typewriter'
  // content-driven (existing)
  | 'word-reveal' | 'build' | 'headline-swap'
  // content-driven (batch 2)
  | 'slot-machine' | 'reveal' | 'stats-cycle' | 'focus-word' | 'color-wave'
  // content-driven (batch 3)
  | 'stagger-in' | 'countdown' | 'number-pop'
  // content-driven (batch 4)
  | 'before-after' | 'question-answer' | 'metric-stack'
  | 'award-reveal' | 'compare' | 'story-beat' | 'value-prop'
  // cinematic pixel
  | 'wipe' | 'zoom' | 'slide'
  // cinematic pixel (batch 3)
  | 'glitch' | 'flip' | 'ping'

interface AnimatedRenderOpts extends CardOpts {
  animation: AnimationPreset
  frames?:   number   // default 8
  delay?:    number   // centiseconds per frame, default 8 (80 ms ≈ 12 fps)
  loops?:    number   // 0 = infinite, default 0
  storeToCDN?: boolean
}

// Maximum pixel dimension on either side for animated GIFs (keeps file size manageable)
const MAX_GIF_SIDE = 480

async function handleAnimated(request: Request, env: Env): Promise<Response> {
  let opts: AnimatedRenderOpts
  try { opts = await request.json() as AnimatedRenderOpts }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }

  if (!opts.headline || !opts.brandName || !opts.primaryColor || !opts.animation) {
    return new Response(JSON.stringify({ error: 'headline, brandName, primaryColor, animation required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Resolve dimensions, capping for GIF
  let w = opts.width ?? 600, h = opts.height ?? 314
  if (opts.preset && FORMAT_PRESETS[opts.preset]) { w = FORMAT_PRESETS[opts.preset].w; h = FORMAT_PRESETS[opts.preset].h }
  const longestSide = Math.max(w, h)
  if (longestSide > MAX_GIF_SIDE) {
    const ratio = MAX_GIF_SIDE / longestSide
    w = Math.round(w * ratio); h = Math.round(h * ratio)
  }
  // Ensure even dimensions (GIF best practice)
  w = w % 2 === 0 ? w : w - 1; h = h % 2 === 0 ? h : h - 1

  const frameCount = Math.min(Math.max(opts.frames ?? 8, 2), 16)
  const delay      = opts.delay ?? 8
  const loops      = opts.loops ?? 0
  const animation  = opts.animation

  const shard = murmurHash32(opts.brandName) % SHARD_COUNT

  // Auto-source base background image once (all frames share the same image)
  opts = await maybeAutoSourceBg(opts, env) as AnimatedRenderOpts

  const renderOnce = async (overrides: Partial<CardOpts>): Promise<Uint8Array> => {
    const payload = { ...opts, width: w, height: h, format: 'png', ...overrides }
    delete (payload as Partial<AnimatedRenderOpts>).animation
    delete (payload as Partial<AnimatedRenderOpts>).frames
    delete (payload as Partial<AnimatedRenderOpts>).delay
    delete (payload as Partial<AnimatedRenderOpts>).loops
    delete (payload as Partial<AnimatedRenderOpts>).storeToCDN
    // Strip preset so the DO honours our explicit width/height (preset would override them)
    delete (payload as Partial<CardOpts>).preset
    const res = await callDO(env.SATORI_DO, shard, new Request('https://internal/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }))
    if (!res.ok) throw new Error(`DO render failed: ${res.status}`)
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  }

  const pngToRgba = (png: Uint8Array): Uint8Array => {
    const img = PhotonImage.new_from_byteslice(png)
    const rgba = img.get_raw_pixels()
    img.free()
    return rgba
  }

  try {
    const gifFrames: Array<{ pixels: Uint8Array; width: number; height: number; delay: number }> = []

    if (animation === 'fade-in') {
      const basePng  = await renderOnce({})
      const baseRgba = pngToRgba(basePng)
      // Ease-out cubic: fast start, decelerates into full brightness
      // Also hold the final frame for 3× normal delay so it reads cleanly
      for (let i = 0; i < frameCount; i++) {
        const t      = i / (frameCount - 1)                  // 0 → 1
        const eased  = 1 - Math.pow(1 - t, 3)               // ease-out cubic
        const factor = 0.08 + 0.92 * eased                  // 8 % → 100 %
        const d      = i === frameCount - 1 ? delay * 3 : delay
        gifFrames.push({ pixels: applyBrightness(baseRgba, factor), width: w, height: h, delay: d })
      }

    } else if (animation === 'pulse') {
      const basePng  = await renderOnce({})
      const baseRgba = pngToRgba(basePng)
      // Smooth sine bell: dim → bright → dim, hold bright peak for longer
      const totalFrames = frameCount + 2                     // extra frames for the dim bookends
      for (let i = 0; i < totalFrames; i++) {
        const t      = i / (totalFrames - 1)
        const sine   = Math.sin(Math.PI * t)                 // 0 → 1 → 0
        const factor = 0.55 + 0.45 * sine                   // 55 % → 100 % → 55 %
        const d      = sine > 0.95 ? delay * 2 : delay      // linger at peak
        gifFrames.push({ pixels: applyBrightness(baseRgba, factor), width: w, height: h, delay: d })
      }

    } else if (animation === 'shimmer') {
      const basePng  = await renderOnce({})
      const baseRgba = pngToRgba(basePng)
      // Wider stripe, ease-in-out travel, hold still frame at start/end
      const stripeW  = Math.round(w * 0.28)
      // 2 still frames bookend the sweep for a natural pause
      gifFrames.push({ pixels: applyBrightness(baseRgba, 1), width: w, height: h, delay: delay * 3 })
      for (let i = 0; i < frameCount; i++) {
        const t  = i / (frameCount - 1)
        // Ease-in-out sine so stripe accelerates then decelerates
        const te = (1 - Math.cos(Math.PI * t)) / 2
        const x0 = Math.round(te * (w + stripeW * 1.5)) - stripeW
        gifFrames.push({ pixels: applyShimmer(baseRgba, w, h, x0, stripeW, 0.35), width: w, height: h, delay })
      }
      gifFrames.push({ pixels: applyBrightness(baseRgba, 1), width: w, height: h, delay: delay * 4 })

    } else if (animation === 'counter') {
      // Separate prefix (e.g. "$") from number and suffix (e.g. "M", "K", "%")
      const raw         = opts.stat ?? opts.headline
      const prefixMatch = raw.match(/^([^0-9]*)/)
      const prefix      = prefixMatch?.[1] ?? ''
      const numMatch    = raw.match(/[\d.,]+/)
      const targetNum   = parseFloat(numMatch?.[0]?.replace(',', '') ?? '100')
      const suffix      = raw.replace(/^[^0-9]*[\d.,]+/, '').trim().slice(0, 8)
      const isDecimal   = targetNum % 1 !== 0
      const renders     = await Promise.all(
        Array.from({ length: frameCount }, (_, i) => {
          // Ease-out quad: numbers ramp up quickly then slow approaching target
          const t   = (i + 1) / frameCount
          const val = targetNum * (1 - Math.pow(1 - t, 2))
          const fmt = isDecimal ? val.toFixed(1) : String(Math.round(val))
          return renderOnce({ stat: `${prefix}${fmt}${suffix}`, headline: `${prefix}${fmt}${suffix}` })
        })
      )
      for (const png of renders) {
        gifFrames.push({ pixels: pngToRgba(png), width: w, height: h, delay })
      }
      // Hold final (correct) value longer
      gifFrames[gifFrames.length - 1].delay = delay * 5

    } else if (animation === 'typewriter') {
      const full    = opts.headline
      const renders = await Promise.all(
        Array.from({ length: frameCount }, (_, i) => {
          const t         = (i + 1) / frameCount
          // Ease-out so typing decelerates near end
          const eased     = 1 - Math.pow(1 - t, 2)
          const chars     = Math.max(1, Math.ceil(full.length * eased))
          const cursor    = chars < full.length ? '|' : ''
          return renderOnce({ headline: full.slice(0, chars) + cursor })
        })
      )
      for (const png of renders) {
        gifFrames.push({ pixels: pngToRgba(png), width: w, height: h, delay })
      }
      // Hold completed text
      gifFrames[gifFrames.length - 1].delay = delay * 6

    // ── word-reveal ─────────────────────────────────────────────────────────
    // Content-driven: headline words appear one by one; best for punchy taglines.
    } else if (animation === 'word-reveal') {
      const words   = (opts.headline ?? '').trim().split(/\s+/)
      const renders = await Promise.all(
        words.map((_, wi) => renderOnce({ headline: words.slice(0, wi + 1).join(' ') }))
      )
      // Brief pause before first word, then each word holds, then long pause at end
      gifFrames.push({ pixels: pngToRgba(renders[0]), width: w, height: h, delay: delay * 2 })
      for (let i = 1; i < renders.length; i++) {
        const d = i === renders.length - 1 ? delay * 10 : delay * 3
        gifFrames.push({ pixels: pngToRgba(renders[i]), width: w, height: h, delay: d })
      }

    // ── build ────────────────────────────────────────────────────────────────
    // Pixel-based top-to-bottom reveal of the full card — reliable across all
    // variants regardless of field names.  A soft horizontal band sweeps down
    // progressively exposing each row; unrevealed rows stay at the card's own
    // background colour so it looks native on both dark and light cards.
    } else if (animation === 'build') {
      const baseRgba = pngToRgba(await renderOnce({}))
      // Sample background colour from the top-left corner pixel
      const bgR = baseRgba[0], bgG = baseRgba[1], bgB = baseRgba[2]
      const softRows = Math.round(h * 0.12)  // feathered band height

      // Use more frames so the reveal feels smooth
      const buildFrames = Math.max(frameCount, 10)
      for (let i = 0; i < buildFrames; i++) {
        const t       = (i + 1) / buildFrames
        const eased   = 1 - Math.pow(1 - t, 2)              // ease-out quad
        const cutY    = Math.round(eased * (h + softRows))   // reveal front

        const frame = new Uint8Array(baseRgba.length)
        for (let y = 0; y < h; y++) {
          const dist  = cutY - y
          let blend: number
          if      (dist >=  softRows * 0.5) blend = 1
          else if (dist <= -softRows * 0.5) blend = 0
          else blend = (dist + softRows * 0.5) / softRows

          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4
            frame[idx]     = Math.round(baseRgba[idx]     * blend + bgR * (1 - blend))
            frame[idx + 1] = Math.round(baseRgba[idx + 1] * blend + bgG * (1 - blend))
            frame[idx + 2] = Math.round(baseRgba[idx + 2] * blend + bgB * (1 - blend))
            frame[idx + 3] = 255
          }
        }
        const d = i === buildFrames - 1 ? delay * 8 : delay
        gifFrames.push({ pixels: frame, width: w, height: h, delay: d })
      }

    // ── headline-swap ────────────────────────────────────────────────────────
    // Content-driven: cycles through 2–3 different headline messages.
    // Useful for A/B message cards or multi-benefit showcases.
    } else if (animation === 'headline-swap') {
      // Derive alternate headlines from the main one (split on " / " or auto-generate two variants)
      const parts = (opts.headline ?? '').split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean)
      const headlines = parts.length > 1 ? parts : [
        opts.headline ?? '',
        opts.subheadline ?? opts.headline ?? '',
        opts.stat ? `${opts.stat} ${(opts.bodyText ?? '').slice(0, 20)}` : opts.headline ?? '',
      ].filter((s, i, a) => s && a.indexOf(s) === i).slice(0, 3)

      for (let cycle = 0; cycle < 2; cycle++) {       // play through twice
        for (const hl of headlines) {
          const png = await renderOnce({ headline: hl })
          gifFrames.push({ pixels: pngToRgba(png), width: w, height: h, delay: delay * 8 })
        }
      }

    // ── wipe ─────────────────────────────────────────────────────────────────
    // Pixel-cinematic: card reveals left-to-right behind a solid dark curtain.
    // The curtain colour is derived from primaryColor so it always contrasts.
    } else if (animation === 'wipe') {
      const baseRgba = pngToRgba(await renderOnce({}))
      // Derive curtain colour from primaryColor (darken by 40% for contrast)
      const pc  = (opts.primaryColor ?? '#0f0f1e').replace('#', '')
      const pcR = Math.round(parseInt(pc.slice(0, 2), 16) * 0.6)
      const pcG = Math.round(parseInt(pc.slice(2, 4), 16) * 0.6)
      const pcB = Math.round(parseInt(pc.slice(4, 6), 16) * 0.6)
      // Start with a thin sliver visible (not blank) so the motion is clear from frame 1
      for (let i = 0; i <= frameCount; i++) {
        const t     = i / frameCount
        const eased = 1 - Math.pow(1 - t, 2)          // ease-out quad
        // Map 0→0.04 (thin leading edge) … 1→1.0 (fully revealed)
        const prog  = 0.04 + 0.96 * eased
        const d     = i === frameCount ? delay * 6 : delay
        gifFrames.push({ pixels: applyWipe(baseRgba, w, h, prog, 28, pcR, pcG, pcB), width: w, height: h, delay: d })
      }

    // ── zoom ─────────────────────────────────────────────────────────────────
    // Pixel-cinematic: Ken Burns zoom-out — starts cropped at 1.35×, settles to full card.
    } else if (animation === 'zoom') {
      const baseRgba = pngToRgba(await renderOnce({}))
      for (let i = 0; i < frameCount; i++) {
        const t     = i / (frameCount - 1)
        const eased = 1 - Math.pow(1 - t, 3)          // ease-out cubic
        const scale = 1.35 - 0.35 * eased             // 1.35 → 1.0
        const d     = i === frameCount - 1 ? delay * 6 : delay
        gifFrames.push({ pixels: applyZoom(baseRgba, w, h, scale), width: w, height: h, delay: d })
      }

    // ── slide ─────────────────────────────────────────────────────────────────
    // Pixel-cinematic: card slides in from the right with ease-out deceleration.
    } else if (animation === 'slide') {
      const baseRgba = pngToRgba(await renderOnce({}))
      for (let i = 0; i < frameCount; i++) {
        const t      = (i + 1) / frameCount
        const eased  = 1 - Math.pow(1 - t, 3)         // ease-out cubic
        const offset = Math.round((1 - eased) * w)    // w → 0 pixels from right
        const d      = i === frameCount - 1 ? delay * 6 : delay
        gifFrames.push({ pixels: applySlide(baseRgba, w, h, offset), width: w, height: h, delay: d })
      }

    // ── slot-machine ─────────────────────────────────────────────────────────
    // Content-driven: stat/number spins through rapid random values like a fruit
    // machine before snapping to the real figure.  Each rapid frame is a live
    // Satori render so the layout stays consistent throughout.
    } else if (animation === 'slot-machine') {
      const raw     = opts.stat ?? opts.headline ?? '100'
      const prefix  = (raw.match(/^([^0-9]*)/) ?? [])[1] ?? ''
      const numStr  = (raw.match(/[\d.,]+/) ?? ['100'])[0]
      const target  = parseFloat(numStr.replace(',', ''))
      const suffix  = raw.replace(/^[^0-9]*[\d.,]+/, '').trim().slice(0, 8)
      const dec     = target % 1 !== 0
      const fmt     = (n: number) => `${prefix}${dec ? n.toFixed(1) : String(Math.round(n))}${suffix}`

      // Rapid spin: 6 random frames at 30 ms each
      const spinCount = 6
      const spinRenders = await Promise.all(
        Array.from({ length: spinCount }, () => {
          const rnd = target * (0.3 + Math.random() * 1.4)
          return renderOnce({ stat: fmt(rnd), headline: fmt(rnd) })
        })
      )
      for (const png of spinRenders) {
        gifFrames.push({ pixels: pngToRgba(png), width: w, height: h, delay: 3 })
      }
      // Slow down: 3 frames approaching target
      for (let i = 0; i < 3; i++) {
        const approach = target * (0.7 + 0.1 * i + Math.random() * 0.05)
        const png = await renderOnce({ stat: fmt(approach), headline: fmt(approach) })
        gifFrames.push({ pixels: pngToRgba(png), width: w, height: h, delay: 5 + i * 3 })
      }
      // Final: real value — hold long
      const finalPng = await renderOnce({ stat: fmt(target), headline: fmt(target) })
      gifFrames.push({ pixels: pngToRgba(finalPng), width: w, height: h, delay: delay * 12 })

    // ── reveal ────────────────────────────────────────────────────────────────
    // Pixel-driven: render the full card once, then show it at 3 brightness levels
    // (dark → mid → full) so the card "materialises" out of darkness.
    // This is more reliable than text-masking because it works with any font/variant.
    } else if (animation === 'reveal') {
      const baseRgba = pngToRgba(await renderOnce({}))
      // Stage 1: very dark (5%) — card silhouette only
      // Stage 2: 45% brightness — colours & structure hinted
      // Stage 3: 100% — full card; long hold for payoff
      const brightLevels  = [0.05, 0.45, 1.0]
      const stageDelays   = [delay * 5, delay * 4, delay * 14]
      for (let i = 0; i < brightLevels.length; i++) {
        const px = brightLevels[i] < 1.0 ? applyBrightness(baseRgba, brightLevels[i]) : baseRgba
        gifFrames.push({ pixels: px, width: w, height: h, delay: stageDelays[i] })
      }

    // ── stats-cycle ───────────────────────────────────────────────────────────
    // Content-driven: cycles through multiple metrics on the same card.
    // Accepts "|"-delimited items in the headline, e.g. "10x Growth | $4.2M ARR | 50K Users".
    // Falls back to cycling headline → subheadline → stat when no "|" is present.
    } else if (animation === 'stats-cycle') {
      const raw   = opts.headline ?? ''
      const parts = raw.includes('|')
        ? raw.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean)
        : [
            opts.headline,
            opts.subheadline && opts.subheadline !== opts.headline ? opts.subheadline : null,
            opts.stat        && opts.stat        !== opts.headline ? opts.stat        : null,
          ].filter(Boolean) as string[]

      // Play through twice for emphasis
      for (let cycle = 0; cycle < 2; cycle++) {
        for (const item of parts) {
          const png = await renderOnce({ headline: item, stat: item })
          const d   = cycle === 1 && item === parts[parts.length - 1] ? delay * 10 : delay * 7
          gifFrames.push({ pixels: pngToRgba(png), width: w, height: h, delay: d })
        }
      }

    // ── focus-word ────────────────────────────────────────────────────────────
    // Content-driven: each frame spotlights one word by UPPERCASING it while the
    // rest stay title-case, guiding the viewer's eye through the headline.
    // Ends with the original headline held for a long pause.
    } else if (animation === 'focus-word') {
      const words = (opts.headline ?? '').trim().split(/\s+/)
      const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
      const renders = await Promise.all(
        words.map((_, wi) => {
          const hl = words.map((word, i) =>
            i === wi ? word.toUpperCase() : titleCase(word)
          ).join(' ')
          return renderOnce({ headline: hl })
        })
      )
      for (const png of renders) {
        gifFrames.push({ pixels: pngToRgba(png), width: w, height: h, delay: delay * 4 })
      }
      // Final frame: original headline, long hold
      const finalPng = await renderOnce({})
      gifFrames.push({ pixels: pngToRgba(finalPng), width: w, height: h, delay: delay * 10 })

    // ── color-wave ────────────────────────────────────────────────────────────
    // Content-driven: re-renders the full card at 5 brand-adjacent colour shades
    // (darker → base → lighter → base) creating a breathing colour-pulse effect.
    } else if (animation === 'color-wave') {
      const base = opts.primaryColor ?? '#0F3460'
      // Simple perceptual lightness shift via channel scaling
      const shift = (hex: string, factor: number): string => {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)))
        return `#${c(r).toString(16).padStart(2, '0')}${c(g).toString(16).padStart(2, '0')}${c(b).toString(16).padStart(2, '0')}`
      }
      const shades = [
        shift(base, 0.55),   // deep
        shift(base, 0.75),   // darker
        base,                // original
        shift(base, 1.35),   // lighter
        base,                // back to original — hold
      ]
      const renders = await Promise.all(shades.map(color => renderOnce({ primaryColor: color })))
      for (let i = 0; i < shades.length; i++) {
        const d = shades[i] === base && i > 0 ? delay * 8 : delay * 3
        gifFrames.push({ pixels: pngToRgba(renders[i]), width: w, height: h, delay: d })
      }

    // ── stagger-in ────────────────────────────────────────────────────────────
    // Content-driven: card elements materialise one by one.
    // Frame 1 → brand name only; Frame 2 → + headline; Frame 3 → + stat/sub; Frame 4 → full.
    // Uses empty strings so absent slots render as blank space in the layout.
    } else if (animation === 'stagger-in') {
      const stages: Array<Partial<typeof opts>> = [
        // Stage 1: just brand name
        { headline: '\u00a0', stat: '\u00a0', subheadline: '\u00a0', bodyText: '\u00a0' },
        // Stage 2: brand + headline
        { stat: '\u00a0', subheadline: '\u00a0', bodyText: '\u00a0' },
        // Stage 3: brand + headline + stat, no subheadline
        { subheadline: '\u00a0', bodyText: '\u00a0' },
        // Stage 4: everything
        {},
      ]
      const renders = await Promise.all(stages.map(ov => renderOnce(ov)))
      const stageDelays = [delay * 5, delay * 5, delay * 5, delay * 14]
      for (let i = 0; i < stages.length; i++) {
        gifFrames.push({ pixels: pngToRgba(renders[i]), width: w, height: h, delay: stageDelays[i] })
      }

    // ── countdown ─────────────────────────────────────────────────────────────
    // Content-driven: shows "3 → 2 → 1 → GO!" then reveals the real card.
    // Ideal for launches, sales countdowns, and limited-time offers.
    } else if (animation === 'countdown') {
      const countItems = [
        { headline: '3', stat: '3', subheadline: '' },
        { headline: '2', stat: '2', subheadline: '' },
        { headline: '1', stat: '1', subheadline: '' },
        { headline: 'GO!', stat: 'GO!', subheadline: opts.subheadline ?? '' },
      ]
      const countRenders = await Promise.all(countItems.map(ov => renderOnce(ov)))
      const finalRender  = await renderOnce({})
      // 3-2-1 hold briefly; GO! hold a bit longer; final card long hold
      const countDelays  = [delay * 6, delay * 6, delay * 6, delay * 5]
      for (let i = 0; i < countItems.length; i++) {
        gifFrames.push({ pixels: pngToRgba(countRenders[i]), width: w, height: h, delay: countDelays[i] })
      }
      gifFrames.push({ pixels: pngToRgba(finalRender), width: w, height: h, delay: delay * 14 })

    // ── number-pop ────────────────────────────────────────────────────────────
    // Content-driven + pixel: stat value "springs" into place via a zoom bounce.
    // Renders one base card, then applies zoom spring: overshoot → undershoot → settle.
    } else if (animation === 'number-pop') {
      const baseRgba = pngToRgba(await renderOnce({}))
      // Spring: 0.7× (compressed) → 1.18× (overshoot) → 0.96× (undershoot) → 1.0 (settle)
      const scales   = [0.70, 1.18, 0.96, 1.0]
      const popDelays = [delay * 2, delay * 2, delay * 2, delay * 14]
      for (let i = 0; i < scales.length; i++) {
        const px = scales[i] !== 1.0 ? applyZoom(baseRgba, w, h, scales[i]) : baseRgba
        gifFrames.push({ pixels: px, width: w, height: h, delay: popDelays[i] })
      }

    // ── glitch ────────────────────────────────────────────────────────────────
    // Pixel: rapid RGB channel offsets (chromatic aberration) then snaps clean.
    // 3 brief glitch frames at different band positions, then full-clean hold.
    } else if (animation === 'glitch') {
      const baseRgba = pngToRgba(await renderOnce({}))
      const h3 = Math.floor(h / 3)
      // Base — 1 frame before glitch starts
      gifFrames.push({ pixels: baseRgba, width: w, height: h, delay: delay * 3 })
      // Glitch burst: 3 frames with different band positions and shift amounts
      const glitches = [
        { shift: 10, bandY: h3,     bandH: h3 },     // middle band
        { shift: 6,  bandY: 0,      bandH: h3 * 2 }, // top-two-thirds
        { shift: 14, bandY: h3 / 2, bandH: h3 },     // offset band
      ]
      for (const g of glitches) {
        gifFrames.push({
          pixels: applyGlitch(baseRgba, w, h, g.shift, g.bandY, g.bandH),
          width: w, height: h, delay: delay * 1,     // very short (1cs ≈ 10ms)
        })
      }
      // One brightness-boosted flash frame
      gifFrames.push({ pixels: applyBrightness(baseRgba, 1.25 > 1 ? 1 : 1), width: w, height: h, delay: delay })
      // Clean settle — long hold
      gifFrames.push({ pixels: baseRgba, width: w, height: h, delay: delay * 14 })

    // ── flip ──────────────────────────────────────────────────────────────────
    // Pixel: simulates a horizontal card flip. Card squeezes to 0 then expands
    // back — optionally with a slightly brightened "back face" mid-flip.
    } else if (animation === 'flip') {
      const baseRgba = pngToRgba(await renderOnce({}))
      // Sample fill colour from card bg (top-left pixel)
      const fR = baseRgba[0], fG = baseRgba[1], fB = baseRgba[2]
      const flipFrames = Math.max(frameCount, 8)
      // Phase 1: squeeze out (0 → fully collapsed)
      for (let i = 0; i < flipFrames / 2; i++) {
        const t       = (i + 1) / (flipFrames / 2)
        const eased   = t * t                       // ease-in
        gifFrames.push({
          pixels: applyFlipSqueeze(baseRgba, w, h, eased, fR, fG, fB),
          width: w, height: h, delay: delay,
        })
      }
      // Phase 2: expand back in (reversed)
      for (let i = flipFrames / 2 - 1; i >= 0; i--) {
        const t      = (i + 1) / (flipFrames / 2)
        const eased  = t * t
        const d      = i === 0 ? delay * 14 : delay  // long hold on final frame
        gifFrames.push({
          pixels: applyFlipSqueeze(baseRgba, w, h, eased, fR, fG, fB),
          width: w, height: h, delay: d,
        })
      }

    // ── ping ──────────────────────────────────────────────────────────────────
    // Pixel: a bright ring radiates outward from the centre of the card, like a
    // sonar ping or notification pulse. One ring per frame, fading as it expands.
    } else if (animation === 'ping') {
      const baseRgba   = pngToRgba(await renderOnce({}))
      const maxRadius  = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2) * 1.1
      const pingFrames = Math.max(frameCount, 10)
      // Frame 0: clean base (hold before pulse starts)
      gifFrames.push({ pixels: baseRgba, width: w, height: h, delay: delay * 4 })
      for (let i = 1; i <= pingFrames; i++) {
        const t         = i / pingFrames
        const radius    = t * maxRadius
        const intensity = 0.65 * (1 - t)            // ring fades as it expands
        const d         = i === pingFrames ? delay * 10 : delay
        gifFrames.push({
          pixels: applyPing(baseRgba, w, h, radius, 12, intensity),
          width: w, height: h, delay: d,
        })
      }

    // ── before-after ─────────────────────────────────────────────────────────
    // Content-driven: shows a "before" state then an "after" state side by side
    // in time.  Split headline with "|": "Before Value | After Value".
    // Adds a label so viewers know which is which.
    } else if (animation === 'before-after') {
      const parts  = (opts.headline ?? '').split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean)
      const before = parts[0] ?? opts.headline ?? ''
      const after  = parts[1] ?? opts.headline ?? ''
      // Frame 1: BEFORE — darker/muted to signal "old state"
      const beforePng = await renderOnce({ headline: before, stat: before, subheadline: 'Before' })
      // Frame 2: short bridge — just brand name + ellipsis
      const bridgePng = await renderOnce({ headline: '→', stat: '→', subheadline: '' })
      // Frame 3: AFTER — full colour, long hold for payoff
      const afterPng  = await renderOnce({ headline: after,  stat: after,  subheadline: 'After' })
      gifFrames.push({ pixels: pngToRgba(beforePng), width: w, height: h, delay: delay * 9 })
      gifFrames.push({ pixels: pngToRgba(bridgePng), width: w, height: h, delay: delay * 2 })
      gifFrames.push({ pixels: pngToRgba(afterPng),  width: w, height: h, delay: delay * 15 })

    // ── question-answer ───────────────────────────────────────────────────────
    // Content-driven: shows a question (subheadline or derived) → brief "..."
    // pause → full card answer.  Builds suspense before the stat lands.
    } else if (animation === 'question-answer') {
      const question = opts.subheadline && opts.subheadline !== opts.headline
        ? opts.subheadline
        : `What was our ${(opts.headline ?? '').replace(/[\d$.,+%MKB]+/gi, '').trim() || 'result'}?`
      const questionPng = await renderOnce({
        headline: question, stat: '?', subheadline: '',
      })
      const pausePng = await renderOnce({
        headline: '...', stat: '...', subheadline: '',
      })
      const answerPng = await renderOnce({})
      gifFrames.push({ pixels: pngToRgba(questionPng), width: w, height: h, delay: delay * 10 })
      gifFrames.push({ pixels: pngToRgba(pausePng),    width: w, height: h, delay: delay * 4  })
      gifFrames.push({ pixels: pngToRgba(answerPng),   width: w, height: h, delay: delay * 15 })

    // ── metric-stack ──────────────────────────────────────────────────────────
    // Content-driven: cycles each "|"-delimited metric as the big stat + headline.
    // Great for dashboards — e.g. "$4.2M Revenue | +38% Growth | 2,400 Users".
    // Each item shown individually so it can breathe; last item held longest.
    } else if (animation === 'metric-stack') {
      const raw   = opts.headline ?? ''
      const items = raw.includes('|')
        ? raw.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean)
        : [raw]
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        // Split "Label: Value" into subheadline + stat if colon present
        const colonIdx = item.indexOf(':')
        const label    = colonIdx > -1 ? item.slice(0, colonIdx).trim() : ''
        const value    = colonIdx > -1 ? item.slice(colonIdx + 1).trim() : item
        const isLast   = i === items.length - 1
        const png = await renderOnce({
          headline:    item,
          stat:        value,
          subheadline: label || opts.subheadline,
        })
        gifFrames.push({ pixels: pngToRgba(png), width: w, height: h, delay: isLast ? delay * 14 : delay * 7 })
      }

    // ── award-reveal ──────────────────────────────────────────────────────────
    // Content-driven: award ceremony suspense — "And the winner is..."
    // → brief hold → real stat/headline reveal.
    } else if (animation === 'award-reveal') {
      const teaserPng = await renderOnce({
        headline:    'And the winner is...',
        stat:        opts.brandName ?? '...',
        subheadline: '',
      })
      const holdPng = await renderOnce({
        headline: '...', stat: '...', subheadline: '',
      })
      const revealPng = await renderOnce({})
      gifFrames.push({ pixels: pngToRgba(teaserPng), width: w, height: h, delay: delay * 10 })
      gifFrames.push({ pixels: pngToRgba(holdPng),   width: w, height: h, delay: delay * 5  })
      gifFrames.push({ pixels: pngToRgba(revealPng), width: w, height: h, delay: delay * 15 })

    // ── compare ───────────────────────────────────────────────────────────────
    // Content-driven: head-to-head comparison, then the winner holds.
    // Split headline with "|": "Industry Avg: $1.2M | Us: $4.2M".
    } else if (animation === 'compare') {
      const parts = (opts.headline ?? '').split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean)
      const them  = parts[0] ?? 'Industry Avg'
      const us    = parts[1] ?? opts.headline ?? ''
      // Parse "Label: Value" format for clean display
      const parseItem = (s: string) => {
        const c = s.indexOf(':')
        return c > -1 ? { label: s.slice(0, c).trim(), val: s.slice(c + 1).trim() } : { label: '', val: s }
      }
      const themParsed = parseItem(them)
      const usParsed   = parseItem(us)
      const themPng = await renderOnce({
        headline:    them,
        stat:        themParsed.val,
        subheadline: themParsed.label || 'Competition',
      })
      const usPng = await renderOnce({
        headline:    us,
        stat:        usParsed.val,
        subheadline: usParsed.label || 'Us',
      })
      gifFrames.push({ pixels: pngToRgba(themPng), width: w, height: h, delay: delay * 8  })
      gifFrames.push({ pixels: pngToRgba(usPng),   width: w, height: h, delay: delay * 16 }) // hold on winner

    // ── story-beat ────────────────────────────────────────────────────────────
    // Content-driven: micro-story told one beat at a time.
    // Split headline with "|" or ". ": each beat shown as its own headline frame.
    // Ideal for case studies and narrative-driven content.
    } else if (animation === 'story-beat') {
      const raw   = opts.headline ?? ''
      const beats = raw.includes('|')
        ? raw.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean)
        : raw.split(/\.\s+/).map(s => s.trim()).filter(Boolean)
      const allBeats = beats.length > 1 ? beats : [raw]
      for (let i = 0; i < allBeats.length; i++) {
        const beat   = allBeats[i]
        const isLast = i === allBeats.length - 1
        const png    = await renderOnce({
          headline:    beat,
          stat:        isLast ? (opts.stat ?? beat) : beat,
          subheadline: isLast ? opts.subheadline : `${i + 1} / ${allBeats.length}`,
        })
        gifFrames.push({
          pixels: pngToRgba(png), width: w, height: h,
          delay: isLast ? delay * 14 : delay * 8,
        })
      }

    // ── value-prop ────────────────────────────────────────────────────────────
    // Content-driven: cycles through benefit/value propositions one at a time.
    // Split headline with "|": "Save 10 hrs/week | Cut costs 40% | Ship 3x faster".
    // Each proposition shown as a standalone headline with the brand name for emphasis.
    } else if (animation === 'value-prop') {
      const raw   = opts.headline ?? ''
      const props = raw.includes('|')
        ? raw.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean)
        : [raw]
      for (let i = 0; i < props.length; i++) {
        const vp     = props[i]
        const isLast = i === props.length - 1
        // Parse numeric value from prop string for the stat slot
        const numMatch = vp.match(/[\d.,]+[MKBxX%]+|[\d.,]+/)
        const statVal  = numMatch ? numMatch[0] : vp.slice(0, 8)
        const png = await renderOnce({
          headline:    vp,
          stat:        statVal,
          subheadline: `Benefit ${i + 1} of ${props.length}`,
        })
        gifFrames.push({
          pixels: pngToRgba(png), width: w, height: h,
          delay: isLast ? delay * 14 : delay * 8,
        })
      }

    } else {
      return new Response(JSON.stringify({ error: `Unknown animation: ${animation}` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    const gifBytes = encodeAnimatedGif(gifFrames, loops)
    const cacheKey = `animated:${animation}:${JSON.stringify({ ...opts, width: w, height: h })}`

    let assetKey: string | null = null
    if (opts.storeToCDN !== false) {
      assetKey = await storeToR2(env, cacheKey, gifBytes, 'image/gif')
    }

    const resHeaders: Record<string, string> = {
      'Content-Type':  'image/gif',
      'Cache-Control': 'public, max-age=86400',
      'X-Frame-Count': String(frameCount),
      'X-Animation':   animation,
    }
    if (assetKey) resHeaders['X-CDN-URL'] = cdnUrl(request, assetKey)

    return new Response(gifBytes, { headers: resHeaders })

  } catch (err) {
    console.error('[animated] failed:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

// ── Product-feed batch renderer ───────────────────────────────────────────────

interface FeedItem {
  id:           string
  productName:  string
  price?:       string
  imageUrl?:    string
  category?:    string
  tokens?:      Record<string, string>
}

interface FeedRenderOpts {
  items:    FeedItem[]
  template: Omit<CardOpts, 'headline' | 'bgImageUrl' | 'price' | 'tokens'>
  format?:  'png' | 'webp'
  storeToCDN?: boolean
}

async function handleFeed(request: Request, env: Env): Promise<Response> {
  let body: FeedRenderOpts
  try { body = await request.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }

  if (!Array.isArray(body?.items) || body.items.length === 0) {
    return new Response(JSON.stringify({ error: 'items array required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (body.items.length > 20) {
    return new Response(JSON.stringify({ error: 'max 20 items per feed request' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!body.template?.brandName || !body.template?.primaryColor) {
    return new Response(JSON.stringify({ error: 'template.brandName and template.primaryColor required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const results = await Promise.all(body.items.map(async (item) => {
    let slideOpts: CardOpts = {
      ...body.template,
      variant:     body.template.variant ?? 'product-showcase',
      headline:    item.productName,
      subheadline: item.category,
      price:       item.price,
      bgImageUrl:  item.imageUrl,
      format:      body.format ?? 'png',
      tokens:      item.tokens,
    }

    // Auto-source from Pexels if no product image was provided
    slideOpts = await maybeAutoSourceBg(slideOpts, env)

    const brandName = body.template.brandName ?? ''
    const shard     = murmurHash32(brandName) % SHARD_COUNT
    try {
      const res = await callDO(env.SATORI_DO, shard, new Request('https://internal/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(slideOpts),
      }))
      if (!res.ok) return { id: item.id, error: `render failed: ${res.status}` }

      const buf   = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      const fmt   = body.format ?? 'png'
      const ct    = fmt === 'webp' ? 'image/webp' : 'image/png'

      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const base64 = btoa(binary)

      let assetKey: string | null = null
      if (body.storeToCDN !== false) {
        const cacheKey = `feed:${item.id}:${JSON.stringify(slideOpts)}`
        assetKey = await storeToR2(env, cacheKey, bytes, ct)
      }

      return {
        id:      item.id,
        image:   `data:${ct};base64,${base64}`,
        cdnUrl:  assetKey ? cdnUrl(request, assetKey) : undefined,
        bytes:   bytes.length,
      }
    } catch (e) {
      return { id: item.id, error: String(e) }
    }
  }))

  return new Response(JSON.stringify({ results, count: results.length }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

// ── Platform compliance check ─────────────────────────────────────────────────

async function handleComplianceCheck(request: Request, env: Env): Promise<Response> {
  let body: { width?: number; height?: number; platform?: string; imageBase64?: string }
  try { body = await request.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }

  const width    = body.width    ?? 0
  const height   = body.height   ?? 0
  const platform = body.platform ?? 'meta'

  if (width === 0 || height === 0) {
    return new Response(JSON.stringify({ error: 'width and height required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Decode image pixels if base64 PNG provided (for text-coverage analysis)
  let rgbaPixels: Uint8Array | undefined
  if (body.imageBase64) {
    try {
      const binary  = atob(body.imageBase64)
      const pngBytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) pngBytes[i] = binary.charCodeAt(i)
      const img = PhotonImage.new_from_byteslice(pngBytes)
      rgbaPixels = img.get_raw_pixels()
      img.free()
    } catch { /* skip pixel analysis on decode failure */ }
  }

  const result   = checkPlatformCompliance(width, height, platform, rgbaPixels)
  const detected = detectPlatforms(width, height)

  return new Response(JSON.stringify({ ...result, detectedPlatforms: detected }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Natural-language prompt parser ────────────────────────────────────────────

async function handleParsePrompt(request: Request, env: Env): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 501, headers: { 'Content-Type': 'application/json' },
    })
  }
  let body: { prompt?: string } = {}
  try { body = await request.json() } catch { /* ok */ }
  if (!body.prompt?.trim()) {
    return new Response(JSON.stringify({ error: 'prompt is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const VARIANT_LIST = [
    'stat-hero','announcement','editorial-hero','testimonial','feature-split','tip-card',
    'quote-overlay','benefit-strip','recipe-hero','product-showcase','coupon-offer',
    'event-card','video-thumbnail','app-screenshot','before-after','countdown-timer',
    'course-launch','feature-launch','flash-deal','job-posting','market-update',
    'menu-special','new-arrival','open-house','podcast-cover','price-drop','pricing-card',
    'product-shot','property-listing','rate-announcement','social-proof','sold-announcement',
    'transformation','waitlist-signup','spotify-now-playing','youtube-stats',
    'podcast-milestones','movie-poster','live-stream-alert','album-art','tweet-card',
    'github-stats','code-snippet','linkedin-article','discord-announcement',
    'instagram-quote','tiktok-caption','changelog-card','business-card','sports-score',
    'gaming-achievement','proposal-cover','award-badge','receipt-card','qr-code-card',
    'team-member','newsletter-header','book-cover','google-review','blog-post-card',
    'press-release','infographic-stat','star-rating','gift-card','loyalty-card',
    'travel-destination','cocktail-recipe','health-metrics','savings-goal','birthday-card',
    'workout-plan','nutrition-facts','referral-card','car-listing','test-drive-cta',
    'lookbook-card','style-drop','fashion-sale','nft-showcase','token-launch','dao-proposal',
    'donation-progress','impact-stats','charity-appeal','volunteer-cta','room-reveal',
    'project-showcase','material-moodboard','design-consultation','employee-spotlight',
    'company-benefits','open-roles',
  ]

  const systemPrompt = `You are a card renderer parameter extractor. Extract render parameters from the user's natural language description of a visual card they want to create.

Available variants: ${VARIANT_LIST.join(', ')}

Available presets: instagram-square (1080×1080), instagram-story (1080×1920), twitter-x (1200×675), linkedin-post (1200×627), og-image (1200×630)

Variant selection guide:
- stats/metrics/growth → stat-hero
- customer quote/review → testimonial or quote-overlay
- product launch/sale → product-showcase or new-arrival
- event/conference → event-card or countdown-timer
- job listing → job-posting
- podcast/music → podcast-cover or spotify-now-playing
- tweet/social post → tweet-card
- code/developer → code-snippet or github-stats
- recipe/food → recipe-hero or menu-special
- travel/destination → travel-destination
- announcement/news → announcement
- real estate → property-listing or open-house
- startup/SaaS → stat-hero or feature-launch or waitlist-signup
- fitness/health → workout-plan or health-metrics
- fashion → lookbook-card or style-drop
- nonprofit/charity → charity-appeal or donation-progress
- interior design → room-reveal or material-moodboard
- hiring/HR → open-roles or employee-spotlight
- crypto/NFT → nft-showcase or token-launch

Return ONLY valid JSON (no markdown, no explanation):
{
  "variant": "variant id",
  "brandName": "brand or company name (infer from context)",
  "primaryColor": "#hex (infer from brand or industry: SaaS→#5b5bd6, finance→#0F3460, food→#c0392b, wellness→#0a7c42, luxury→#1A0F0A, tech→#0ea5e9)",
  "headline": "punchy headline (max 60 chars)",
  "subheadline": "supporting text if natural (max 80 chars, omit if not needed)",
  "stat": "key metric if applicable (e.g. '99.9%', '10x', '$2M')",
  "ctaText": "CTA button text if applicable",
  "preset": "most appropriate preset for this content type"
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: body.prompt }],
    }),
  })

  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'AI parse failed', upstream: res.status }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }

  const data = await res.json<{ content: { type: string; text: string }[] }>()
  const text = data.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '{}'
  let params: Record<string, unknown> = {}
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) params = JSON.parse(match[0])
  } catch { /* ok */ }

  return new Response(JSON.stringify({ params }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

// ── Single-card render (extracted for reuse) ──────────────────────────────────

async function handleSingleRender(request: Request, env: Env, bodyText: string): Promise<Response> {
  let opts: CardOpts = { headline: '', brandName: '', primaryColor: '' }
  try { opts = JSON.parse(bodyText) as CardOpts } catch { /* ok */ }

  const validation = validateBrandKit(opts)
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: 'Invalid request', errors: validation.errors }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Brand URL → auto-extract primaryColor before anything else.
  // resolveColors() is the single source of truth for the full fallback chain:
  //   explicit primaryColor → brandUrl extraction → per-vertical editorial fallback.
  // Inline logic here is intentionally deleted — all callers use resolveColors().
  if (!opts.primaryColor) {
    const resolved = await resolveColors({
      primaryColor:       opts.primaryColor,
      brandUrl:           opts.brandUrl,
      variant:            opts.variant,
      kv:                 env.API_KEYS,
      extractBrandColorFn: extractBrandColor,
    })
    opts = { ...opts, primaryColor: resolved.primary }
  }

  // Auto-source background image from Pexels if none provided
  opts = await maybeAutoSourceBg(opts, env)

  const brandName = opts.brandName ?? ''
  const shard = murmurHash32(brandName) % SHARD_COUNT
  const res = await callDO(env.SATORI_DO, shard, new Request(request.url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(opts),
  }))

  // Optionally store to R2 for CDN-backed URL
  if (res.ok && env.RENDER_CACHE) {
    const ct    = res.headers.get('Content-Type') ?? 'image/png'
    const clone = res.clone()
    const buf   = await clone.arrayBuffer()
    const bytes = new Uint8Array(buf)

    const key = await storeToR2(env, makeCacheKey(opts), bytes, ct)
    if (key) {
      const headers = new Headers(res.headers)
      headers.set('X-CDN-URL', cdnUrl(request, key))
      headers.set('X-R2-Key', key)
      return new Response(bytes, { status: res.status, headers })
    }
  }

  return res
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
}

function withCors(res: Response): Response {
  const h = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url  = new URL(request.url)
    const path = url.pathname

    // ── CORS preflight ─────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ── Public CDN asset serving (no auth required) ────────────────────────
    if (request.method === 'GET' && path.startsWith('/assets/')) {
      return handleAssetGet(request, env)
    }

    // ── Discovery + spec endpoints (no auth required) ──────────────────────
    if (request.method === 'GET' && path === '/openapi.json') return handleOpenApiSpec(request)
    if (request.method === 'GET' && path === '/variants') return handleListVariants()
    if (request.method === 'GET' && path === '/presets')  return handleListPresets()

    // ── Admin: create API key ──────────────────────────────────────────────
    if (request.method === 'POST' && path === '/admin/keys') {
      return handleAdminCreateKey(request, env)
    }

    // ── Jobs: GET /jobs/:id (auth required) ───────────────────────────────
    const jobIdMatch = path.match(/^\/jobs\/([^/]+)$/)
    if (request.method === 'GET' && jobIdMatch) {
      const auth2 = await checkAuth(request, env)
      if (auth2 instanceof Response) return auth2
      return handleGetJob(request, env)
    }

    // ── Template CRUD + custom render — GET and DELETE allowed here ─────────
    const templatesMatch = path.match(/^\/templates(?:\/([^/]+))?$/)
    const renderMatch    = path.match(/^\/render\/([^/]+)$/)

    if (templatesMatch || renderMatch) {
      const auth2 = await checkAuth(request, env)
      if (auth2 instanceof Response) return auth2
      const keyId2 = (auth2 as AuthContext | null)?.keyId ?? 'anonymous'

      if (templatesMatch) {
        const tplId = templatesMatch[1]
        if (!tplId) {
          // /templates
          if (request.method === 'POST') return handleCreateTemplate(request, env, keyId2)
          if (request.method === 'GET')  return handleListTemplates(env, keyId2)
          return new Response('Method Not Allowed', { status: 405 })
        } else {
          // /templates/:id
          if (request.method === 'GET')    return handleGetTemplate(env, keyId2, tplId)
          if (request.method === 'DELETE') return handleDeleteTemplate(env, keyId2, tplId)
          return new Response('Method Not Allowed', { status: 405 })
        }
      }

      if (renderMatch) {
        // POST /render/:templateId
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
        return handleCustomRender(request, env, keyId2, renderMatch[1])
      }
    }

    // ── POST /brand/extract — pre-flight brand color extraction ───────────
    if (path === '/brand/extract' && request.method === 'POST') {
      const auth2 = await checkAuth(request, env)
      if (auth2 instanceof Response) return auth2

      let body: { url?: string } = {}
      try { body = await request.json() } catch { /* ok */ }
      if (!body?.url) {
        return new Response(JSON.stringify({ error: 'url is required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }

      const result = await extractBrandColor(body.url, env.API_KEYS)
      const status = result.source === 'failed' ? 422 : 200
      return new Response(JSON.stringify({
        color:  result.color || null,
        source: result.source,
        url:    body.url,
      }), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'X-Color-Source': result.source,
        },
      })
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    // ── Auth + rate limit ──────────────────────────────────────────────────
    const auth = await checkAuth(request, env)
    if (auth instanceof Response) return auth  // 401 or 429
    const keyId = (auth as AuthContext | null)?.keyId ?? 'anonymous'

    const t0 = Date.now()
    let response: Response

    // ── Route ──────────────────────────────────────────────────────────────
    if (path === '/parse-prompt') {
      response = await handleParsePrompt(request, env)

    } else if (path === '/render-carousel') {
      response = await handleCarousel(request, env)

    } else if (path === '/render-animated') {
      response = await handleAnimated(request, env)

    } else if (path === '/render-feed') {
      response = await handleFeed(request, env)

    } else if (path === '/compliance-check') {
      response = await handleComplianceCheck(request, env)

    } else if (path === '/render-collection') {
      response = await handleCollection(request, env, keyId)

    } else if (path === '/jobs') {
      response = await handleCreateJob(request, env, keyId, ctx)

    } else {
      // Single-card render — path-agnostic (/ or /render both work)
      const bodyText = await request.text()
      response = await handleSingleRender(request, env, bodyText)
    }

    // ── Structured observability log ───────────────────────────────────────
    console.log(JSON.stringify({
      event:       'render',
      path,
      keyId,
      status:      response.status,
      latencyMs:   Date.now() - t0,
      contentType: response.headers.get('Content-Type') ?? '',
      cacheHit:    response.headers.get('X-Cache')      ?? 'NA',
      cdnKey:      response.headers.get('X-R2-Key')     ?? '',
    }))

    return withCors(response)
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 2 * * *') {
      ctx.waitUntil(
        Promise.all(
          Array.from({ length: SHARD_COUNT }, async (_, i) => {
            const stub = env.SATORI_DO.get(env.SATORI_DO.idFromName(`shard-${i}`))
            try {
              const res = await stub.fetch(new Request(`https://internal/evict`, { method: 'POST' }))
              const { deletedImages, deletedFonts } = await res.json<{ deletedImages: number; deletedFonts: number }>()
              console.log(`[evict] shard-${i}: ${deletedImages} images, ${deletedFonts} font subsets deleted`)
            } catch (e) {
              console.warn(`[evict] shard-${i}:`, e)
            }
          })
        )
      )
    } else {
      ctx.waitUntil(
        Promise.all(
          Array.from({ length: SHARD_COUNT }, (_, i) => {
            const stub = env.SATORI_DO.get(env.SATORI_DO.idFromName(`shard-${i}`))
            return stub.fetch(new Request('https://internal/render', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: WARM_PAYLOAD,
            })).catch(e => console.warn(`[keep-warm] shard-${i}:`, e))
          })
        )
      )
    }
  },
}
