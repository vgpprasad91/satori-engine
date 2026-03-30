/**
 * Pure TypeScript GIF89a encoder — no WASM, no deps.
 *
 * Uses a per-GIF adaptive palette built from a 12-bit (4+4+4) colour histogram
 * across all frames.  The 256 most-frequent colour clusters become the palette
 * entries; each pixel is mapped to its nearest palette entry with a fast O(1)
 * 4096-entry lookup table.  No dithering — dithering with a coarse fixed
 * palette creates visible horizontal scan-line artefacts on solid-colour
 * regions, which is the typical content of brand cards.
 *
 * LZW compression is LSB-first with automatic code-size bumping and table
 * reset at 4096 codes.  Sub-blocks are packed at max 255 bytes.  Netscape
 * Application Extension enables infinite (or N-count) looping.
 */

// ── Adaptive palette ──────────────────────────────────────────────────────────

/**
 * Build a 256-entry adaptive palette from the pixel data of all frames.
 *
 * Algorithm:
 *   1. Accumulate a 4096-bin histogram (4 bits per channel).
 *   2. Sort non-empty bins by pixel count; take the top 256.
 *   3. Each palette entry is the *actual average* RGB of all pixels in that bin
 *      (not just the bin centre), so the palette tracks real image colours.
 *   4. Build a 4096→256 lookup table: for every possible 12-bit key find the
 *      nearest palette entry once (O(4096 × 256)), then pixel mapping is O(1).
 *
 * Returns { palette: Uint8Array(768), indexMap: Uint8Array(4096) }.
 */
function buildAdaptivePalette(
  frames: Array<{ pixels: Uint8Array }>,
): { palette: Uint8Array; indexMap: Uint8Array } {
  const binCount = new Int32Array(4096)
  const binSumR  = new Float64Array(4096)
  const binSumG  = new Float64Array(4096)
  const binSumB  = new Float64Array(4096)

  for (const { pixels } of frames) {
    for (let i = 0; i < pixels.length; i += 4) {
      const r4  = pixels[i]     >> 4  // 0–15
      const g4  = pixels[i + 1] >> 4
      const b4  = pixels[i + 2] >> 4
      const bin = (r4 << 8) | (g4 << 4) | b4
      binCount[bin]++
      binSumR[bin] += pixels[i]
      binSumG[bin] += pixels[i + 1]
      binSumB[bin] += pixels[i + 2]
    }
  }

  // Sort populated bins by frequency; take up to 256
  const sorted = Array.from({ length: 4096 }, (_, i) => i)
    .filter(i => binCount[i] > 0)
    .sort((a, b) => binCount[b] - binCount[a])
    .slice(0, 256)

  // Pad to exactly 256 (duplicate most-common entry if image has < 256 colours)
  while (sorted.length < 256) sorted.push(sorted[0] ?? 0)

  // Build palette: average colour per bin
  const palette = new Uint8Array(256 * 3)
  for (let j = 0; j < 256; j++) {
    const bin = sorted[j]
    const cnt = binCount[bin] || 1
    palette[j * 3]     = Math.round(binSumR[bin] / cnt)
    palette[j * 3 + 1] = Math.round(binSumG[bin] / cnt)
    palette[j * 3 + 2] = Math.round(binSumB[bin] / cnt)
  }

  // Build 4096-entry lookup table: for each 12-bit key → nearest palette index
  const indexMap = new Uint8Array(4096)
  for (let bin = 0; bin < 4096; bin++) {
    // Reconstruct representative colour for this bin
    const cnt = binCount[bin]
    const r = cnt > 0 ? Math.round(binSumR[bin] / cnt) : (((bin >> 8) & 0xF) * 17)
    const g = cnt > 0 ? Math.round(binSumG[bin] / cnt) : (((bin >> 4) & 0xF) * 17)
    const b = cnt > 0 ? Math.round(binSumB[bin] / cnt) : ((bin & 0xF) * 17)

    let bestIdx = 0, bestDist = Infinity
    for (let j = 0; j < 256; j++) {
      const dr = r - palette[j * 3]
      const dg = g - palette[j * 3 + 1]
      const db = b - palette[j * 3 + 2]
      // Perceptual weights: R 0.299, G 0.587, B 0.114
      const dist = dr * dr * 3 + dg * dg * 5 + db * db
      if (dist < bestDist) { bestDist = dist; bestIdx = j }
    }
    indexMap[bin] = bestIdx
  }

  return { palette, indexMap }
}

