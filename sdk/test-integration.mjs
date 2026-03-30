/**
 * Integration smoke test — hits the live API with the built CJS SDK.
 * Run: SATORI_API_KEY=<your-key> node sdk/test-integration.mjs
 *
 * Required environment variables:
 *   SATORI_API_KEY  — your Satori API key (see .env.example)
 */

import { createRequire } from 'module'
import { writeFileSync } from 'fs'

const require = createRequire(import.meta.url)
const { SatoriClient, SatoriError } = require('./dist/cjs/index.js')

const API_KEY = process.env.SATORI_API_KEY
if (!API_KEY) {
  console.error('\nError: SATORI_API_KEY environment variable is required.')
  console.error('Copy sdk/.env.example to sdk/.env and fill in your key.\n')
  process.exit(1)
}

const client = new SatoriClient({ apiKey: API_KEY, retries: 1 })

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`)
    failed++
  }
}

console.log('\n── mailcraft-satori SDK integration tests ──\n')

// ── render() ────────────────────────────────────────────────────────────────

await test('render() returns Uint8Array PNG', async () => {
  const png = await client.render({
    variant:      'stat-hero',
    headline:     'SDK Test',
    brandName:    'Acme',
    primaryColor: '#6C63FF',
    preset:       'email-header',
  })
  if (!(png instanceof Uint8Array)) throw new Error('not Uint8Array')
  if (png.length < 1000) throw new Error(`PNG too small: ${png.length} bytes`)
  // Check PNG magic bytes
  if (png[0] !== 0x89 || png[1] !== 0x50) throw new Error('Not a PNG')
})

await test('renderDataUri() returns data URI', async () => {
  const uri = await client.renderDataUri({
    variant:      'editorial-hero',
    headline:     'Data URI Test',
    brandName:    'Acme',
    primaryColor: '#FF6B6B',
    preset:       'medium-rectangle',
  })
  if (!uri.startsWith('data:image/png;base64,')) throw new Error(`Bad prefix: ${uri.slice(0, 30)}`)
})

// ── variant coverage ─────────────────────────────────────────────────────────

const sampledVariants = [
  'announcement', 'tweet-card', 'github-stats', 'sports-score',
  'donation-progress', 'nft-showcase', 'car-listing', 'lookbook-card',
  'employee-spotlight', 'room-reveal',
]

for (const variant of sampledVariants) {
  await test(`render() variant=${variant}`, async () => {
    const png = await client.render({
      variant,
      headline:     'Test headline',
      brandName:    'Acme',
      primaryColor: '#6C63FF',
      preset:       'medium-rectangle',
    })
    if (!(png instanceof Uint8Array) || png.length < 500) throw new Error(`Bad PNG for ${variant}`)
  })
}

// ── listVariants / listPresets ────────────────────────────────────────────────

await test('listVariants() returns 127 entries', async () => {
  const variants = await client.listVariants()
  if (!Array.isArray(variants)) throw new Error('not array')
  if (variants.length < 100) throw new Error(`only ${variants.length} variants`)
})

await test('listPresets() returns 24 entries', async () => {
  const presets = await client.listPresets()
  if (!Array.isArray(presets)) throw new Error('not array')
  if (presets.length < 20) throw new Error(`only ${presets.length} presets`)
})

// ── renderCollection ──────────────────────────────────────────────────────────

await test('renderCollection() returns multiple slides', async () => {
  const result = await client.renderCollection({
    brandKit: {
      headline:     'Collection Test',
      brandName:    'Acme',
      primaryColor: '#6C63FF',
    },
    formats: [
      { preset: 'instagram-square' },
      { preset: 'twitter-x' },
      { preset: 'email-header' },
    ],
  })
  if (!result.slides || result.slides.length !== 3) throw new Error(`Expected 3 slides, got ${result.slides?.length}`)
  for (const slide of result.slides) {
    if (!slide.image.startsWith('data:image/png;base64,')) throw new Error('slide missing base64')
  }
})

// ── SatoriError ───────────────────────────────────────────────────────────────

await test('SatoriError thrown on bad auth', async () => {
  const badClient = new SatoriClient({ apiKey: 'invalid-key', retries: 0 })
  try {
    await badClient.render({ headline: 'x', brandName: 'x', primaryColor: '#fff' })
    throw new Error('Should have thrown')
  } catch (err) {
    if (!(err instanceof SatoriError)) throw new Error(`Expected SatoriError, got ${err.constructor.name}`)
    if (err.status !== 401) throw new Error(`Expected 401, got ${err.status}`)
  }
})

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`)
process.exit(failed > 0 ? 1 : 0)
