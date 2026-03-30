import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height, lightTxt, lightMuted,
          primaryColor, brandName, headline, subheadline, bgImageData, logoData, accentBar, contrastText,
          canvasBg, isDark: _isDark } = h

  switch (variant) {

    case 'employee-spotlight': {
      const empName  = opts.employeeName ?? headline
      const role     = opts.teamRole ?? opts.jobTitle ?? opts.reviewerTitle ?? ''
      const dept     = opts.employeeDept ?? ''
      const years    = opts.employeeYears ?? ''
      const quote    = opts.employeeQuote ?? subheadline ?? ''
      const photoW   = Math.round(w * 0.40)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', flexDirection: 'row' }, children: [
        // Photo / accent panel
        { type: 'div', props: { style: { display: 'flex', width: photoW, height: height, flexShrink: 0, position: 'relative', overflow: 'hidden', background: primaryColor }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: photoW, height: height, objectFit: 'cover', objectPosition: 'center top' } } }] : []),
          // Accent bar on right edge
          { type: 'div', props: { style: { position: 'absolute', top: 0, right: 0, width: s(5), height: height, background: accentBar } } },
          // Dept badge
          ...(dept ? [{ type: 'div', props: { style: { position: 'absolute', bottom: s(16), left: s(16), right: s(16), background: primaryColor, color: contrastText(primaryColor), fontSize: s(11), fontWeight: 700, textAlign: 'center', paddingTop: s(6), paddingBottom: s(6), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(4) }, children: dept } }] : []),
        ] } },
        // Info panel
        { type: 'div', props: { style: { display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', paddingTop: s(36), paddingBottom: s(36), paddingLeft: s(36), paddingRight: s(32), background: '#ffffff', gap: s(14) }, children: [
          { type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, color: primaryColor, textTransform: 'uppercase' as const }, children: 'Employee Spotlight' } },
          { type: 'div', props: { style: { fontSize: s(28), fontWeight: 900, color: '#111', lineHeight: 1.1 }, children: empName.slice(0, 40) } },
          ...(role ? [{ type: 'div', props: { style: { fontSize: s(14), color: h.palette.shade600, fontWeight: 500 }, children: role } }] : []),
          ...(years ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: [
            { type: 'div', props: { style: { width: s(5), height: s(5), borderRadius: 999, background: primaryColor, flexShrink: 0 } } },
            { type: 'div', props: { style: { fontSize: s(12), color: 'rgba(0,0,0,0.40)', fontWeight: 600 }, children: `${years} at company` } },
          ] } }] : []),
          ...(quote ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), paddingTop: s(12), borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'rgba(0,0,0,0.08)' }, children: [
            { type: 'div', props: { style: { fontSize: s(20), color: primaryColor, fontWeight: 900 }, children: '"' } },
            { type: 'div', props: { style: { fontSize: s(14), color: h.palette.shade700, fontStyle: 'italic', lineHeight: 1.5 }, children: quote.slice(0, 80) } },
          ] } }] : []),
          // Company logo bottom
          { type: 'div', props: { style: { display: 'flex', marginTop: s(4) }, children: [
            ...(logoData
              ? [{ type: 'img', props: { src: logoData, style: { height: s(18), objectFit: 'contain', maxWidth: s(70) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 2, color: 'rgba(0,0,0,0.25)', textTransform: 'uppercase' as const }, children: brandName } }]),
          ] } },
        ] } },
      ] } }
    }

    case 'company-benefits': {
      const benefits = (opts.benefits ?? opts.changelogItems ?? ['Remote Work', '401k Match', 'Unlimited PTO', 'Health Insurance']).slice(0, 6)
      const ctaLabel = opts.ctaText ?? 'See Open Roles'
      const ctaBg    = opts.ctaColor ?? primaryColor
      const ctaTxt   = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        // Left color strip
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: s(6), height: height, background: primaryColor } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'row' }, children: [
          // Main content
          { type: 'div', props: { style: { display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', paddingTop: s(36), paddingBottom: s(36), paddingLeft: s(48), paddingRight: s(40), gap: s(16) }, children: [
            // Header
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
              ...(logoData
                ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(90) } } }]
                : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 2, color: primaryColor, textTransform: 'uppercase' as const }, children: brandName } }]),
              { type: 'div', props: { style: { fontSize: sh(26), fontWeight: 800, color: '#111', lineHeight: 1.2 }, children: headline.slice(0, h.lk.headlineChars) } },
            ] } },
            // Benefits list
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8) }, children:
              benefits.map((b: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10) }, children: [
                { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: s(18), height: s(18), borderRadius: 999, background: primaryColor, flexShrink: 0 }, children: [
                  { type: 'div', props: { style: { fontSize: s(10), fontWeight: 900, color: contrastText(primaryColor) }, children: '✓' } },
                ] } },
                { type: 'div', props: { style: { fontSize: s(13), color: '#333', fontWeight: 500 }, children: b } },
              ] } }))
            } },
            // CTA
            { type: 'div', props: { style: { display: 'flex', alignSelf: 'flex-start', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(11), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, paddingTop: s(11), paddingBottom: s(11), paddingLeft: s(22), paddingRight: s(22), borderRadius: s(4) }, children: ctaLabel } },
          ] } },
          // Right: image or color block
          { type: 'div', props: { style: { display: 'flex', width: Math.round(w * 0.35), height: height, flexShrink: 0, overflow: 'hidden', position: 'relative', background: primaryColor }, children: [
            ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: Math.round(w * 0.35), height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'culture-stats': {
      const cultureStats = (opts.cultureStats ?? [{ label: 'eNPS', value: '72' }, { label: 'Retention', value: '94%' }]).slice(0, 4)
      const empCount     = opts.stat ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.12 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: sp(48), gap: s(22) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
            ...(logoData
              ? [{ type: 'img', props: { src: logoData, style: { height: s(26), objectFit: 'contain', maxWidth: s(90) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 3, color: contrastText(primaryColor), opacity: 0.44, textTransform: 'uppercase' as const }, children: brandName } }]),
            { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 3, color: contrastText(primaryColor), opacity: 0.40, textTransform: 'uppercase' as const }, children: 'Our Culture' } },
            { type: 'div', props: { style: { fontSize: sh(32), fontWeight: 900, color: contrastText(primaryColor), lineHeight: 1.1 }, children: headline.slice(0, h.lk.headlineChars) } },
          ] } },
          // Stats grid
          { type: 'div', props: { style: { display: 'flex', flexWrap: 'wrap' as const, gap: s(12) }, children:
            cultureStats.map((cs: { label: string; value: string }) => ({ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), background: 'rgba(255,255,255,0.12)', borderRadius: s(8), paddingTop: s(16), paddingBottom: s(16), paddingLeft: s(20), paddingRight: s(20), minWidth: s(100) }, children: [
              { type: 'div', props: { style: { fontSize: s(28), fontWeight: 900, color: contrastText(primaryColor), lineHeight: 1 }, children: cs.value } },
              { type: 'div', props: { style: { fontSize: s(10), color: contrastText(primaryColor), opacity: 0.40, letterSpacing: 1, textTransform: 'uppercase' as const }, children: cs.label } },
            ] } }))
          } },
          // Employee count
          ...(empCount ? [{ type: 'div', props: { style: { fontSize: s(14), color: contrastText(primaryColor), opacity: 0.33 }, children: `${empCount} employees worldwide` } }] : []),
        ] } },
      ] } }
    }

    case 'open-roles': {
      const openRoles  = opts.openRoles ?? 12
      const deptTags   = (opts.skills ?? opts.changelogItems ?? []).slice(0, 4)
      const ctaLabel   = opts.ctaText ?? 'See All Roles'
      const ctaBg      = '#ffffff'
      const ctaTxt     = primaryColor
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: s(-100), right: s(-100), width: s(400), height: s(400), borderRadius: 999, background: 'rgba(255,255,255,0.07)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: sp(52), gap: s(16) }, children: [
          // Logo
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(26), objectFit: 'contain', maxWidth: s(90) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 3, color: contrastText(primaryColor), opacity: 0.44, textTransform: 'uppercase' as const }, children: brandName } }]),
          // WE'RE HIRING
          { type: 'div', props: { style: { fontSize: s(13), fontWeight: 900, letterSpacing: 6, color: contrastText(primaryColor), opacity: 0.44, textTransform: 'uppercase' as const }, children: "WE'RE HIRING" } },
          // Big number
          { type: 'div', props: { style: { display: 'flex', fontSize: s(90), fontWeight: 900, color: contrastText(primaryColor), lineHeight: 1, letterSpacing: -2 }, children: String(openRoles) } },
          { type: 'div', props: { style: { fontSize: sb(20), fontWeight: 600, color: contrastText(primaryColor), opacity: 0.50 }, children: headline.slice(0, h.lk.headlineChars) } },
          // Dept tags
          ...(deptTags.length ? [{ type: 'div', props: { style: { display: 'flex', flexWrap: 'wrap' as const, gap: s(8) }, children:
            deptTags.map((d: string) => ({ type: 'div', props: { style: { display: 'flex', fontSize: s(11), fontWeight: 600, color: contrastText(primaryColor), background: 'rgba(255,255,255,0.15)', paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(12) }, children: d } }))
          } }] : []),
          // CTA
          { type: 'div', props: { style: { display: 'flex', alignSelf: 'flex-start', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(12), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, paddingTop: s(13), paddingBottom: s(13), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(4) }, children: ctaLabel } },
        ] } },
      ] } }
    }

    case 'team-culture': {
      const keywords   = (opts.changelogItems ?? opts.benefits ?? ['Innovative', 'Inclusive', 'Remote-First']).slice(0, 3)
      const ctaLabel   = opts.ctaText ?? 'Join the Team'
      const ctaBg      = opts.ctaColor ?? primaryColor
      const ctaTxt     = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', objectPosition: 'center' } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.62)' } } },
        // Top: logo
        { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), display: 'flex' }, children: [
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(26), objectFit: 'contain', maxWidth: s(90) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: 700, letterSpacing: 2, color: '#ffffff', textTransform: 'uppercase' as const }, children: brandName } }]),
        ] } },
        // Center: life at brand + keywords
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(14) }, children: [
          { type: 'div', props: { style: { fontSize: sh(40), fontWeight: 900, color: '#ffffff', textAlign: h.lta, lineHeight: 1.1 }, children: `Life at ${brandName}` } },
          // Keyword pills
          { type: 'div', props: { style: { display: 'flex', gap: s(10) }, children:
            keywords.map((kw: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.18)', color: '#ffffff', fontSize: s(14), fontWeight: 700, paddingTop: s(8), paddingBottom: s(8), paddingLeft: s(18), paddingRight: s(18), borderRadius: s(20) }, children: kw } }))
          } },
        ] } },
        // Bottom: headline + cta
        { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(24), right: s(24), display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }, children: [
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(14), color: 'rgba(255,255,255,0.70)' }, children: subheadline.slice(0, 60) } }] : []),
          ] } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(11), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(20), paddingRight: s(20), borderRadius: s(4) }, children: ctaLabel } },
        ] } },
      ] } }
    }

    default:
      return null
  }
}