/**
 * Map RGBA pixel data to palette indices using the pre-built 4096-entry
 * lookup table.  O(n) — one lookup per pixel, no dithering.
 */
function quantizeWithIndexMap(rgba: Uint8Array, indexMap: Uint8Array): Uint8Array {
  const n   = rgba.length >> 2
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const r4  = rgba[i * 4]     >> 4
    const g4  = rgba[i * 4 + 1] >> 4
    const b4  = rgba[i * 4 + 2] >> 4
    out[i] = indexMap[(r4 << 8) | (g4 << 4) | b4]
  }
  return out
}

// ── LZW encoder ───────────────────────────────────────────────────────────────

/**
 * GIF LZW encoder — LSB-first bit packing.
 * Returns the complete Image Data body (minCodeSize byte + sub-blocks + terminator)
 * ready to be appended after the Image Descriptor.
 */
function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize  // 256 for 8-bit palette
  const endCode   = clearCode + 1     // 257

  let codeSize = minCodeSize + 1      // start at 9 bits
  let nextCode = endCode + 1          // first assignable code: 258

  const table = new Map<string, number>()

  const resetTable = () => {
    table.clear()
    for (let i = 0; i < clearCode; i++) table.set(String(i), i)
    codeSize = minCodeSize + 1
    nextCode  = endCode + 1
  }
  resetTable()

  // Bit-stream accumulator (LSB-first)
  let bitBuf = 0, bitCount = 0
  const bytesBuf: number[] = []

  const writeBits = (code: number, n: number) => {
    bitBuf |= (code & ((1 << n) - 1)) << bitCount
    bitCount += n
    while (bitCount >= 8) {
      bytesBuf.push(bitBuf & 0xFF)
      bitBuf    = (bitBuf >>> 8)
      bitCount -= 8
    }
  }

  // Emit initial CLEAR code
  writeBits(clearCode, codeSize)

  let prefix = indices[0]

  for (let i = 1; i < indices.length; i++) {
    const curr = indices[i]
    const key  = `${prefix},${curr}`

    if (table.has(key)) {
      prefix = table.get(key)!
    } else {
      writeBits(prefix, codeSize)

      if (nextCode < 4096) {
        table.set(key, nextCode++)
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++
      } else {
        writeBits(clearCode, codeSize)
        resetTable()
      }
      prefix = curr
    }
  }

  writeBits(prefix, codeSize)
  writeBits(endCode, codeSize)
  if (bitCount > 0) bytesBuf.push(bitBuf & 0xFF)

  // Pack into GIF sub-blocks (max 255 bytes each, prefixed by length byte)
  const subBlocks: number[] = []
  subBlocks.push(minCodeSize)
  for (let i = 0; i < bytesBuf.length; i += 255) {
    const blockLen = Math.min(255, bytesBuf.length - i)
    subBlocks.push(blockLen)
    for (let j = 0; j < blockLen; j++) subBlocks.push(bytesBuf[i + j])
  }
  subBlocks.push(0)  // block terminator

  return new Uint8Array(subBlocks)
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GifFrame {
  /** RGBA pixels (width × height × 4 bytes). */
  pixels: Uint8Array
  width:  number
  height: number
  /** Frame delay in centiseconds (10 = 100 ms, 8 ≈ 80 ms / ~12 fps). */
  delay: number
}

/**
 * Encode a sequence of frames as an animated GIF89a binary.
 *
 * @param frames  Array of frames (all must have the same width and height).
 * @param loops   Loop count: 0 = infinite, N = play N times.
 */
