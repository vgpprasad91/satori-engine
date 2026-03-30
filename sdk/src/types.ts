/**
 * mailcraft-satori SDK — Type definitions
 * Full TypeScript support for all 127 variants, 24 presets, 9 aesthetics.
 */

// ── Variants ──────────────────────────────────────────────────────────────────

export type CardVariantName =
  // Core
  | 'stat-hero' | 'feature-split' | 'announcement'
  | 'quote-overlay' | 'benefit-strip'
  | 'recipe-hero' | 'tip-card' | 'editorial-hero'
  // Ad creative
  | 'product-showcase' | 'coupon-offer' | 'testimonial'
  | 'event-card' | 'video-thumbnail'
  // Extended
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
  // Media/Entertainment
  | 'spotify-now-playing' | 'album-art' | 'movie-poster' | 'music-release'
  | 'twitch-banner' | 'youtube-stats' | 'soundcloud-track' | 'live-stream-alert' | 'podcast-stats'
  // Social/Tech/Developer
  | 'tweet-card' | 'linkedin-article' | 'product-hunt' | 'reddit-post'
  | 'instagram-quote' | 'tiktok-caption' | 'discord-announcement' | 'github-stats'
  | 'npm-package' | 'api-status' | 'code-snippet' | 'status-page' | 'release-notes'
  // Business/Sports/Gaming
  | 'receipt-card' | 'business-card' | 'qr-code-card' | 'team-member'
  | 'org-announcement' | 'invoice-summary' | 'proposal-cover'
  | 'sports-score' | 'sports-player' | 'sports-schedule' | 'leaderboard-card'
  | 'gaming-achievement' | 'esports-match' | 'award-badge' | 'trust-badge'
  // Content/Publishing/Reviews
  | 'newsletter-header' | 'book-cover' | 'magazine-cover' | 'blog-post-card'
  | 'infographic-stat' | 'press-release' | 'google-review' | 'star-rating'
  | 'nps-score' | 'case-study' | 'gift-card' | 'loyalty-card'
  // Lifestyle/Health/Events/Finance
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

// ── Format Presets ────────────────────────────────────────────────────────────

export type FormatPreset =
  | 'instagram-square'     // 1080×1080
  | 'instagram-story'      // 1080×1920
  | 'facebook-linkedin'    // 1200×628
  | 'twitter-x'            // 1200×675
  | 'leaderboard'          // 728×90
  | 'medium-rectangle'     // 300×250
  | 'half-page'            // 300×600
  | 'youtube-thumbnail'    // 1280×720
  | 'email-header'         // 600×200
  | 'pinterest'            // 1000×1500
  | 'wide-skyscraper'      // 160×600
  | 'large-mobile-banner'  // 320×100
  | 'billboard'            // 970×250
  | 'large-leaderboard'    // 970×90
  | 'og-image'             // 1200×628
  | 'twitter-card'         // 1200×628
  | 'linkedin-post'        // 1200×627
  | 'facebook-feed'        // 1200×628
  | 'facebook-cover'       // 820×312
  | 'twitter-header'       // 1500×500
  | 'linkedin-cover'       // 1584×396
  | 'spotify-cover'        // 3000×3000
  | 'tiktok-video'         // 1080×1920
  | 'display-interstitial' // 320×480

// ── Aesthetics ────────────────────────────────────────────────────────────────

export type AestheticRegister =
  | 'modern-sans'       // Inter — clean, versatile (default)
  | 'editorial-serif'   // Playfair Display italic — magazine/editorial
  | 'luxury'            // Cormorant Garamond — high-end fashion/hospitality
  | 'warm-script'       // Dancing Script — artisan/creator economy
  | 'bold-condensed'    // Bebas Neue — fitness/sport/streetwear
  | 'brutalist'         // high contrast, heavy weight
  | 'glassmorphism'     // frosted glass, translucency
  | 'retro'             // vintage vibes
  | 'minimalist-luxury' // whitespace-heavy, refined

// ── Card Options ──────────────────────────────────────────────────────────────

export interface CardOpts {
  variant?: CardVariantName
  headline: string
  subheadline?: string
  stat?: string
  brandName: string
  primaryColor: string          // hex, e.g. "#6C63FF"
  bgImageUrl?: string           // preferred: remote URL
  bgImageData?: string          // legacy: base64 data URI
  preset?: FormatPreset
  width?: number
  height?: number
  format?: 'png' | 'webp'
  aesthetic?: AestheticRegister

