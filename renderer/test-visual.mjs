/**
 * Visual validation test — renders variants across 3 aspect classes and saves PNGs.
 *
 * Coverage: all 12 variant source files, including the 11 external files and all
 * remaining core variants.  Each variant is tested against both a dark brand and a
 * light brand to expose contrast failures on either end of the luminance spectrum.
 *
 * Run: node test-visual.mjs
 */
import { createRequire } from 'module'
import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'

const require = createRequire(import.meta.url)
const { SatoriClient } = require('./sdk/dist/cjs/index.js')

const API_KEY = '4a64ef407f7245d4411f53d4e96509c3d9501a62203af493cb05267581fe767f'
const CACHE_BUST = `v${Date.now()}`
const client = new SatoriClient({ apiKey: API_KEY, retries: 3, timeout: 45_000 })

const OUT = './temp/visual-validate'
mkdirSync(OUT, { recursive: true })

// 3 aspect classes covering portrait, square, and landscape extremes
const ASPECTS = [
  { name: 'story',     preset: 'instagram-story' },   // 9:16
  { name: 'square',    preset: 'instagram-square' },  // 1:1
  { name: 'cinematic', preset: 'twitter-x' },         // 1200×675
]

// ── Core variants (index.ts) ──────────────────────────────────────────────────
const CORE_VARIANTS = [
  // Dark-scrim with brandTop
  { variant: 'stat-hero',        headline: '10x Revenue Growth',   subheadline: 'Year-over-year performance for Q4 2025', stat: '10x' },
  { variant: 'announcement',     headline: 'Launching This Spring', subheadline: 'The product your workflow has been waiting for' },
  { variant: 'editorial-hero',   headline: 'The Future of Design',  subheadline: 'How AI is reshaping creative workflows in 2025' },
  // Light-panel variants — palette derivation fix (Gap 3)
  { variant: 'testimonial',      headline: 'This changed the way our entire team works together every single day', reviewerName: 'Alex Rivera', reviewerTitle: 'Head of Product, Acme', rating: 5 },
  { variant: 'feature-split',    headline: 'Built for Scale', subheadline: 'Enterprise-grade infrastructure with developer-first ergonomics' },
  { variant: 'tip-card',         headline: 'Write shorter subject lines — under 40 characters doubles open rates', subheadline: 'Email Marketing Tip #12' },
  { variant: 'quote-overlay',    headline: 'Design is not just what it looks like. Design is how it works.' },
  { variant: 'benefit-strip',    headline: 'Zero downtime deploys', subheadline: 'Atomic rollbacks, instant rollouts — always on.' },
  { variant: 'recipe-hero',      headline: 'Slow-Roasted Lamb Shoulder', subheadline: '4 hrs · Serves 6 · Mediterranean' },
  // Ad creative variants — CTA + price + contrast checks
  { variant: 'product-showcase', headline: 'The Minimal Sneaker', subheadline: 'Hand-stitched leather. Made to last.', price: '$189', ctaText: 'Shop Now' },
  { variant: 'coupon-offer',     headline: '30% Off Sitewide', subheadline: 'This weekend only', couponCode: 'SAVE30', expiryText: 'Expires Sun, midnight' },
  // event-card — specifically tests the Gap 1 badge contrast fix
  { variant: 'event-card',       headline: 'Product Launch Night', subheadline: 'Join us for an evening of demos', eventDate: 'Nov 14', eventTime: '7:00 PM', eventLocation: 'San Francisco, CA' },
  { variant: 'video-thumbnail',  headline: 'We rebuilt our entire infrastructure in 6 weeks', subheadline: 'Full story', stat: '18:42', ctaText: 'Watch Now' },
]