export function encodeAnimatedGif(frames: GifFrame[], loops = 0): Uint8Array {
  if (frames.length === 0) throw new Error('gif-encoder: frames array is empty')

  const { width: w, height: h } = frames[0]
  const minCodeSize = 8  // 2^8 = 256 palette entries

  // Build adaptive palette from all frames' pixel data
  const { palette, indexMap } = buildAdaptivePalette(frames)

  const parts: Uint8Array[] = []

  // ── GIF89a header ──────────────────────────────────────────────────────────
  parts.push(new TextEncoder().encode('GIF89a'))

  // ── Logical Screen Descriptor (7 bytes) ───────────────────────────────────
  // Packed: 1=global CT, 111=color resolution 8-bit, 0=not sorted, 111=CT size (2^(7+1)=256)
  const lsd = new Uint8Array(7)
  lsd[0] = w & 0xFF; lsd[1] = (w >> 8) & 0xFF
  lsd[2] = h & 0xFF; lsd[3] = (h >> 8) & 0xFF
  lsd[4] = 0xF7; lsd[5] = 0; lsd[6] = 0
  parts.push(lsd)

  // ── Global Colour Table (256 × 3 = 768 bytes) ─────────────────────────────
  parts.push(palette)

  // ── Netscape 2.0 Application Extension (looping) ─────────────────────────
  parts.push(new Uint8Array([
    0x21, 0xFF, 0x0B,
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30, // "NETSCAPE2.0"
    0x03, 0x01,
    (loops & 0xFF), ((loops >> 8) & 0xFF),
    0x00,
  ]))

  // ── Frames ────────────────────────────────────────────────────────────────
  for (const frame of frames) {
    const indices = quantizeWithIndexMap(frame.pixels, indexMap)

    // Graphic Control Extension (8 bytes)
    parts.push(new Uint8Array([
      0x21, 0xF9, 0x04,
      0x04,  // packed: disposal=001, userInput=0, transparentFlag=0
      (frame.delay & 0xFF), ((frame.delay >> 8) & 0xFF),
      0x00, 0x00,
    ]))

    // Image Descriptor (10 bytes)
    parts.push(new Uint8Array([
      0x2C,
      0x00, 0x00, 0x00, 0x00,  // left=0, top=0
      frame.width  & 0xFF, (frame.width  >> 8) & 0xFF,
      frame.height & 0xFF, (frame.height >> 8) & 0xFF,
      0x00,  // packed: no local CT, not interlaced, not sorted
    ]))

    // Image Data (LZW + sub-blocks)
    parts.push(lzwEncode(indices, minCodeSize))
  }

  // ── Trailer ───────────────────────────────────────────────────────────────
  parts.push(new Uint8Array([0x3B]))

  // ── Concatenate ───────────────────────────────────────────────────────────
  const total = parts.reduce((s, p) => s + p.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { result.set(p, offset); offset += p.length }
  return result
}

// ── Pixel-level animation transforms ─────────────────────────────────────────
// These operate on RGBA Uint8Arrays and return a new (modified) copy.

// ── Pixel-level helpers used by wipe / zoom / slide ──────────────────────────

/**
 * Wipe reveal left→right with a soft feathered edge.
 * `progress` 0→1. Unrevealed pixels are filled with `fillR/G/B` (the "curtain"
 * colour) — defaults to near-black so the curtain always contrasts the card.
 */
export function applyWipe(
  rgba:     Uint8Array,
  width:    number,
  height:   number,
  progress: number,
  softEdge  = 28,
  fillR     = 20,
  fillG     = 20,
  fillB     = 40,
): Uint8Array {
  const out  = new Uint8Array(rgba)
  const bgR  = fillR, bgG = fillG, bgB = fillB
  const cutX = progress * (width + softEdge) - softEdge * 0.5

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist = cutX - x
      let blend: number
      if      (dist >=  softEdge * 0.5) blend = 1
      else if (dist <= -softEdge * 0.5) blend = 0
      else blend = (dist + softEdge * 0.5) / softEdge

      if (blend >= 0.999) continue  // already correct from copy
      const i = (y * width + x) * 4
      out[i]     = Math.round(rgba[i]     * blend + bgR * (1 - blend))
      out[i + 1] = Math.round(rgba[i + 1] * blend + bgG * (1 - blend))
      out[i + 2] = Math.round(rgba[i + 2] * blend + bgB * (1 - blend))
    }
  }
  return out
}

