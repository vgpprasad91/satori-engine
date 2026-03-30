# Satori Engine

Satori-based image rendering engine for generating social cards, OG images, ad creatives, and more. Runs on Cloudflare Workers.

## Architecture

This monorepo contains three packages:

| Package | Description |
|---------|-------------|
| **`renderer/`** | Cloudflare Worker that renders images using Satori + resvg WASM. 127 variants, 9 aesthetic registers, 24 format presets. |
| **`sdk/`** | Node.js/TypeScript SDK (`mailcraft-satori`) for calling the renderer API. Dual CJS/ESM build. |
| **`shopify-app/`** | Shopify App (Remix + Cloudflare Workers) that integrates the Satori renderer for merchants. |

## Quick Start

```bash
# Install all dependencies
npm install

# Run the renderer locally
npm run dev:renderer

# Run the Shopify app locally
npm run dev:shopify

# Build the SDK
npm run build:sdk
```

## Deploying

```bash
# Deploy the renderer Worker
npm run deploy:renderer

# Deploy the Shopify app (staging)
cd shopify-app && npm run deploy:staging
```

## Renderer API

The renderer accepts POST requests with a JSON body specifying variant, colors, text, and options. Returns PNG/JPEG/WebP images.

See `sdk/README.md` for the full API reference and usage examples.

## Fonts

The renderer ships with these font families in `renderer/fonts/`:

- **Inter** (400, 700, 800, 900) — modern sans-serif
- **Playfair Display** (400 normal/italic) — editorial serif
- **Cormorant Garamond** (400 normal/italic, 600 normal/italic) — luxury serif
- **Dancing Script** (400, 700) — warm script
- **Bebas Neue** (400) — bold condensed

## License

MIT
