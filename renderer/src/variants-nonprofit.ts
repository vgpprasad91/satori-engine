import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height,
          primaryColor, brandName, headline, subheadline, bgImageData, logoData, contrastText,
          canvasBg, isDark: _isDark } = h

  switch (variant) {

    case 'donation-progress': {
      const goal       = opts.donationGoal ?? opts.savingsGoal ?? '$50,000'
      const raised     = opts.donationRaised ?? opts.savedAmount ?? '$34,200'
      const progress   = Math.min(100, Math.max(0, opts.donationProgress ?? opts.savingsProgress ?? 68))
      const donors     = opts.donorCount ?? ''
      const ctaLabel   = opts.ctaText ?? 'Donate Now'
      const ctaBg      = opts.ctaColor ?? primaryColor
      const ctaTxt     = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        // Top color strip
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: s(6), background: primaryColor } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: s(36), paddingBottom: s(36), paddingLeft: s(52), paddingRight: s(52), gap: s(18) }, children: [
          // Logo + campaign header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            ...(logoData
              ? [{ type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(100) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, letterSpacing: 2, color: primaryColor, textTransform: 'uppercase' as const }, children: brandName } }]),
            ...(opts.causeTag ? [{ type: 'div', props: { style: { display: 'flex', fontSize: s(10), fontWeight: 700, color: primaryColor, background: `${primaryColor}18`, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(12), letterSpacing: 1 }, children: opts.causeTag } }] : []),
          ] } },
          // Headline
          { type: 'div', props: { style: { fontSize: sh(28), fontWeight: 800, color: '#111', lineHeight: 1.2, width: Math.round(w * h.lk.textMaxFrac) }, children: headline.slice(0, h.lk.headlineChars) } },
          // Goal + raised amounts
          { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: s(12) }, children: [
            { type: 'div', props: { style: { fontSize: s(34), fontWeight: 900, color: primaryColor }, children: raised } },
            { type: 'div', props: { style: { fontSize: s(16), color: 'rgba(0,0,0,0.40)', fontWeight: 500 }, children: `raised of ${goal}` } },
          ] } },
          // Progress bar
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            { type: 'div', props: { style: { display: 'flex', width: '100%', height: s(14), background: '#e5e7eb', borderRadius: s(7), overflow: 'hidden', position: 'relative' }, children: [
              { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', height: s(14), width: `${progress}%`, background: primaryColor, borderRadius: s(7) }, children: [] } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between' }, children: [
              { type: 'div', props: { style: { fontSize: s(12), fontWeight: 700, color: primaryColor }, children: `${progress}% funded` } },
              ...(donors ? [{ type: 'div', props: { style: { fontSize: s(12), color: 'rgba(0,0,0,0.45)' }, children: donors } }] : []),
            ] } },
          ] } },
          // CTA
          { type: 'div', props: { style: { display: 'flex', alignSelf: 'flex-start', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(12), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(4) }, children: ctaLabel } },
        ] } },
      ] } }
    }

    case 'impact-stats': {
      const impactStat  = opts.impactStat ?? opts.stat ?? '10,000'
      const impactLabel = opts.impactLabel ?? headline
      const donorCt     = opts.donorCount ?? ''
      const volunteerCt = opts.volunteerCount ?? ''
      const causeTag    = opts.causeTag ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.18 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: sp(48), gap: s(18) }, children: [
          // Logo / Org name
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(30), objectFit: 'contain', maxWidth: s(110) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, letterSpacing: 3, color: contrastText(primaryColor), opacity: 0.50, textTransform: 'uppercase' as const }, children: brandName } }]),
          // Our Impact
          { type: 'div', props: { style: { fontSize: s(12), fontWeight: 700, letterSpacing: 3, color: contrastText(primaryColor), opacity: 0.44, textTransform: 'uppercase' as const, textAlign: 'center' }, children: 'Our Impact' } },
          // Big stat
          { type: 'div', props: { style: { display: 'flex', fontSize: s(80), fontWeight: 900, color: contrastText(primaryColor), lineHeight: 1, textAlign: 'center', letterSpacing: -2 }, children: impactStat } },
          { type: 'div', props: { style: { fontSize: s(20), fontWeight: 600, color: contrastText(primaryColor), opacity: 0.50, textAlign: 'center' }, children: impactLabel.slice(0, 50) } },
          // Cause tag
          ...(causeTag ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.15)', color: contrastText(primaryColor), fontSize: s(11), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(14), paddingRight: s(14), borderRadius: s(12) }, children: causeTag } }] : []),
          // Secondary stats
          { type: 'div', props: { style: { display: 'flex', gap: s(32) }, children: [
            ...(donorCt ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 800, color: contrastText(primaryColor) }, children: donorCt } },
              { type: 'div', props: { style: { fontSize: s(10), color: contrastText(primaryColor), opacity: 0.38, letterSpacing: 1, textTransform: 'uppercase' as const }, children: 'Donors' } },
            ] } }] : []),
            ...(volunteerCt ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 800, color: contrastText(primaryColor) }, children: volunteerCt } },
              { type: 'div', props: { style: { fontSize: s(10), color: contrastText(primaryColor), opacity: 0.38, letterSpacing: 1, textTransform: 'uppercase' as const }, children: 'Volunteers' } },
            ] } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'charity-appeal': {
      const causeTag = opts.causeTag ?? ''
      const tiers    = (opts.plans ?? []).slice(0, 4)
      const tierAmts = tiers.length ? tiers.map((p: { price: string }) => p.price) : ['$25', '$50', '$100']
      const ctaLabel = opts.ctaText ?? 'Give Today'
      const ctaBg    = opts.ctaColor ?? primaryColor
      const ctaTxt   = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.66), background: 'rgba(0,0,0,0.76)' } } },
        // Top: logo + cause tag
        { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), right: s(24), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(26), objectFit: 'contain', maxWidth: s(90) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: 700, letterSpacing: 2, color: h.sTxt, textTransform: 'uppercase' as const }, children: brandName } }]),
          ...(causeTag ? [{ type: 'div', props: { style: { display: 'flex', fontSize: s(10), fontWeight: 700, color: h.sTxt, background: primaryColor, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(12), letterSpacing: 1 }, children: causeTag } }] : []),
        ] } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(28), right: s(28), display: 'flex', flexDirection: 'column', gap: s(12) }, children: [
          { type: 'div', props: { style: { fontSize: sh(34), fontWeight: 900, color: h.sTxt, lineHeight: 1.1, width: Math.round(w * h.lk.textMaxFrac) }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(15), color: h.sMuted, lineHeight: 1.4 }, children: subheadline.slice(0, 90) } }] : []),
          // Tier pills + CTA row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10) }, children: [
            ...tierAmts.map((amt: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.15)', color: h.sTxt, fontSize: s(13), fontWeight: 700, paddingTop: s(8), paddingBottom: s(8), paddingLeft: s(16), paddingRight: s(16), borderRadius: s(4) }, children: amt } })),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(12), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(22), paddingRight: s(22), borderRadius: s(4) }, children: ctaLabel } },
          ] } },
        ] } },
      ] } }
    }

    case 'volunteer-cta': {
      const volunteerCt = opts.volunteerCount ?? opts.stat ?? '450+ volunteers'
      const ctaLabel    = opts.ctaText ?? 'Sign Up'
      const ctaBg       = '#ffffff'
      const ctaTxt      = primaryColor
      const time        = opts.classDuration ?? opts.eventDate ?? ''
      const location    = opts.eventLocation ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        // Bg texture / decorations
        { type: 'div', props: { style: { position: 'absolute', top: s(-80), right: s(-80), width: s(300), height: s(300), borderRadius: 999, background: 'rgba(255,255,255,0.08)' } } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(-60), left: s(-40), width: s(220), height: s(220), borderRadius: 999, background: 'rgba(255,255,255,0.05)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: sp(52), gap: s(16) }, children: [
          // Logo
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(26), objectFit: 'contain', maxWidth: s(90) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 3, color: contrastText(primaryColor), opacity: 0.44, textTransform: 'uppercase' as const }, children: brandName } }]),
          // JOIN US large
          { type: 'div', props: { style: { fontSize: s(13), fontWeight: 900, letterSpacing: 6, color: contrastText(primaryColor), opacity: 0.44, textTransform: 'uppercase' as const }, children: 'VOLUNTEER' } },
          { type: 'div', props: { style: { fontSize: sh(50), fontWeight: 900, color: contrastText(primaryColor), lineHeight: 1.0, letterSpacing: -1, textAlign: h.lta, width: Math.round(w * h.lk.textMaxFrac) }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(16), color: contrastText(primaryColor), opacity: 0.44, lineHeight: 1.4 }, children: subheadline.slice(0, 80) } }] : []),
          // Meta row
          { type: 'div', props: { style: { display: 'flex', gap: s(20) }, children: [
            ...(time ? [{ type: 'div', props: { style: { fontSize: s(13), color: contrastText(primaryColor), opacity: 0.40 }, children: time } }] : []),
            ...(location ? [{ type: 'div', props: { style: { fontSize: s(13), color: contrastText(primaryColor), opacity: 0.40 }, children: location } }] : []),
          ] } },
          // Volunteer count + CTA
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(20) }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(12), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, paddingTop: s(13), paddingBottom: s(13), paddingLeft: s(30), paddingRight: s(30), borderRadius: s(4) }, children: ctaLabel } },
            { type: 'div', props: { style: { fontSize: s(13), color: contrastText(primaryColor), opacity: 0.38 }, children: `Join ${volunteerCt}` } },
          ] } },
        ] } },
      ] } }
    }

    default:
      return null
  }
}