// ── variants-media.ts ─────────────────────────────────────────────────────────
const MEDIA_VARIANTS = [
  { variant: 'spotify-now-playing', headline: 'Midnight Rain', brandName: 'Taylor Swift', spotifyTrack: 'Midnight Rain', spotifyArtist: 'Taylor Swift', spotifyProgress: 62 },
  { variant: 'youtube-stats',       headline: 'We hit 1 Million Subscribers!', subheadline: 'Thank you for the incredible journey' },
  { variant: 'podcast-cover',       headline: 'The Growth Lab', subheadline: 'Building great products from zero', episodeNumber: 'EP. 47', host: 'Sarah Chen' },
  { variant: 'movie-poster',        headline: 'Echoes of Tomorrow', subheadline: 'In theatres March 2026' },
  { variant: 'live-stream-alert',   headline: 'Going LIVE: Full product walkthrough', subheadline: 'Starting in 10 minutes', streamViewers: '3.2K' },
]

// ── variants-social.ts ────────────────────────────────────────────────────────
const SOCIAL_VARIANTS = [
  { variant: 'tweet-card',          headline: 'We just shipped the feature you\'ve been asking for since day one.', tweetHandle: '@mailcraft', tweetLikes: '4.2K', tweetRetweets: '891' },
  { variant: 'github-stats',        headline: 'mailcraft/satori-renderer', githubRepo: 'mailcraft/satori-renderer', githubStars: '12.4k', githubForks: '847' },
  { variant: 'code-snippet',        headline: 'Rendering cards at the edge', codeLanguage: 'TypeScript', codeLines: ['const png = await client.render({', '  variant: "stat-hero",', '  headline: "10x Growth",', '  primaryColor: "#0F3460",', '})'] },
  { variant: 'linkedin-article',    headline: 'Why I stopped using feature flags for everything', subheadline: 'A pragmatic guide to progressive rollouts' },
  { variant: 'discord-announcement', headline: 'v2.0 is live — 40 new variants, edge rendering, brand URL auto-extract' },
]

// ── variants-business.ts ──────────────────────────────────────────────────────
const BUSINESS_VARIANTS = [
  { variant: 'business-card',      headline: 'Jordan Lee', subheadline: 'Head of Design', phone: '+1 415 555 0147', email: 'jordan@mailcraft.io', website: 'mailcraft.io' },
  { variant: 'sports-score',       headline: 'Championship Final', teamA: 'Hawks', teamB: 'Lions', scoreA: '3', scoreB: '2', matchStatus: 'FT' },
  { variant: 'gaming-achievement', headline: 'Legendary Rank Unlocked', subheadline: 'Season 12 — Top 0.1%', achievement: 'Diamond I', xpGained: '+1250 XP' },
  { variant: 'proposal-cover',     headline: 'Digital Transformation Proposal', proposalClient: 'Acme Corp', proposalValue: '$48,000', proposalDue: 'Due Dec 1' },
  { variant: 'award-badge',        headline: 'Best Developer Tool 2025', subheadline: 'Product Hunt — #1 of the Day' },
]

// ── variants-content.ts ───────────────────────────────────────────────────────
const CONTENT_VARIANTS = [
  { variant: 'newsletter-header',  headline: 'The Weekly Craft', subheadline: 'Design, code, and product — every Thursday', issueNumber: 'Issue #92', author: 'The Mailcraft Team' },
  { variant: 'book-cover',         headline: 'The Art of Quiet Confidence', subheadline: 'A guide to leading without ego', author: 'Morgan Blake', isbn: '978-0-00-000000-0' },
  { variant: 'google-review',      headline: 'Best email builder I\'ve ever used — period.', reviewerName: 'Sam T.', reviewerTitle: 'Verified Buyer', reviewPlatform: 'Google', rating: 5 },
  { variant: 'blog-post-card',     headline: 'The hidden cost of over-engineering', subheadline: '8 min read', readTime: '8 min read', category: 'Engineering', publishDate: 'Nov 2025' },
  { variant: 'press-release',      headline: 'Mailcraft raises $4.2M seed to bring brand-aware card rendering to every developer' },
]

