import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height, txt, muted: _muted, accent: _accent, lightTxt, lightMuted,
          primaryColor, brandName, headline, subheadline, bgImageData, logoData, tk, accentBar, contrastText,
          canvasBg, isDark: _isDark } = h

  switch (variant) {

    case 'car-listing': {
      const panelW = Math.round(w * 0.45)
      const photoW = w - panelW
      const make   = opts.vehicleMake ?? brandName
      const model  = opts.vehicleModel ?? headline
      const year   = opts.vehicleYear ? String(opts.vehicleYear) : ''
      const price  = opts.price ?? opts.propertyPrice ?? ''
      const mileage  = opts.vehicleMileage ?? ''
      const engine   = opts.vehicleEngine ?? ''
      const color    = opts.vehicleColor ?? ''
      const cond     = opts.vehicleCondition ?? ''
      const features = (opts.vehicleFeatures ?? []).slice(0, 3)
      const ctaLabel = opts.ctaText ?? 'Schedule Test Drive'
      const ctaBg    = opts.ctaColor ?? accentBar
      const ctaTxt2  = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', flexDirection: 'row' }, children: [
        // Photo panel
        { type: 'div', props: { style: { display: 'flex', width: photoW, height: height, flexShrink: 0, overflow: 'hidden', background: primaryColor, position: 'relative' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: photoW, height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
          ...(cond ? [{ type: 'div', props: { style: { position: 'absolute', top: s(16), left: s(16), background: primaryColor, color: contrastText(primaryColor), fontSize: s(10), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: cond } }] : []),
        ] } },
        // Info panel
        { type: 'div', props: { style: { display: 'flex', width: panelW, height: height, flexShrink: 0, flexDirection: 'column', justifyContent: 'center', paddingTop: s(28), paddingBottom: s(28), paddingLeft: s(28), paddingRight: s(24), background: '#ffffff', gap: s(12) }, children: [
          // Logo / dealer name
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(100) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 2, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase' as const }, children: brandName } }]),
          // Year + Make + Model
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
            ...(year ? [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 600, color: primaryColor, letterSpacing: 1, textTransform: 'uppercase' as const }, children: year } }] : []),
            { type: 'div', props: { style: { fontSize: s(22), fontWeight: 800, color: '#111111', lineHeight: 1.1 }, children: `${make} ${model}`.slice(0, 30) } },
          ] } },
          // Price
          ...(price ? [{ type: 'div', props: { style: { fontSize: s(28), fontWeight: 900, color: primaryColor, lineHeight: 1 }, children: price } }] : []),
          // Spec pills
          { type: 'div', props: { style: { display: 'flex', flexWrap: 'wrap' as const, gap: s(6) }, children: [
            ...(mileage ? [{ type: 'div', props: { style: { display: 'flex', fontSize: s(10), fontWeight: 600, color: '#555', background: '#f3f4f6', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(8), paddingRight: s(8), borderRadius: s(4) }, children: mileage } }] : []),
            ...(engine ? [{ type: 'div', props: { style: { display: 'flex', fontSize: s(10), fontWeight: 600, color: '#555', background: '#f3f4f6', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(8), paddingRight: s(8), borderRadius: s(4) }, children: engine } }] : []),
            ...(color ? [{ type: 'div', props: { style: { display: 'flex', fontSize: s(10), fontWeight: 600, color: '#555', background: '#f3f4f6', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(8), paddingRight: s(8), borderRadius: s(4) }, children: color } }] : []),
          ] } },
          // Features
          ...(features.length ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children:
            features.map((f: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: [
              { type: 'div', props: { style: { width: s(5), height: s(5), borderRadius: 999, background: primaryColor, flexShrink: 0 } } },
              { type: 'div', props: { style: { fontSize: s(11), color: '#444' }, children: f } },
            ] } }))
          } }] : []),
          // CTA
          { type: 'div', props: { style: { display: 'flex', alignSelf: 'flex-start', alignItems: 'center', background: ctaBg, color: ctaTxt2, fontSize: s(11), fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(16), paddingRight: s(16), borderRadius: s(4) }, children: ctaLabel } },
        ] } },
      ] } }
    }

    case 'vehicle-specs': {
      const make    = opts.vehicleMake ?? brandName
      const model   = opts.vehicleModel ?? headline
      const year    = opts.vehicleYear ? String(opts.vehicleYear) : ''
      const specs   = [
        { label: 'ENGINE',   value: opts.vehicleEngine   ?? '—' },
        { label: 'MILEAGE',  value: opts.vehicleMileage  ?? '—' },
        { label: 'YEAR',     value: year || '—' },
        { label: 'COLOR',    value: opts.vehicleColor    ?? '—' },
      ]
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.18 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: sp(48), gap: s(28) }, children: [
          // Logo + headline
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
            ...(logoData
              ? [{ type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(100) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 3, color: primaryColor, textTransform: 'uppercase' as const }, children: make } }]),
            { type: 'div', props: { style: { fontSize: sh(36), fontWeight: 900, color: h.sTxt, lineHeight: 1.1, letterSpacing: -1 }, children: `${year} ${model}`.trim().slice(0, h.lk.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(14), color: 'rgba(255,255,255,0.5)' }, children: subheadline.slice(0, 60) } }] : []),
          ] } },
          // Spec grid
          { type: 'div', props: { style: { display: 'flex', flexWrap: 'wrap' as const, gap: s(12) }, children:
            specs.map((sp) => ({ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.12)', paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(16), paddingRight: s(16), borderRadius: s(6), minWidth: s(110) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 2, color: primaryColor }, children: sp.label } },
              { type: 'div', props: { style: { fontSize: s(15), fontWeight: 700, color: h.sTxt }, children: sp.value } },
            ] } }))
          } },
        ] } },
      ] } }
    }

    case 'dealership-ad': {
      const savings  = opts.stat ?? opts.badge ?? ''
      const ctaLabel = opts.ctaText ?? 'Shop Now'
      const ctaBg    = opts.ctaColor ?? '#ffffff'
      const ctaTxt2  = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.64)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: sp(48), gap: s(16) }, children: [
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(36), objectFit: 'contain', maxWidth: s(140) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 800, letterSpacing: 4, color: h.sBody, textTransform: 'uppercase' as const }, children: brandName } }]),
          { type: 'div', props: { style: { fontSize: sh(56), fontWeight: 900, color: h.sTxt, lineHeight: 1.05, textAlign: h.lta, width: Math.round(w * h.lk.textMaxFrac) }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(savings ? [{ type: 'div', props: { style: { fontSize: s(42), fontWeight: 900, color: primaryColor, lineHeight: 1, textAlign: h.lta }, children: savings } }] : []),
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(18), color: h.sMuted, textAlign: 'center' }, children: subheadline.slice(0, 80) } }] : []),
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: ctaBg, color: ctaTxt2, fontSize: s(13), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(36), paddingRight: s(36), borderRadius: s(4) }, children: ctaLabel } },
          ...(opts.expiryText ? [{ type: 'div', props: { style: { fontSize: s(10), color: h.sMuted, textAlign: 'center', marginTop: s(4) }, children: opts.expiryText } }] : []),
        ] } },
      ] } }
    }

    case 'test-drive-cta': {
      const panelW  = Math.round(w * 0.42)
      const photoW  = w - panelW
      const model   = opts.vehicleModel ?? headline
      const ctaLabel = opts.ctaText ?? 'Book Test Drive'
      const ctaBg    = '#ffffff'
      const ctaTxt2  = primaryColor
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', flexDirection: 'row' }, children: [
        // CTA panel
        { type: 'div', props: { style: { display: 'flex', width: panelW, height: height, flexShrink: 0, flexDirection: 'column', justifyContent: 'center', paddingTop: sp(32), paddingBottom: sp(32), paddingLeft: sp(36), paddingRight: sp(32), background: primaryColor, gap: s(16) }, children: [
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(90) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, color: h.sMuted, textTransform: 'uppercase' as const }, children: brandName } }]),
          { type: 'div', props: { style: { fontSize: sh(32), fontWeight: 900, color: h.sTxt, lineHeight: 1.1 }, children: 'Test Drive' } },
          { type: 'div', props: { style: { fontSize: sb(16), color: h.sBody }, children: model.slice(0, 30) } },
          ...(opts.eventDate ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'rgba(255,255,255,0.20)', paddingTop: s(12) }, children: [
            ...(opts.eventDate ? [{ type: 'div', props: { style: { fontSize: s(12), color: h.sMuted }, children: opts.eventDate } }] : []),
            ...(opts.eventTime ? [{ type: 'div', props: { style: { fontSize: s(12), color: h.sMuted }, children: opts.eventTime } }] : []),
            ...(opts.eventLocation ? [{ type: 'div', props: { style: { fontSize: s(11), color: h.sMuted }, children: opts.eventLocation } }] : []),
          ] } }] : []),
          { type: 'div', props: { style: { display: 'flex', alignSelf: 'flex-start', alignItems: 'center', background: ctaBg, color: ctaTxt2, fontSize: s(12), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1, paddingTop: s(11), paddingBottom: s(11), paddingLeft: s(20), paddingRight: s(20), borderRadius: s(4) }, children: ctaLabel } },
        ] } },
        // Photo panel
        { type: 'div', props: { style: { display: 'flex', width: photoW, height: height, flexShrink: 0, overflow: 'hidden', background: accentBar, position: 'relative' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: photoW, height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
        ] } },
      ] } }
    }

    default:
      return null
  }
}
