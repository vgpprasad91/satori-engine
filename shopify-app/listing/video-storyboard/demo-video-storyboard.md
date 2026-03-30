# MailCraft — 45-Second Demo Video Storyboard

**File**: `listing/demo-video-storyboard.md`
**Target output**: `listing/demo-45s.mp4` (1920×1080, 30fps, H.264)

---

## Scene 1 — Install (0:00–0:08)

**Screen**: Shopify App Store listing for MailCraft Image Generator
**Action**: Mouse cursor clicks "Add app" → OAuth permissions screen → "Install app"
**Caption overlay**: "Install in seconds from the Shopify App Store"
**Audio**: Upbeat background music, fade in

---

## Scene 2 — Brand Kit Setup (0:08–0:18)

**Screen**: Onboarding wizard Step 1
**Action**:
1. Click "Upload Logo" → file picker → select `demoshop-logo.png`
2. Click color picker → type `#6366F1` → confirm
3. Select font "Inter" from dropdown
4. Click "Next"

**Caption overlay**: "Set up your brand in under 2 minutes"
**UI elements visible**: Polaris progress steps (Step 1 of 3 highlighted)

---

## Scene 3 — Template Selection (0:18–0:28)

**Screen**: Onboarding wizard Step 2
**Action**:
1. Scroll through 8 template cards (product-card, sale-announcement, new-arrival, story-format, landscape-post, square-post, price-drop, seasonal)
2. Click "Product Card" → live preview panel updates with brand indigo + DemoShop logo
3. Click "Next"

**Caption overlay**: "Choose a template — see your brand live"
**UI elements visible**: Template grid 4×2, right-side preview pane with rendered Satori image

---

## Scene 4 — First Image Generated (0:28–0:38)

**Screen**: Products grid
**Action**:
1. Products list shows 20 items, all with "pending" status badges
2. First 3 items animate to "success" (spinner → green badge + thumbnail)
3. Click product "Classic Crewneck Sweatshirt" → side drawer shows full generated image

**Caption overlay**: "Background removed. Template applied. Brand-perfect."
**UI elements visible**: Polaris ResourceList, status badges, animated thumbnail load

---

## Scene 5 — Download (0:38–0:45)

**Screen**: Product detail / generated image modal
**Action**:
1. Full-resolution generated image fills modal (sweatshirt on indigo branded card)
2. Click "Download PNG" → browser download animation
3. Zoom out to desktop — downloaded file visible

**End card** (0:43–0:45):
- MailCraft logo + tagline "AI-powered product images, always on brand"
- URL: `apps.shopify.com/mailcraft-image-generator`
- "Start free — 100 images/month"

**Audio**: Music fade out, brief success chime at download

---

## Production Notes

- Record at 1920×1080 on a MacBook with Retina display (use OBS or Loom)
- Use Shopify Partners test store pre-loaded with `seed-demo-store.json` products
- Mock the generation pipeline to complete within 3 seconds (set `MOCK_GENERATION=true` in `.dev.vars`)
- Edit in DaVinci Resolve or Final Cut Pro
- Export H.264, AAC audio, target file size <50MB