  /** Personalization tokens — {{key}} in text fields is replaced at render time. */
  tokens?: Record<string, string>

  // Brand kit
  logoUrl?: string
  brandFontUrl?: string
  brandFontFamily?: string

  // CTA
  ctaText?: string
  ctaColor?: string

  // Product/E-commerce
  price?: string
  originalPrice?: string
  badge?: string
  productCategory?: string
  stockCount?: number
  couponCode?: string
  expiryText?: string

  // Testimonial/Review
  reviewText?: string
  reviewerName?: string
  reviewerTitle?: string
  rating?: number

  // Event
  eventDate?: string
  eventTime?: string
  eventLocation?: string

  // Before/After
  beforeText?: string
  afterText?: string
  beforeLabel?: string
  afterLabel?: string

  // Pricing
  plans?: Array<{
    name: string
    price: string
    period?: string
    features?: string[]
    highlighted?: boolean
  }>

  // Social proof
  logos?: string[]
  tagline?: string

  // Countdown
  timerDays?: number
  timerHours?: number
  timerMins?: number
  timerSecs?: number

  // App
  appRating?: number
  appDownloads?: string

  // Job posting
  jobTitle?: string
  location?: string
  jobType?: string
  salary?: string
  skills?: string[]

  // Podcast
  episodeNumber?: string
  host?: string

  // Real estate
  propertyPrice?: string
  bedrooms?: number
  bathrooms?: number
  sqft?: string
  agentName?: string
  propertyAddress?: string

  // Fitness
  beforeStat?: string
  afterStat?: string
  duration?: string
  classTime?: string
  classDuration?: string
  instructor?: string
  classType?: string

  // Education
  courseName?: string
  courseLevel?: string
  lessonCount?: number
  studentCount?: string
  certificateName?: string
  recipientName?: string
  completionDate?: string

  // Finance
  ticker?: string
  priceChange?: string
  positive?: boolean
  interestRate?: string
  rateType?: string
  chartData?: number[]

  // Food & Beverage
  dishName?: string
  dishPrice?: string
  dietaryTags?: string[]
  prepTime?: string
  calories?: string

  // SaaS/Tech
  changelogItems?: string[]
  version?: string
  waitlistCount?: string
  launchDate?: string
  featureIcon?: string

  // Media/Entertainment
  spotifyTrack?: string
  spotifyArtist?: string
  spotifyProgress?: number
  streamViewers?: string
  releaseDate?: string
  genre?: string
  gameTitle?: string
  listens?: string
  trackCount?: number
  podcastEpisodes?: number
  podcastListeners?: string

  // Social/Developer
  tweetText?: string
  tweetHandle?: string
  tweetLikes?: string
  tweetRetweets?: string
  githubRepo?: string
  githubStars?: string
  githubForks?: string
  packageName?: string
  packageVersion?: string
  packageDownloads?: string
  statusItems?: Array<{ name: string; status: 'operational' | 'degraded' | 'outage' }>
  codeLanguage?: string
  codeLines?: string[]
  uptime?: string
  releaseVersion?: string
  releaseChanges?: string[]
  upvotes?: string
  comments?: string
  subreddit?: string

  // Business/Sports/Gaming
  teamA?: string
  teamB?: string
  scoreA?: string
  scoreB?: string
  matchStatus?: string
  leaderboardItems?: Array<{ rank: number; name: string; score: string; change?: 'up' | 'down' | 'same' }>
  invoiceNumber?: string
  invoiceAmount?: string
  invoiceDue?: string
  achievement?: string
  xpGained?: string
  playerSport?: string
  playerPosition?: string
  playerStats?: Array<{ label: string; value: string }>
  matchDate?: string
  matchVenue?: string
  phone?: string
  email?: string
  website?: string
  proposalClient?: string
  proposalValue?: string
  proposalDue?: string

  // Content/Publishing
  issueNumber?: string
  author?: string
  isbn?: string
  readTime?: string
  category?: string
  publishDate?: string
  reviewCount?: string
  reviewPlatform?: string
  npsScore?: number
  promoters?: number
  detractors?: number
  giftAmount?: string
  giftFrom?: string
  loyaltyPoints?: string
  loyaltyTier?: string
  caseStudyResult?: string
  caseStudyClient?: string