// ── variants-lifestyle.ts ─────────────────────────────────────────────────────
const LIFESTYLE_VARIANTS = [
  { variant: 'travel-destination', headline: 'Kyoto in Cherry Blossom Season', subheadline: 'The trip worth planning a year for', destination: 'Kyoto, Japan', travelDuration: '10 nights', travelPrice: 'From $2,400' },
  { variant: 'cocktail-recipe',    headline: 'Yuzu Whisky Sour', subheadline: 'Citrus-forward, perfectly balanced', cocktailIngredients: ['2oz Whisky', '0.75oz Yuzu', '0.5oz Simple Syrup', 'Egg white'], alcoholContent: 'ABV ~18%', servings: 'Serves 1' },
  { variant: 'health-metrics',     headline: 'Tuesday Recovery', subheadline: 'Recovery score: 84 — looking strong', steps: '9,214', heartRate: '68 bpm', sleepHours: '7h 42m' },
  { variant: 'savings-goal',       headline: 'Emergency Fund Progress', subheadline: 'On track for June 2026', savingsGoal: '$10,000', savedAmount: '$7,340', savingsProgress: 73 },
  { variant: 'birthday-card',      headline: 'Happy Birthday, Alex!', subheadline: 'Wishing you a wonderful year ahead' },
]

// ── variants-automotive.ts ────────────────────────────────────────────────────
const AUTOMOTIVE_VARIANTS = [
  { variant: 'car-listing',        headline: '2024 Tesla Model 3 Long Range', vehicleMake: 'Tesla', vehicleModel: 'Model 3 Long Range', vehicleYear: 2024, vehicleMileage: '8,200 miles', vehicleFeatures: ['Autopilot', 'Glass Roof', 'AWD'], price: '$39,900', vehicleCondition: 'Certified Pre-Owned' },
  { variant: 'test-drive-cta',     headline: 'Experience the Drive of a Lifetime', subheadline: 'Book your 30-minute test drive today', ctaText: 'Book Now' },
]

// ── variants-fashion.ts ───────────────────────────────────────────────────────
const FASHION_VARIANTS = [
  { variant: 'lookbook-card',      headline: 'Spring Collection 2025', subheadline: 'Effortless everyday luxury' },
  { variant: 'style-drop',         headline: 'The Midnight Capsule', collection: 'Midnight Capsule', badge: 'Limited Edition', ctaText: 'Shop the Drop' },
  { variant: 'fashion-sale',       headline: 'End of Season Sale', badge: '-40%', originalPrice: '$320', price: '$192', sizes: ['XS','S','M','L','XL'], ctaText: 'Shop Sale' },
]

// ── variants-web3.ts ──────────────────────────────────────────────────────────
const WEB3_VARIANTS = [
  { variant: 'nft-showcase',       headline: 'Genesis Collection', subheadline: 'Limited edition digital art — only 1000 minted', nftPrice: '2.5 ETH', nftEdition: '1 of 1000', blockchain: 'Ethereum' },
  { variant: 'token-launch',       headline: 'CRAFT Token Launch', subheadline: 'Community-owned email infrastructure', tokenSymbol: 'CRAFT', tokenPrice: '$0.042', tokenChange: '+18.4%', totalSupply: '100M' },
  { variant: 'dao-proposal',       headline: 'Proposal #247: Increase grants budget by 20%', daoName: 'MailcraftDAO', proposalId: '#247' },
]

// ── variants-nonprofit.ts ─────────────────────────────────────────────────────
const NONPROFIT_VARIANTS = [
  { variant: 'donation-progress',  headline: 'Help us reach $500K for clean water access', subheadline: '$412,000 raised — 82% of goal', donationGoal: '$500,000', donationRaised: '$412,000', donationProgress: 82, donorCount: '3,241 donors' },
  { variant: 'impact-stats',       headline: '10,000 children received clean water this month', impactStat: '10,000+', impactLabel: 'children served', causeTag: 'Clean Water' },
  { variant: 'charity-appeal',     headline: 'Your $10 provides a week of meals for a child in need', subheadline: 'Together we can end childhood hunger', ctaText: 'Donate Now' },
]

