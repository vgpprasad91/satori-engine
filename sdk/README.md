# mailcraft-satori

Official Node.js/TypeScript SDK for the **mailcraft-satori** image rendering API.

- **127 variants** — social cards, ad creatives, OG images, and more
- **24 format presets** — Instagram, Facebook, Twitter, YouTube, LinkedIn, Pinterest…
- **9 aesthetic registers** — Modern, Editorial, Luxury, Brutalist, Glassmorphism…
- **Custom templates** — bring your own Satori JSX tree with `{{token}}` placeholders
- Works in **Node.js 18+** and modern **browsers**

---

## Install

```bash
npm install mailcraft-satori
```

---

## Quick start

```typescript
import { SatoriClient } from 'mailcraft-satori'
import fs from 'fs'

const client = new SatoriClient({ apiKey: 'your-api-key' })

// Render a single card → PNG bytes
const png = await client.render({
  variant:      'stat-hero',
  headline:     '10× Revenue Growth',
  subheadline:  'In just 90 days',
  stat:         '$4.2M ARR',
  brandName:    'Acme Corp',
  primaryColor: '#6C63FF',
  preset:       'instagram-square',
  aesthetic:    'modern-sans',
})

fs.writeFileSync('output.png', png)
```

---

## API reference

### `new SatoriClient(config)`

| Option    | Type     | Default                                            | Description              |
|-----------|----------|----------------------------------------------------|--------------------------|
| `apiKey`  | `string` | required                                           | Your API key             |
| `baseUrl` | `string` | `https://mailcraft-satori.vguruprasad91.workers.dev` | API base URL             |
| `timeout` | `number` | `30000`                                            | Request timeout (ms)     |
| `retries` | `number` | `2`                                                | Auto-retry on net errors |

---

### Render methods

#### `client.render(opts)` → `Promise<Uint8Array>`

Render a card and get raw PNG/WebP bytes.

```typescript
const png = await client.render({
  variant:      'editorial-hero',
  headline:     'Summer Collection 2026',
  brandName:    'LUXE',
  primaryColor: '#C9A84C',
  preset:       'instagram-story',
  aesthetic:    'luxury',
  logoUrl:      'https://yoursite.com/logo.png',
})
```

#### `client.renderDataUri(opts)` → `Promise<string>`

Same as `render()` but returns a `data:image/png;base64,...` string — useful for embedding in HTML or email templates.

```typescript
const dataUri = await client.renderDataUri({ ... })
// <img src={dataUri} />
```

#### `client.renderCarousel(slides, format?)` → `Promise<string[]>`

Render multiple slides in one request. Returns an array of base64 data URIs.

```typescript
const slides = await client.renderCarousel([
  { headline: 'Feature 1', brandName: 'Acme', primaryColor: '#6C63FF' },
  { headline: 'Feature 2', brandName: 'Acme', primaryColor: '#6C63FF' },
  { headline: 'Feature 3', brandName: 'Acme', primaryColor: '#6C63FF' },
], 'instagram-square')
```

#### `client.renderCollection({ brandKit, formats })` → `Promise<RenderCollectionResponse>`

One brand kit payload → all format presets at once.

```typescript
const result = await client.renderCollection({
  brandKit: {
    headline:     'Summer Sale — Up to 50% Off',
    brandName:    'Shop',
    primaryColor: '#FF6B6B',
    ctaText:      'Shop Now',
  },
  formats: [
    { preset: 'instagram-square' },
    { preset: 'instagram-story' },
    { preset: 'facebook-linkedin' },
    { preset: 'twitter-x' },
    { preset: 'youtube-thumbnail' },
    { preset: 'pinterest' },
  ],
})

// result.slides[0].image → 'data:image/png;base64,...'
// result.slides[0].preset → 'instagram-square'
// result.slides[0].width  → 1080
// result.slides[0].height → 1080
```

---

### Async jobs

For long renders or webhook delivery:

```typescript
// Create job
const job = await client.createJob({
  headline:    'Product Launch',
  brandName:   'Acme',
  primaryColor: '#6C63FF',
  webhookUrl:  'https://yoursite.com/hooks/satori',  // optional
})

// Wait for completion (polls automatically)
const done = await client.waitForJob(job.jobId)
console.log(done.resultUrl)  // CDN URL to rendered PNG

// Or poll manually
const status = await client.getJob(job.jobId)
```

---

### Custom templates

Build reusable Satori JSX trees with `{{token}}` placeholders:

