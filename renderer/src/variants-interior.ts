import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height, lightTxt, lightMuted,
          primaryColor, brandName, headline, subheadline, bgImageData, logoData, accentBar, contrastText,
          canvasBg, isDark: _isDark } = h

  switch (variant) {

    case 'room-reveal': {
      const halfW      = Math.round(w / 2)
      const roomType   = opts.roomType ?? ''
      const designer   = opts.brandName ?? brandName
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', flexDirection: 'row' }, children: [
        // BEFORE panel (grayscale look via bg overlay)
        { type: 'div', props: { style: { display: 'flex', width: halfW, height: height, flexShrink: 0, position: 'relative', overflow: 'hidden', background: '#888' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: halfW, height: height, objectFit: 'cover', objectPosition: 'left center', opacity: 0.55 } } }] : []),
          // Greyscale overlay
          { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.35)' } } },
          { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(16), background: 'rgba(0,0,0,0.55)', color: h.palette.tint100, fontSize: s(11), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(2) }, children: 'Before' } },
        ] } },
        // AFTER panel (color)
        { type: 'div', props: { style: { display: 'flex', width: halfW, height: height, flexShrink: 0, position: 'relative', overflow: 'hidden', background: primaryColor }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: halfW, height: height, objectFit: 'cover', objectPosition: 'right center' } } }] : []),
          { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.45), background: 'rgba(0,0,0,0.62)' } } },
          { type: 'div', props: { style: { position: 'absolute', top: s(20), right: s(16), background: primaryColor, color: contrastText(primaryColor), fontSize: s(11), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(2) }, children: 'After' } },
          // Bottom info
          { type: 'div', props: { style: { position: 'absolute', bottom: s(20), left: s(16), right: s(16), display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            ...(logoData
              ? [{ type: 'img', props: { src: logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(80) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 2, color: h.palette.tint300, textTransform: 'uppercase' as const }, children: designer } }]),
            { type: 'div', props: { style: { fontSize: s(16), fontWeight: 800, color: h.palette.tint100, lineHeight: 1.2 }, children: (roomType ? `${roomType} Reveal` : headline).slice(0, 30) } },
          ] } },
        ] } },
        // Center divider tag
        { type: 'div', props: { style: { position: 'absolute', top: '50%', left: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', width: s(32), height: s(32), borderRadius: 999, background: '#ffffff', marginTop: s(-16), marginLeft: s(-16), boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }, children: [
          { type: 'div', props: { style: { fontSize: s(14), fontWeight: 900, color: '#333' }, children: '↔' } },
        ] } },
      ] } }
    }

    case 'project-showcase': {
      const designStyle  = opts.designStyle ?? ''
      const budget       = opts.projectBudget ?? ''
      const duration     = opts.projectDuration ?? opts.duration ?? ''
      const ctaLabel     = opts.ctaText ?? 'View Project'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.50), background: 'rgba(0,0,0,0.72)' } } },
        // Top: logo
        { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), display: 'flex' }, children: [
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(90) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 2, color: h.sTxt, textTransform: 'uppercase' as const, background: 'rgba(0,0,0,0.40)', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: brandName } }]),
        ] } },
        // Bottom: info
        { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(24), right: s(24), display: 'flex', flexDirection: 'column', gap: s(10) }, children: [
          ...(designStyle ? [{ type: 'div', props: { style: { display: 'flex', alignSelf: 'flex-start', alignItems: 'center', background: primaryColor, color: contrastText(primaryColor), fontSize: s(10), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: designStyle } }] : []),
          { type: 'div', props: { style: { fontSize: sh(28), fontWeight: 800, color: h.sTxt, lineHeight: 1.15 }, children: headline.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(20) }, children: [
            ...(budget ? [{ type: 'div', props: { style: { fontSize: s(13), color: h.sMuted }, children: `Budget: ${budget}` } }] : []),
            ...(duration ? [{ type: 'div', props: { style: { fontSize: s(13), color: h.sMuted }, children: duration } }] : []),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: '#ffffff', color: primaryColor, fontSize: s(11), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1, paddingTop: s(9), paddingBottom: s(9), paddingLeft: s(18), paddingRight: s(18), borderRadius: s(3) }, children: ctaLabel } },
          ] } },
        ] } },
      ] } }
    }

    case 'material-moodboard': {
      const swatches   = (opts.swatchColors ?? [primaryColor, accentBar, '#f5f5f0', '#2d2d2d']).slice(0, 6)
      const materials  = (opts.materials ?? []).slice(0, 5)
      const collection = opts.collection ?? opts.designStyle ?? headline
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', background: '#faf9f6', flexDirection: 'row' }, children: [
        // Left: swatches grid
        { type: 'div', props: { style: { display: 'flex', width: Math.round(w * 0.38), height: height, flexShrink: 0, flexDirection: 'column', flexWrap: 'wrap' as const, overflow: 'hidden' }, children:
          swatches.map((col: string) => ({ type: 'div', props: { style: { display: 'flex', width: '50%', height: `${Math.round(100 / Math.ceil(swatches.length / 2))}%`, background: col, flexShrink: 0 }, children: [] } }))
        } },
        // Right: info panel
        { type: 'div', props: { style: { display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', paddingTop: s(40), paddingBottom: s(40), paddingLeft: s(36), paddingRight: s(36), gap: s(16), background: '#faf9f6' }, children: [
          // Logo
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, color: 'rgba(0,0,0,0.30)', textTransform: 'uppercase' as const }, children: brandName } }]),
          // Accent bar
          { type: 'div', props: { style: { display: 'flex', width: s(36), height: s(2), background: primaryColor } } },
          { type: 'div', props: { style: { fontSize: sb(24), fontWeight: 700, color: h.ptxtLight, lineHeight: 1.25 }, children: collection.slice(0, h.lk.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(13), color: h.pmutedLight, lineHeight: 1.5 }, children: subheadline.slice(0, 70) } }] : []),
          // Materials list
          ...(materials.length ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children:
            materials.map((mat: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { width: s(5), height: s(5), borderRadius: 999, background: primaryColor, flexShrink: 0 } } },
              { type: 'div', props: { style: { fontSize: s(12), color: h.ptxtLight, fontWeight: 500 }, children: mat } },
            ] } }))
          } }] : []),
          // Color swatch row (small dots)
          { type: 'div', props: { style: { display: 'flex', gap: s(8) }, children:
            swatches.map((col: string) => ({ type: 'div', props: { style: { display: 'flex', width: s(16), height: s(16), borderRadius: 999, background: col, borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(0,0,0,0.10)' }, children: [] } }))
          } },
        ] } },
      ] } }
    }

    case 'design-consultation': {
      const designStyle = opts.designStyle ?? ''
      const budget      = opts.projectBudget ?? ''
      const types       = (opts.benefits ?? opts.changelogItems ?? []).slice(0, 4)
      const ctaLabel    = opts.ctaText ?? 'Book Now'
      const ctaBg       = opts.ctaColor ?? primaryColor
      const ctaTxt      = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', flexDirection: 'row', background: '#faf9f6' }, children: [
        // Color accent strip
        { type: 'div', props: { style: { display: 'flex', width: s(6), height: height, flexShrink: 0, background: primaryColor } } },
        // Main content
        { type: 'div', props: { style: { display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', paddingTop: s(44), paddingBottom: s(44), paddingLeft: s(44), paddingRight: s(44), gap: s(18) }, children: [
          // Logo + designation
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            ...(logoData
              ? [{ type: 'img', props: { src: logoData, style: { height: s(26), objectFit: 'contain', maxWidth: s(100) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, letterSpacing: 2, color: primaryColor, textTransform: 'uppercase' as const }, children: brandName } }]),
            ...(designStyle ? [{ type: 'div', props: { style: { fontSize: s(11), color: 'rgba(0,0,0,0.40)', letterSpacing: 1, textTransform: 'uppercase' as const } , children: `${designStyle} Design` } }] : []),
          ] } },
          { type: 'div', props: { style: { fontSize: sh(30), fontWeight: 800, color: h.ptxtLight, lineHeight: 1.2, width: Math.round(w * h.lk.textMaxFrac) }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(14), color: h.sMuted, lineHeight: 1.5 }, children: subheadline.slice(0, 80) } }] : []),
          // Project types
          ...(types.length ? [{ type: 'div', props: { style: { display: 'flex', flexWrap: 'wrap' as const, gap: s(8) }, children:
            types.map((t: string) => ({ type: 'div', props: { style: { display: 'flex', fontSize: s(11), fontWeight: 600, color: primaryColor, background: `${primaryColor}15`, paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(4) }, children: t } }))
          } }] : []),
          // Budget + CTA row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(20) }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(12), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, paddingTop: s(13), paddingBottom: s(13), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(4) }, children: ctaLabel } },
            ...(budget ? [{ type: 'div', props: { style: { fontSize: s(13), color: 'rgba(0,0,0,0.45)' }, children: `Starting ${budget}` } }] : []),
          ] } },
        ] } },
        // Right image panel
        ...(bgImageData ? [{ type: 'div', props: { style: { display: 'flex', width: Math.round(w * 0.38), height: height, flexShrink: 0, overflow: 'hidden', position: 'relative' }, children: [
          { type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: Math.round(w * 0.38), height: height, objectFit: 'cover', objectPosition: 'center' } } },
        ] } }] : []),
      ] } }
    }

    default:
      return null
  }
}