/**
 * Ken Burns zoom-out: `scale` 1.0 = full card, >1 = zoomed in.
 * Crops from the centre and fills any out-of-bound pixels by clamping to edge.
 */
export function applyZoom(
  rgba:   Uint8Array,
  width:  number,
  height: number,
  scale:  number,   // 1.0 = no zoom, 1.3 = 30 % cropped in
): Uint8Array {
  const out = new Uint8Array(rgba.length)
  const cx  = width  / 2
  const cy  = height / 2

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.round(cx + (x - cx) / scale)
      const sy = Math.round(cy + (y - cy) / scale)
      const clampX = Math.max(0, Math.min(width  - 1, sx))
      const clampY = Math.max(0, Math.min(height - 1, sy))
      const si = (clampY * width + clampX) * 4
      const di = (y      * width + x)      * 4
      out[di]     = rgba[si]
      out[di + 1] = rgba[si + 1]
      out[di + 2] = rgba[si + 2]
      out[di + 3] = 255
    }
  }
  return out
}

/**
 * Slide-in: card moves in from the right.
 * `offsetX` > 0 means the card is shifted right by that many pixels;
 * pixels to the left of the card are filled with the card's edge colour.
 */
export function applySlide(
  rgba:    Uint8Array,
  width:   number,
  height:  number,
  offsetX: number,
): Uint8Array {
  const out = new Uint8Array(rgba.length)
  const ox  = Math.round(offsetX)
  const bgR = rgba[0], bgG = rgba[1], bgB = rgba[2]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = x - ox
      const di   = (y * width + x) * 4
      if (srcX < 0 || srcX >= width) {
        out[di] = bgR; out[di + 1] = bgG; out[di + 2] = bgB; out[di + 3] = 255
      } else {
        const si   = (y * width + srcX) * 4
        out[di]     = rgba[si]
        out[di + 1] = rgba[si + 1]
        out[di + 2] = rgba[si + 2]
        out[di + 3] = 255
      }
    }
  }
  return out
}

/** Fade-in: multiply all channel values by `factor` (0 = black, 1 = original). */
export function applyBrightness(rgba: Uint8Array, factor: number): Uint8Array {
  const out = new Uint8Array(rgba)
  const f   = Math.max(0, Math.min(1, factor))
  for (let i = 0; i < out.length; i += 4) {
    out[i]     = Math.round(out[i]     * f)
    out[i + 1] = Math.round(out[i + 1] * f)
    out[i + 2] = Math.round(out[i + 2] * f)
    // Alpha channel (i+3) preserved
  }
  return out
}

/**
 * Glitch: offset the R channel rightward and the B channel leftward by
 * `shiftX` pixels, creating a chromatic-aberration / scan-glitch look.
 * Optionally restricts the effect to a horizontal band [bandY, bandY+bandH].
 */
export function applyGlitch(
  rgba:   Uint8Array,
  width:  number,
  height: number,
  shiftX: number,
  bandY   = 0,
  bandH   = height,
): Uint8Array {
  const out  = new Uint8Array(rgba)
  const yEnd = Math.min(height, bandY + bandH)
  for (let y = bandY; y < yEnd; y++) {
    for (let x = 0; x < width; x++) {
      const dstI  = (y * width + x) * 4
      const rSrcX = Math.max(0, Math.min(width - 1, x - shiftX))
      const bSrcX = Math.max(0, Math.min(width - 1, x + shiftX))
      out[dstI]     = rgba[(y * width + rSrcX) * 4]          // R shifted left
      out[dstI + 2] = rgba[(y * width + bSrcX) * 4 + 2]      // B shifted right
    }
  }
  return out
}

/**
 * Flip squeeze: horizontally compress the card to simulate mid-flip.
 * `squeeze` 0 = normal, 1 = fully collapsed.
 * The narrow band in the centre is filled with `fillR/G/B`.
 */
