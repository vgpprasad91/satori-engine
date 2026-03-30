import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height, lightTxt: _lt, lightMuted: _lm,
          primaryColor, brandName, headline, subheadline, bgImageData, logoData, tk, accentBar, contrastText,
          canvasBg, isDark: _isDark } = h

  switch (variant) {

    case 'lookbook-card': {
      const collection = opts.collection ?? ''
      const season     = opts.styleTag ?? ''
      const price      = opts.price ?? ''
      const ctaLabel   = opts.ctaText ?? 'Shop Now'
      const ctaBg      = opts.ctaColor ?? '#ffffff'
      const ctaTxt     = primaryColor
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.52), background: 'rgba(0,0,0,0.75)' } } },
        // Top bar: collection + logo
        { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), right: s(24), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
          ...(collection ? [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, color: h.sBody, textTransform: 'uppercase' as const, background: 'rgba(0,0,0,0.35)', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(2) }, children: collection } }] : []),
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 800, letterSpacing: 2, color: h.sTxt, textTransform: 'uppercase' as const }, children: brandName } }]),
        ] } },
        // Bottom info
        { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(24), right: s(24), display: 'flex', flexDirection: 'column', gap: s(10) }, children: [
          ...(season ? [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 600, color: primaryColor, letterSpacing: 2, textTransform: 'uppercase' as const }, children: season } }] : []),
          { type: 'div', props: { style: { fontSize: sh(28), fontWeight: 800, color: h.ptxtDark, lineHeight: 1.1 }, children: headline.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            ...(price ? [{ type: 'div', props: { style: { fontSize: s(22), fontWeight: 700, color: h.ptxtDark }, children: price } }] : [{ type: 'div', props: { style: { display: 'flex' }, children: '' } }]),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(11), fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, paddingTop: s(9), paddingBottom: s(9), paddingLeft: s(18), paddingRight: s(18), borderRadius: s(3) }, children: ctaLabel } },
          ] } },
        ] } },
      ] } }
    }

    case 'ootd-card': {
      const items     = (opts.lookbookItems ?? []).slice(0, 5)
      const styleTag  = opts.styleTag ?? ''
      const photoW    = Math.round(w * 0.58)
      const listW     = w - photoW
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', flexDirection: 'row' }, children: [
        // Photo side
        { type: 'div', props: { style: { display: 'flex', width: photoW, height: height, flexShrink: 0, overflow: 'hidden', background: primaryColor, position: 'relative' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: photoW, height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
          ...(styleTag ? [{ type: 'div', props: { style: { position: 'absolute', top: s(14), left: s(14), background: primaryColor, color: contrastText(primaryColor), fontSize: s(9), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: styleTag } }] : []),
        ] } },
        // Items list side
        { type: 'div', props: { style: { display: 'flex', width: listW, height: height, flexShrink: 0, flexDirection: 'column', justifyContent: 'center', paddingTop: s(28), paddingBottom: s(28), paddingLeft: s(24), paddingRight: s(20), background: '#ffffff', gap: s(10) }, children: [
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(80) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 2, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase' as const }, children: brandName } }]),
          { type: 'div', props: { style: { fontSize: s(14), fontWeight: 800, color: '#111', lineHeight: 1.2 }, children: 'Outfit of the Day' } },
          ...(headline ? [{ type: 'div', props: { style: { fontSize: s(11), color: h.palette.shade600 }, children: headline.slice(0, 40) } }] : []),
          // Items
          ...(items.length ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children:
            items.map((item: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8), background: '#f7f8fa', borderRadius: s(4), paddingTop: s(6), paddingBottom: s(6), paddingLeft: s(10), paddingRight: s(10) }, children: [
              { type: 'div', props: { style: { width: s(5), height: s(5), borderRadius: 999, background: primaryColor, flexShrink: 0 } } },
              { type: 'div', props: { style: { fontSize: s(11), color: '#333', fontWeight: 500 }, children: item.slice(0, 28) } },
            ] } }))
          } }] : []),
          // Hashtag area
          ...(opts.tagline ? [{ type: 'div', props: { style: { fontSize: s(10), color: primaryColor, fontWeight: 600 }, children: opts.tagline } }] : []),
        ] } },
      ] } }
    }

    case 'style-drop': {
      const releaseDate = opts.releaseDate ?? opts.eventDate ?? ''
      const edition     = opts.badge ?? 'Limited Edition'
      const ctaLabel    = opts.ctaText ?? 'Shop the Drop'
      const ctaBg       = opts.ctaColor ?? primaryColor
      const ctaTxt      = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.35 } } }] : []),
        ...(h.lk.brandTop ? [{ type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), right: s(24), display: 'flex', justifyContent: 'center' }, children: [
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(32), objectFit: 'contain', maxWidth: s(120) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 900, letterSpacing: 6, color: h.sTxt, textTransform: 'uppercase' as const }, children: brandName } }]),
        ] } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: sp(48), gap: s(18) }, children: [
          // Brand (inline when brandTop false)
          ...(!h.lk.brandTop ? [
            ...(logoData
              ? [{ type: 'img', props: { src: logoData, style: { height: s(32), objectFit: 'contain', maxWidth: s(120) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 900, letterSpacing: 6, color: h.sTxt, textTransform: 'uppercase' as const } , children: brandName } }]),
          ] : []),
          // Edition badge
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: primaryColor, color: contrastText(primaryColor), fontSize: s(10), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(14), paddingRight: s(14), borderRadius: s(2) }, children: edition } },
          // Collection / Drop name
          { type: 'div', props: { style: { fontSize: sh(52), fontWeight: 900, color: h.sTxt, lineHeight: 1.0, textAlign: h.lta, letterSpacing: -1, width: Math.round(w * h.lk.textMaxFrac) }, children: (opts.collection ?? headline).slice(0, h.lk.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(16), color: h.sMuted, textAlign: h.lta }, children: subheadline.slice(0, 70) } }] : []),
          // Release date
          ...(releaseDate ? [{ type: 'div', props: { style: { fontSize: s(14), color: h.sMuted, letterSpacing: 1, textAlign: h.lta }, children: releaseDate } }] : []),
          // CTA
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(12), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, paddingTop: s(13), paddingBottom: s(13), paddingLeft: s(32), paddingRight: s(32), borderRadius: s(4) }, children: ctaLabel } },
        ] } },
      ] } }
    }

    case 'fashion-sale': {
      const discount     = opts.badge ?? opts.stat ?? 'SALE'
      const originalPric = opts.originalPrice ?? ''
      const salePrice    = opts.price ?? ''
      const sizes        = (opts.sizes ?? []).slice(0, 6)
      const ctaLabel     = opts.ctaText ?? 'Shop Sale'
      const ctaBg        = opts.ctaColor ?? primaryColor
      const ctaTxt       = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.60)' } } },
        // Discount badge
        { type: 'div', props: { style: { position: 'absolute', top: s(20), right: s(20), background: primaryColor, color: contrastText(primaryColor), fontSize: s(20), fontWeight: 900, letterSpacing: 1, paddingTop: s(8), paddingBottom: s(8), paddingLeft: s(16), paddingRight: s(16), borderRadius: s(4) }, children: discount } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(28), left: s(28), right: s(28), display: 'flex', flexDirection: 'column', gap: s(10) }, children: [
          // Brand
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(90) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, color: h.sMuted, textTransform: 'uppercase' as const }, children: brandName } }]),
          // Collection
          ...(opts.collection ? [{ type: 'div', props: { style: { fontSize: s(11), color: h.sMuted, letterSpacing: 1 }, children: opts.collection } }] : []),
          // Headline
          { type: 'div', props: { style: { fontSize: sh(30), fontWeight: 800, color: h.sTxt, lineHeight: 1.15 }, children: headline.slice(0, h.lk.headlineChars) } },
          // Price row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: s(10) }, children: [
            ...(originalPric ? [{ type: 'div', props: { style: { fontSize: s(16), color: h.sMuted, textDecoration: 'line-through' }, children: originalPric } }] : []),
            ...(salePrice ? [{ type: 'div', props: { style: { fontSize: s(26), fontWeight: 900, color: h.sTxt }, children: salePrice } }] : []),
          ] } },
          // Sizes + CTA row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            ...(sizes.length ? [{ type: 'div', props: { style: { display: 'flex', gap: s(6) }, children:
              sizes.map((sz: string) => ({ type: 'div', props: { style: { display: 'flex', fontSize: s(10), fontWeight: 700, color: h.sMuted, borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.30)', paddingTop: s(3), paddingBottom: s(3), paddingLeft: s(7), paddingRight: s(7), borderRadius: s(3) }, children: sz } }))
            } }] : [{ type: 'div', props: { style: { display: 'flex' }, children: '' } }]),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(11), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(20), paddingRight: s(20), borderRadius: s(4) }, children: ctaLabel } },
          ] } },
        ] } },
      ] } }
    }

    default:
      return null
  }
}