  // Lifestyle/Health/Events
  referralBonus?: string
  alcoholContent?: string
  servings?: string
  exercises?: Array<{ name: string; sets?: string; reps?: string }>
  habitItems?: Array<{ name: string; done: boolean }>
  cryptoSymbol?: string
  cryptoPrice?: string
  marketCap?: string
  portfolioValue?: string
  portfolioChange?: string
  savingsGoal?: string
  savedAmount?: string
  savingsProgress?: number
  steps?: string
  heartRate?: string
  sleepHours?: string
  appointmentType?: string
  appointmentTime?: string
  providerName?: string
  destination?: string
  travelDuration?: string
  travelPrice?: string
  rsvpDeadline?: string
  cocktailIngredients?: string[]

  // Automotive
  vehicleMake?: string
  vehicleModel?: string
  vehicleYear?: number
  vehicleMileage?: string
  vehicleEngine?: string
  vehicleColor?: string
  vehicleFeatures?: string[]
  vehicleCondition?: string

  // Fashion/Retail
  lookbookItems?: string[]
  styleTag?: string
  collection?: string
  sizes?: string[]
  material?: string
  colorways?: string[]

  // NFT/Web3
  nftName?: string
  nftPrice?: string
  nftEdition?: string
  blockchain?: string
  mintDate?: string
  totalSupply?: string
  floorPrice?: string
  holderCount?: string
  daoName?: string
  proposalId?: string
  tokenSymbol?: string
  tokenPrice?: string
  tokenChange?: string

  // Non-profit
  donationGoal?: string
  donationRaised?: string
  donationProgress?: number
  donorCount?: string
  impactStat?: string
  impactLabel?: string
  causeTag?: string
  volunteerCount?: string

  // Interior Design
  roomType?: string
  designStyle?: string
  projectBudget?: string
  projectDuration?: string
  materials?: string[]
  swatchColors?: string[]

  // HR/Culture
  employeeName?: string
  employeeYears?: string
  employeeDept?: string
  employeeQuote?: string
  benefits?: string[]
  openRoles?: number
  cultureStats?: Array<{ label: string; value: string }>

  /** Webhook URL for async render jobs. */
  webhookUrl?: string
}

// ── Collection / Async Jobs ───────────────────────────────────────────────────

export interface CollectionFormat {
  preset?: FormatPreset
  width?: number
  height?: number
  variant?: CardVariantName
}

export interface RenderCollectionRequest {
  brandKit: CardOpts
  formats: CollectionFormat[]
}

export interface CollectionSlide {
  variant?: string
  preset?: string
  width: number
  height: number
  image: string   // data:image/png;base64,...
  cdnUrl?: string // CDN URL if R2 cache hit
}

export interface RenderCollectionResponse {
  outputs: CollectionSlide[]
  count: number
  latencyMs?: number
  /** @deprecated use `outputs` */
  slides?: CollectionSlide[]
}

export interface CreateJobRequest extends CardOpts {
  webhookUrl?: string
}

export interface Job {
  jobId: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  createdAt: string
  completedAt?: string
  resultUrl?: string
  error?: string
}

// ── Template System ───────────────────────────────────────────────────────────

export interface TemplateToken {
  type: 'text' | 'image' | 'color' | 'number'
  description?: string
  default?: string | number
}

export interface CreateTemplateRequest {
  id: string
  name: string
  width: number
  height: number
  tokens: Record<string, TemplateToken>
  tree: Record<string, unknown>
}

export interface Template {
  id: string
  name: string
  width: number
  height: number
  tokens: Record<string, TemplateToken>
  tree: Record<string, unknown>
  createdAt: string
  keyId: string
}

export interface RenderTemplateRequest {
  values: Record<string, string | number>
  format?: 'png' | 'webp'
}

// ── Compliance ────────────────────────────────────────────────────────────────

export interface ComplianceCheck {
  pass: boolean
  details: string
  value?: number
}

export interface ComplianceResult {
  platform: string
  width: number
  height: number
  checks: Record<string, ComplianceCheck>
  pass: boolean
  recommendations: string[]
}

// ── Variants/Presets metadata ─────────────────────────────────────────────────

export interface VariantInfo {
  name: CardVariantName
  label: string
  category: string
  description?: string
}

export interface PresetInfo {
  name: FormatPreset
  width: number
  height: number
  label: string
}

// ── Client config ─────────────────────────────────────────────────────────────

export interface SatoriClientConfig {
  apiKey: string
  baseUrl?: string  // default: 'https://mailcraft-satori.vguruprasad91.workers.dev'
  timeout?: number  // ms, default: 30000
  retries?: number  // default: 2
}

// ── Error ─────────────────────────────────────────────────────────────────────

export interface SatoriAPIError {
  error: string
  status: number
}