export function applyFlipSqueeze(
  rgba:   Uint8Array,
  width:  number,
  height: number,
  squeeze: number,
  fillR   = 240,
  fillG   = 240,
  fillB   = 245,
): Uint8Array {
  const out      = new Uint8Array(rgba.length)
  const scaledW  = Math.max(1, Math.round(width * (1 - squeeze)))
  const offsetX  = Math.floor((width - scaledW) / 2)

  // Fill entire output with the fill colour
  for (let i = 0; i < out.length; i += 4) {
    out[i] = fillR; out[i + 1] = fillG; out[i + 2] = fillB; out[i + 3] = 255
  }
  // Copy scaled content into the centre band
  for (let y = 0; y < height; y++) {
    for (let dx = 0; dx < scaledW; dx++) {
      const srcX  = scaledW > 1 ? Math.round(dx * (width - 1) / (scaledW - 1)) : 0
      const dstX  = offsetX + dx
      const srcI  = (y * width + srcX) * 4
      const dstI  = (y * width + dstX) * 4
      out[dstI]     = rgba[srcI]
      out[dstI + 1] = rgba[srcI + 1]
      out[dstI + 2] = rgba[srcI + 2]
      out[dstI + 3] = rgba[srcI + 3]
    }
  }
  return out
}

/**
 * Ping: brightens a soft ring of radius `radius` expanding outward from the
 * card centre — one ring per frame call, caller advances radius each frame.
 */
export function applyPing(
  rgba:      Uint8Array,
  width:     number,
  height:    number,
  radius:    number,
  ringWidth  = 10,
  intensity  = 0.55,
): Uint8Array {
  const out = new Uint8Array(rgba)
  const cx  = width  / 2
  const cy  = height / 2
  const hw  = ringWidth / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist     = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      const fromEdge = Math.abs(dist - radius)
      if (fromEdge < hw) {
        const f = intensity * (1 - fromEdge / hw)
        const i = (y * width + x) * 4
        out[i]     = Math.min(255, Math.round(rgba[i]     + (255 - rgba[i])     * f))
        out[i + 1] = Math.min(255, Math.round(rgba[i + 1] + (255 - rgba[i + 1]) * f))
        out[i + 2] = Math.min(255, Math.round(rgba[i + 2] + (255 - rgba[i + 2]) * f))
      }
    }
  }
  return out
}

/**
 * Shimmer: a diagonal light-reflection stripe sweeping left→right at 30°.
 *
 * The stripe is centred at `x0` in the top row and shifts right by
 * `height * tilt` pixels at the bottom row (tilt=0.4 ≈ 22°).
 * A smooth bell-curve (Gaussian) falloff keeps the edge feathered.
 * Intensity is kept subtle (default 0.35) so it reads as polish, not glare.
 */
export function applyShimmer(
  rgba:    Uint8Array,
  width:   number,
  height:  number,
  x0:      number,
  stripeW: number,
  intensity = 0.35,
): Uint8Array {
  const out  = new Uint8Array(rgba)
  const tilt = 0.4  // horizontal shift per row (diagonal angle ~22°)
  const half = stripeW / 2

  for (let y = 0; y < height; y++) {
    // Centre of the stripe shifts diagonally as y increases
    const cx = x0 + y * tilt

    // Sample a window around cx
    const xStart = Math.floor(cx - half - 1)
    const xEnd   = Math.ceil(cx + half + 1)

    for (let x = xStart; x <= xEnd; x++) {
      if (x < 0 || x >= width) continue
      // Signed distance from stripe centre (in stripe-width units)
      const d   = (x - cx) / half
      // Smooth Gaussian: peak at d=0, falls to ~0.01 at |d|=1.5
      const fac = intensity * Math.exp(-(d * d) / 0.45)
      if (fac < 0.004) continue

      const i = (y * width + x) * 4
      out[i]     = Math.min(255, Math.round(out[i]     + (255 - out[i])     * fac))
      out[i + 1] = Math.min(255, Math.round(out[i + 1] + (255 - out[i + 1]) * fac))
      out[i + 2] = Math.min(255, Math.round(out[i + 2] + (255 - out[i + 2]) * fac))
    }
  }
  return out
}