```typescript
// Create template once
await client.createTemplate({
  id:     'welcome-card',
  name:   'Welcome Card',
  width:  1200,
  height: 628,
  tokens: {
    name:       { type: 'text',  description: 'Recipient first name' },
    company:    { type: 'text',  description: 'Company name' },
    accentColor:{ type: 'color', description: 'Accent color', default: '#6C63FF' },
    logoUrl:    { type: 'image', description: 'Logo URL' },
  },
  tree: {
    type: 'div',
    props: {
      style: {
        display:    'flex',
        width:      '100%',
        height:     '100%',
        background: '{{accentColor}}',
        alignItems: 'center',
        padding:    '48px',
      },
      children: [
        {
          type: 'img',
          props: { src: '{{logoUrl}}', style: { width: 80, height: 80 } },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', marginLeft: 32 },
            children: [
              { type: 'div', props: { style: { fontSize: 48, color: 'white' }, children: 'Welcome, {{name}}!' } },
              { type: 'div', props: { style: { fontSize: 24, color: 'rgba(255,255,255,0.8)' }, children: '{{company}}' } },
            ],
          },
        },
      ],
    },
  },
})

// Render with values
const png = await client.renderTemplate('welcome-card', {
  values: {
    name:        'Alice',
    company:     'Acme Corp',
    accentColor: '#FF6B6B',
    logoUrl:     'https://yoursite.com/logo.png',
  },
})
```

Manage templates:

```typescript
const templates = await client.listTemplates()
const tpl       = await client.getTemplate('welcome-card')
await client.deleteTemplate('welcome-card')
```

---

### Compliance checking

```typescript
const result = await client.checkCompliance(1200, 628, 'meta')
// result.pass            → true/false
// result.recommendations → ['...']
// result.checks          → { size: { pass: true, details: '...' }, ... }

const platforms = await client.detectPlatforms(1200, 628)
// → ['meta/instagram', 'google-display', 'linkedin', 'twitter/x']
```

---

### Discovery

```typescript
// All 127 variants
const variants = await client.listVariants()
// → [{ name: 'stat-hero', label: 'Stat Hero', category: 'Core' }, ...]

// All 24 presets
const presets = await client.listPresets()
// → [{ name: 'instagram-square', width: 1080, height: 1080, label: 'Instagram Square' }, ...]
```

---

## Variants

| Category | Variants |
|----------|---------|
| Core | stat-hero, feature-split, announcement, quote-overlay, benefit-strip, recipe-hero, tip-card, editorial-hero |
| Ad Creative | product-showcase, coupon-offer, testimonial, event-card, video-thumbnail |
| E-commerce | product-shot, price-drop, new-arrival, flash-deal, before-after, pricing-card |
| Real Estate | property-listing, open-house, sold-announcement |
| SaaS/Tech | feature-launch, changelog, waitlist-signup, app-screenshot, job-posting |
| Fitness | transformation, class-schedule |
| Education | course-launch, certification |
| Finance | market-update, rate-announcement, crypto-price, portfolio-snapshot, savings-goal |
| Media/Entertainment | spotify-now-playing, album-art, movie-poster, music-release, twitch-banner, youtube-stats, soundcloud-track, live-stream-alert, podcast-stats, podcast-cover |
| Social/Developer | tweet-card, linkedin-article, product-hunt, reddit-post, instagram-quote, tiktok-caption, discord-announcement, github-stats, npm-package, api-status, code-snippet, status-page, release-notes |
| Business | receipt-card, business-card, qr-code-card, team-member, org-announcement, invoice-summary, proposal-cover, award-badge, trust-badge |
| Sports/Gaming | sports-score, sports-player, sports-schedule, leaderboard-card, gaming-achievement, esports-match |
| Content/Publishing | newsletter-header, book-cover, magazine-cover, blog-post-card, infographic-stat, press-release, case-study |
| Reviews | google-review, star-rating, nps-score, social-proof, testimonial |
| Lifestyle | cocktail-recipe, workout-plan, travel-destination, nutrition-facts, habit-tracker, health-metrics, appointment-card |
| Events | birthday-card, wedding-card, holiday-greeting, rsvp-card, countdown-timer |
| Gifts/Loyalty | gift-card, loyalty-card, referral-card |
| Automotive | car-listing, vehicle-specs, dealership-ad, test-drive-cta |
| Fashion | lookbook-card, ootd-card, style-drop, fashion-sale |
| NFT/Web3 | nft-showcase, mint-announcement, dao-proposal, token-launch, web3-stats |
| Non-profit | donation-progress, impact-stats, charity-appeal, volunteer-cta |
| Interior Design | room-reveal, project-showcase, material-moodboard, design-consultation |
| HR/Culture | employee-spotlight, company-benefits, culture-stats, open-roles, team-culture |

---

## Errors

All API errors throw a `SatoriError` with `.status` (HTTP status code) and `.body.error` (message).

```typescript
import { SatoriClient, SatoriError } from 'mailcraft-satori'

try {
  const png = await client.render({ ... })
} catch (err) {
  if (err instanceof SatoriError) {
    console.error(err.status, err.message)
  }
}
```

---

## License

MIT