// ── variants-interior.ts ──────────────────────────────────────────────────────
const INTERIOR_VARIANTS = [
  { variant: 'room-reveal',        headline: 'Scandinavian Living Room Transformation', subheadline: 'Minimal palette meets warm textures', roomType: 'Living Room', designStyle: 'Scandinavian' },
  { variant: 'project-showcase',   headline: 'Tribeca Loft Renovation', subheadline: 'Industrial raw materials + Japandi restraint', roomType: 'Open-plan Loft', projectBudget: '$85,000', projectDuration: '14 weeks' },
  { variant: 'material-moodboard', headline: 'The Warm Minimalist Palette', subheadline: 'Oak, linen, stone, and brass', designStyle: 'Warm Minimalist' },
]

// ── variants-hrculture.ts ─────────────────────────────────────────────────────
const HR_VARIANTS = [
  { variant: 'employee-spotlight', headline: 'Sarah Chen joins as VP of Engineering', subheadline: 'Bringing 12 years of distributed systems experience', employeeName: 'Sarah Chen', employeeDept: 'Engineering', employeeYears: '0 years' },
  { variant: 'company-benefits',   headline: 'We take care of our people', subheadline: 'Benefits that actually make a difference', benefits: ['Remote First', 'Unlimited PTO', '401k Match 4%', 'Learning Budget $2k/yr', 'Full Health Coverage'] },
  { variant: 'open-roles',         headline: 'We\'re hiring across the board', subheadline: '12 open roles — join us in building the future', openRoles: 12 },
]

// ── Combine all variants ──────────────────────────────────────────────────────
const ALL_VARIANTS = [
  ...CORE_VARIANTS,
  ...MEDIA_VARIANTS,
  ...SOCIAL_VARIANTS,
  ...BUSINESS_VARIANTS,
  ...CONTENT_VARIANTS,
  ...LIFESTYLE_VARIANTS,
  ...AUTOMOTIVE_VARIANTS,
  ...FASHION_VARIANTS,
  ...WEB3_VARIANTS,
  ...NONPROFIT_VARIANTS,
  ...INTERIOR_VARIANTS,
  ...HR_VARIANTS,
]

// Two contrasting brand colors:
//   dark  (#0F3460) — finance navy, lum≈0.026 → badge/CTA text should be white
//   light (#E8A598) — salmon pink, lum≈0.370 → badge/CTA text should be dark (#111111)
const BRANDS = [
  { brandName: 'Meridian Capital', primaryColor: '#0F3460', label: 'dark-brand' },
  { brandName: 'Bloom Studio',     primaryColor: '#E8A598', label: 'light-brand' },
]

let saved = 0
let failed = 0

console.log(`Running ${ALL_VARIANTS.length} variants × ${ASPECTS.length} aspects × ${BRANDS.length} brands = ${ALL_VARIANTS.length * ASPECTS.length * BRANDS.length} renders\n`)

for (const brand of BRANDS) {
  for (const aspect of ASPECTS) {
    for (const v of ALL_VARIANTS) {
      const opts = {
        ...v,
        brandName:    v.brandName    ?? brand.brandName,
        primaryColor: brand.primaryColor,
        preset:       aspect.preset,
        tokens:       { _cb: CACHE_BUST },
      }
      const fname = `${v.variant}__${aspect.name}__${brand.label}.png`
      try {
        const bytes = await client.render(opts)
        writeFileSync(path.join(OUT, fname), bytes)
        console.log(`  ✅ ${fname} (${bytes.length} bytes)`)
        saved++
      } catch (err) {
        console.error(`  ❌ ${fname}: ${err.message}`)
        failed++
      }
    }
  }
}

console.log(`\nDone: ${saved} saved, ${failed} failed → ${OUT}`)
console.log(`Coverage: ${ALL_VARIANTS.length} variants across all 12 source files`)
