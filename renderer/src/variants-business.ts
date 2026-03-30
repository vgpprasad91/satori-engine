import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height, txt, muted, accent: _accent, lightTxt, lightMuted,
          primaryColor, brandName, headline, subheadline, stat, bgImageData, logoData, tk, accentBar, contrastText } = h

  switch (variant) {

    case 'receipt-card': {
      const price     = opts.price ?? opts.invoiceAmount ?? ''
      const itemDesc  = opts.dishName ?? headline
      const cardBg    = '#fffdf7'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: cardBg }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: sp(32), gap: s(12) }, children: [
          // Logo
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(32), objectFit: 'contain', maxWidth: s(120), marginBottom: s(4) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(16), fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase' as const, color: '#1a1a1a', marginBottom: s(4) }, children: brandName } }]),
          // Divider
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8), width: '100%', justifyContent: 'center' }, children: [
            { type: 'div', props: { style: { flex: 1, height: 1, background: '#ddd', borderStyle: 'dashed', borderColor: '#ccc', borderWidth: 0, borderTopWidth: 1 } } },
            { type: 'div', props: { style: { fontSize: s(10), color: '#999', letterSpacing: 2 }, children: 'RECEIPT' } },
            { type: 'div', props: { style: { flex: 1, height: 1, background: '#ddd', borderStyle: 'dashed', borderColor: '#ccc', borderWidth: 0, borderTopWidth: 1 } } },
          ] } },
          // Item
          { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', paddingTop: s(8) }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), flex: 1 }, children: [
              { type: 'div', props: { style: { fontSize: s(18), fontWeight: 700, color: '#1a1a1a' }, children: itemDesc.slice(0, 40) } },
              ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(13), color: '#888' }, children: subheadline.slice(0, 60) } }] : []),
            ] } },
            ...(price ? [{ type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: '#1a1a1a', letterSpacing: -0.5 }, children: price } }] : []),
          ] } },
          // Subtotal
          { type: 'div', props: { style: { width: '100%', borderTopWidth: 1, borderTopStyle: 'dashed', borderTopColor: '#ddd', paddingTop: s(12), display: 'flex', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { fontSize: s(13), color: '#888' }, children: 'Total' } },
            { type: 'div', props: { style: { fontSize: s(24), fontWeight: 900, color: primaryColor, letterSpacing: -0.5 }, children: price || '—' } },
          ] } },
          // Thank you
          { type: 'div', props: { style: { marginTop: s(8), textAlign: 'center', display: 'flex', justifyContent: 'center' }, children: [
            { type: 'div', props: { style: { fontSize: s(16), color: '#888' }, children: 'Thank you!' } },
          ] } },
        ] } },
      ] } }
    }

    case 'business-card': {
      const personName = opts.recipientName ?? headline
      const role       = opts.teamRole ?? opts.jobTitle ?? subheadline ?? ''
      const email2     = opts.email ?? `hello@${brandName.toLowerCase().replace(/\s+/g, '')}.com`
      const halfW      = Math.round(w * 0.45)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        // Left — brand identity
        { type: 'div', props: { style: { width: halfW, height: height, flexShrink: 0, background: primaryColor, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(12), position: 'relative', overflow: 'hidden' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: halfW, height: height, objectFit: 'cover', opacity: 0.15 } } }] : []),
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(40), objectFit: 'contain', maxWidth: s(130), position: 'relative' as const } } }]
            : [{ type: 'div', props: { style: { fontSize: s(42), fontWeight: 900, color: contrastText(primaryColor), letterSpacing: -2, position: 'relative' as const }, children: brandName.slice(0, 2).toUpperCase() } }]),
          { type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase' as const, color: contrastText(primaryColor), opacity: 0.50, position: 'relative' as const }, children: brandName } },
        ] } },
        // Right — person info
        { type: 'div', props: { style: { flex: 1, background: '#ffffff', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(10), paddingLeft: s(32), paddingRight: s(24) }, children: [
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(22), fontWeight: 800, color: '#1a1a1a', letterSpacing: -0.3 }, children: personName.slice(0, 25) } },
            ...(role ? [{ type: 'div', props: { style: { fontSize: s(13), color: primaryColor, fontWeight: 600 }, children: role.slice(0, 40) } }] : []),
          ] } },
          { type: 'div', props: { style: { width: s(30), height: s(2), background: primaryColor } } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            { type: 'div', props: { style: { fontSize: s(12), color: '#555' }, children: email2.slice(0, 40) } },
            ...(opts.linkedinUrl ? [{ type: 'div', props: { style: { fontSize: s(12), color: '#0a66c2' }, children: opts.linkedinUrl.slice(0, 40) } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'qr-code-card': {
      const qrSize    = Math.min(s(160), Math.round(height * 0.55))
      const ctaText2  = opts.ctaText ?? 'Scan to visit'
      const url       = opts.qrData ?? `https://${brandName.toLowerCase().replace(/\s+/g, '')}.com`
      // Draw a stylized QR-like grid (placeholder)
      const cell      = Math.round(qrSize / 7)
      const pattern   = [
        [1,1,1,0,1,1,1],[1,0,1,0,1,0,1],[1,0,1,0,1,0,1],[0,0,0,0,0,0,0],[1,0,1,0,1,0,1],[1,0,1,0,1,0,1],[1,1,1,0,1,1,1],
      ]
      const qrGrid = { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2), padding: s(8), background: '#ffffff', borderRadius: s(4) }, children:
        pattern.map(row => ({ type: 'div', props: { style: { display: 'flex', gap: s(2) }, children:
          row.map(cell2 => ({ type: 'div', props: { style: { width: cell, height: cell, background: cell2 ? '#000000' : '#ffffff', borderRadius: s(1) } } }))
        } }))
      } }
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(16), padding: sp(28) }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(110) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: 800, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight }, children: brandName } }]),
          { type: 'div', props: { style: { fontSize: s(20), fontWeight: 700, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight, textAlign: 'center' }, children: headline.slice(0, 40) } },
          qrGrid,
          { type: 'div', props: { style: { fontSize: s(11), color: muted, letterSpacing: 1, textAlign: 'center' }, children: url.slice(0, 40) } },
          { type: 'div', props: { style: { fontSize: s(12), color: primaryColor, fontWeight: 700 }, children: ctaText2 } },
        ] } },
      ] } }
    }

    case 'team-member': {
      const personName = opts.recipientName ?? headline
      const role2      = opts.teamRole ?? opts.jobTitle ?? subheadline ?? ''
      const dept       = opts.teamDepartment ?? ''
      const bio        = subheadline ?? ''
      const skills     = (opts.skills ?? []).slice(0, 3)
      const initials   = personName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
      const avatarSize = Math.round(Math.min(s(80), height * 0.35))
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        // Left: avatar + name
        { type: 'div', props: { style: { width: Math.round(w * 0.38), height: height, flexShrink: 0, background: tk.panelBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(12), padding: s(20) }, children: [
          { type: 'div', props: { style: { width: avatarSize, height: avatarSize, borderRadius: 999, background: primaryColor, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }, children: [
            ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: avatarSize, height: avatarSize, objectFit: 'cover' } } }]
              : [{ type: 'div', props: { style: { fontSize: s(28), fontWeight: 900, color: contrastText(primaryColor) }, children: initials } }]),
          ] } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(16), fontWeight: 800, color: '#1a1a1a', textAlign: 'center' }, children: personName.slice(0, 22) } },
            { type: 'div', props: { style: { fontSize: s(12), color: primaryColor, fontWeight: 600, textAlign: 'center' }, children: role2.slice(0, 30) } },
            ...(dept ? [{ type: 'div', props: { style: { fontSize: s(10), color: '#888', textAlign: 'center', letterSpacing: 1, textTransform: 'uppercase' as const }, children: dept } }] : []),
          ] } },
        ] } },
        // Right: bio + skills
        { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(14), paddingLeft: s(28), paddingRight: s(28) }, children: [
          ...(bio ? [{ type: 'div', props: { style: { fontSize: s(14), color: '#555', lineHeight: 1.6 }, children: bio.slice(0, 150) } }] : []),
          ...(skills.length ? [{ type: 'div', props: { style: { display: 'flex', flexWrap: 'nowrap', gap: s(8) }, children:
            skills.map((sk: string) => ({ type: 'div', props: { style: { fontSize: s(11), fontWeight: 600, color: primaryColor, background: `${primaryColor}15`, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(20) }, children: sk } }))
          } }] : []),
          ...(opts.twitterHandle ? [{ type: 'div', props: { style: { fontSize: s(12), color: '#1d9bf0' }, children: `@${opts.twitterHandle}` } }] : []),
        ] } },
      ] } }
    }

    case 'org-announcement': {
      const fromName  = opts.agentName ?? brandName
      const toText    = opts.tagline ?? 'All Team Members'
      const annoDate  = opts.eventDate ?? opts.publishDate ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        // Header bar
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: s(48), background: primaryColor, display: 'flex', alignItems: 'center', paddingLeft: s(24), paddingRight: s(24), justifyContent: 'space-between' }, children: [
          { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.9)' }, children: 'ANNOUNCEMENT' } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }] : []),
        ] } },
        // Content
        { type: 'div', props: { style: { position: 'absolute', top: s(48), left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(14), padding: s(28) }, children: [
          { type: 'div', props: { style: { display: 'flex', gap: s(24) }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(11), color: '#888', letterSpacing: 1 }, children: 'FROM:' } },
              { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: '#1a1a1a' }, children: fromName } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(11), color: '#888', letterSpacing: 1 }, children: 'TO:' } },
              { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: '#1a1a1a' }, children: toText } },
            ] } },
            ...(annoDate ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(11), color: '#888', letterSpacing: 1 }, children: 'DATE:' } },
              { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: '#1a1a1a' }, children: annoDate } },
            ] } }] : []),
          ] } },
          { type: 'div', props: { style: { width: '100%', height: 1, background: '#eee' } } },
          { type: 'div', props: { style: { fontSize: sh(26), fontWeight: 900, color: '#1a1a1a', lineHeight: 1.2, letterSpacing: -0.3 }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(14), color: '#555', lineHeight: 1.6 }, children: subheadline.slice(0, 150) } }] : []),
        ] } },
      ] } }
    }

    case 'invoice-summary': {
      const invNum    = opts.invoiceNumber ?? `INV-${Date.now().toString().slice(-6)}`
      const amount    = opts.invoiceAmount ?? opts.price ?? ''
      const dueDate   = opts.invoiceDue ?? opts.eventDate ?? ''
      const isPaid    = (opts.stat ?? '').toLowerCase() === 'paid'
      const statusBg  = isPaid ? '#22c55e' : '#ef4444'
      const statusLbl = isPaid ? 'PAID' : 'DUE'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: s(5), height: height, background: primaryColor } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: s(40), paddingRight: s(40), gap: s(16) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
              ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(100), marginBottom: s(4) } } }]
                : [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: 800, color: '#1a1a1a' }, children: brandName } }]),
              { type: 'div', props: { style: { fontSize: s(12), color: '#888' }, children: invNum } },
            ] } },
            { type: 'div', props: { style: { background: statusBg, color: contrastText(statusBg), fontSize: s(12), fontWeight: 800, letterSpacing: 2, paddingTop: s(6), paddingBottom: s(6), paddingLeft: s(16), paddingRight: s(16), borderRadius: s(4) }, children: statusLbl } },
          ] } },
          // Amount
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(11), color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }, children: 'Amount Due' } },
            { type: 'div', props: { style: { fontSize: s(52), fontWeight: 900, color: '#1a1a1a', letterSpacing: -2, lineHeight: 1 }, children: amount || '$0.00' } },
          ] } },
          // Footer
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: s(12), borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: '#eee' }, children: [
            { type: 'div', props: { style: { fontSize: s(13), color: '#555' }, children: `Client: ${headline.slice(0, 30)}` } },
            ...(dueDate ? [{ type: 'div', props: { style: { fontSize: s(12), color: '#888' }, children: `Due: ${dueDate}` } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'proposal-cover': {
      const clientName = opts.recipientName ?? brandName
      const projectName = headline
      const proposalDate = opts.publishDate ?? opts.eventDate ?? ''
      const preparedBy  = opts.agentName ?? brandName
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: tk.headlineFamily, background: '#fafaf8' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: s(8), height: height, background: primaryColor } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: sp(44) }, children: [
          // Top
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(11), fontWeight: 600, letterSpacing: 4, textTransform: 'uppercase' as const, color: '#888' }, children: 'Proposal' } },
            { type: 'div', props: { style: { fontSize: s(11), color: primaryColor, fontWeight: 600 }, children: `Prepared for: ${clientName}` } },
          ] } },
          // Middle
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(16) }, children: [
            { type: 'div', props: { style: { width: s(40), height: s(3), background: primaryColor } } },
            { type: 'div', props: { style: { fontSize: sh(46), fontWeight: tk.headlineWeight, fontStyle: tk.headlineStyle, color: '#1a1a1a', lineHeight: 1.1, letterSpacing: -0.5 }, children: projectName.slice(0, h.lk.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(16), color: '#666', lineHeight: 1.5 }, children: subheadline.slice(0, 100) } }] : []),
          ] } },
          // Bottom
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
              { type: 'div', props: { style: { fontSize: s(12), color: '#888', letterSpacing: 1 }, children: 'Prepared by' } },
              ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(90) } } }]
                : [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: '#1a1a1a' }, children: preparedBy } }]),
            ] } },
            ...(proposalDate ? [{ type: 'div', props: { style: { fontSize: s(12), color: '#888' }, children: proposalDate } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'sports-score': {
      const teamA     = opts.teamA ?? brandName
      const teamB     = opts.teamB ?? headline.split(' vs ').pop() ?? 'Away'
      const scoreA    = opts.scoreA ?? '3'
      const scoreB    = opts.scoreB ?? '1'
      const sport     = opts.sportType ?? 'MATCH'
      const matchStat = opts.matchStatus ?? 'FT'
      const isLive    = matchStat === 'LIVE'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0a0a0a' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.15 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(16), padding: sp(28) }, children: [
          // Sport / badge
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10) }, children: [
            ...(isLive ? [{ type: 'div', props: { style: { background: '#ef4444', color: '#ffffff', fontSize: s(9), fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(3), paddingBottom: s(3), paddingLeft: s(8), paddingRight: s(8), borderRadius: s(3) }, children: '● LIVE' } }] : []),
            { type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' as const }, children: sport } },
          ] } },
          // Score row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(20) }, children: [
            // Team A
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(8), minWidth: s(120) }, children: [
              { type: 'div', props: { style: { fontSize: s(72), fontWeight: 900, color: '#ffffff', lineHeight: 1 }, children: scoreA } },
              { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 1 }, children: teamA.slice(0, 12) } },
            ] } },
            // VS divider
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4) }, children: [
              { type: 'div', props: { style: { fontSize: s(16), fontWeight: 700, color: 'rgba(255,255,255,0.3)' }, children: 'VS' } },
              { type: 'div', props: { style: { fontSize: s(12), fontWeight: 700, color: isLive ? '#ef4444' : 'rgba(255,255,255,0.5)' }, children: matchStat } },
            ] } },
            // Team B
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(8), minWidth: s(120) }, children: [
              { type: 'div', props: { style: { fontSize: s(72), fontWeight: 900, color: '#ffffff', lineHeight: 1 }, children: scoreB } },
              { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 1 }, children: teamB.slice(0, 12) } },
            ] } },
          ] } },
          // Brand footer
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(18), objectFit: 'contain', maxWidth: s(70), opacity: 0.4, marginTop: s(8) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.25)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: brandName } }]),
        ] } },
      ] } }
    }

    case 'sports-player': {
      const playerName = headline
      const jersey     = stat ?? '10'
      const position   = opts.teamRole ?? subheadline ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0a0a0a' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', objectPosition: 'top' } } }]
          : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } }]),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.45), background: 'rgba(0,0,0,0.88)' } } },
        // Jersey number overlay
        { type: 'div', props: { style: { position: 'absolute', top: s(16), right: s(20), fontSize: s(80), fontWeight: 900, color: 'rgba(255,255,255,0.08)', lineHeight: 1, letterSpacing: -4 }, children: jersey } },
        // Bottom info
        { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(24), right: s(24), display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12) }, children: [
            { type: 'div', props: { style: { fontSize: s(28), fontWeight: 900, color: primaryColor } , children: `#${jersey}` } },
            ...(position ? [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.5)' }, children: position } }] : []),
          ] } },
          { type: 'div', props: { style: { fontSize: sh(44), fontWeight: 900, color: '#ffffff', lineHeight: 1, letterSpacing: -1, textTransform: 'uppercase' as const }, children: playerName.slice(0, h.lk.headlineChars) } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(80) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.4)', letterSpacing: 2 }, children: brandName } }]),
        ] } },
      ] } }
    }

    case 'sports-schedule': {
      const teamA2    = opts.teamA ?? brandName
      const teamB2    = opts.teamB ?? headline
      const matchDate = opts.eventDate ?? ''
      const matchTime = opts.eventTime ?? ''
      const venue2    = opts.venue ?? opts.eventLocation ?? ''
      const league    = opts.sportType ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.15 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(16), padding: sp(28) }, children: [
          ...(league ? [{ type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, color: contrastText(primaryColor), opacity: 0.50 }, children: league } }] : []),
          // Teams
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(20) }, children: [
            { type: 'div', props: { style: { fontSize: s(28), fontWeight: 900, color: contrastText(primaryColor), textAlign: 'center', minWidth: s(100) }, children: teamA2.slice(0, 12) } },
            { type: 'div', props: { style: { fontSize: s(18), fontWeight: 700, color: contrastText(primaryColor), opacity: 0.25 }, children: 'VS' } },
            { type: 'div', props: { style: { fontSize: s(28), fontWeight: 900, color: contrastText(primaryColor), textAlign: 'center', minWidth: s(100) }, children: teamB2.slice(0, 12) } },
          ] } },
          // Date/time/venue
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(6) }, children: [
            ...(matchDate || matchTime ? [{ type: 'div', props: { style: { fontSize: s(16), fontWeight: 700, color: contrastText(primaryColor) }, children: [matchDate, matchTime].filter(Boolean).join(' • ') } }] : []),
            ...(venue2 ? [{ type: 'div', props: { style: { fontSize: s(12), color: 'rgba(255,255,255,0.6)' }, children: venue2 } }] : []),
          ] } },
          // CTA
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', color: primaryColor, fontSize: s(12), fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(4), marginTop: s(4) }, children: opts.ctaText ?? 'Buy Tickets' } },
        ] } },
      ] } }
    }

    case 'leaderboard': {
      const items = opts.leaderboardItems ?? [
        { rank: 1, name: 'Champion', score: '9,840', change: '+2' },
        { rank: 2, name: 'Runner Up', score: '8,520', change: '—' },
        { rank: 3, name: 'Third Place', score: '7,100', change: '+1' },
        { rank: 4, name: 'Fourth Place', score: '6,540', change: '-1' },
        { rank: 5, name: 'Fifth Place', score: '5,890', change: '—' },
      ]
      const rankColors = ['#facc15', '#94a3b8', '#cd7f32']
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0a0a0a' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', padding: sp(24), gap: s(12) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(20), fontWeight: 900, color: '#ffffff', letterSpacing: -0.5 }, children: headline.slice(0, 30) } },
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(70) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.35)', letterSpacing: 2 }, children: brandName } }]),
          ] } },
          // Rows
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6), flex: 1, justifyContent: 'center' }, children:
            items.slice(0, 5).map((item: { rank: number; name: string; score: string; change?: string }) => {
              const rankColor = item.rank <= 3 ? rankColors[item.rank - 1] : 'rgba(255,255,255,0.5)'
              const rowBg     = item.rank === 1 ? 'rgba(250,204,21,0.1)' : 'rgba(255,255,255,0.04)'
              return { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16), background: rowBg, borderRadius: s(4), paddingTop: s(8), paddingBottom: s(8), paddingLeft: s(12), paddingRight: s(12) }, children: [
                { type: 'div', props: { style: { fontSize: s(16), fontWeight: 900, color: rankColor, minWidth: s(24), textAlign: 'center' }, children: `${item.rank}` } },
                { type: 'div', props: { style: { flex: 1, fontSize: s(14), fontWeight: 600, color: '#ffffff' }, children: item.name.slice(0, 20) } },
                { type: 'div', props: { style: { fontSize: s(14), fontWeight: 800, color: '#ffffff' }, children: item.score } },
                ...(item.change ? [{ type: 'div', props: { style: { fontSize: s(11), color: item.change.startsWith('+') ? '#22c55e' : item.change.startsWith('-') ? '#ef4444' : '#888', minWidth: s(28), textAlign: 'right' }, children: item.change } }] : []),
              ] } }
            })
          } },
        ] } },
      ] } }
    }

    case 'gaming-achievement': {
      const achievement = opts.achievement ?? headline
      const xp          = opts.xpGained ?? stat ?? '+350 XP'
      const game        = opts.gameTitle ?? subheadline ?? brandName
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0f0f1a' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.15 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(14), padding: sp(36) }, children: [
          { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase' as const, color: primaryColor, background: `${primaryColor}25`, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(14), paddingRight: s(14), borderRadius: s(3) }, children: 'Achievement Unlocked' } },
          { type: 'div', props: { style: { fontSize: s(52) }, children: '🏆' } },
          { type: 'div', props: { style: { fontSize: sh(28), fontWeight: 900, color: '#ffffff', textAlign: h.lta, lineHeight: 1.1 }, children: achievement.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12) }, children: [
            { type: 'div', props: { style: { fontSize: s(16), fontWeight: 900, color: '#facc15' }, children: xp } },
            { type: 'div', props: { style: { width: s(4), height: s(4), borderRadius: 999, background: 'rgba(255,255,255,0.3)' } } },
            { type: 'div', props: { style: { fontSize: s(13), color: 'rgba(255,255,255,0.5)' }, children: game.slice(0, 25) } },
          ] } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(18), objectFit: 'contain', maxWidth: s(70), opacity: 0.4, marginTop: s(4) } } }] : []),
        ] } },
      ] } }
    }

    case 'esports-match': {
      const teamA3   = opts.teamA ?? brandName
      const teamB3   = opts.teamB ?? headline
      const halfW2   = Math.round(w / 2)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', position: 'relative' }, children: [
        // Team A
        { type: 'div', props: { style: { width: halfW2, height: height, flexShrink: 0, background: primaryColor, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(12), position: 'relative', overflow: 'hidden' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: halfW2, height: height, objectFit: 'cover', opacity: 0.2 } } }] : []),
          { type: 'div', props: { style: { fontSize: sh(36), fontWeight: 900, color: contrastText(primaryColor), textTransform: 'uppercase' as const, position: 'relative' as const, textAlign: 'center' }, children: teamA3.slice(0, 12) } },
          { type: 'div', props: { style: { fontSize: s(11), color: contrastText(primaryColor), opacity: 0.50, letterSpacing: 2, textTransform: 'uppercase' as const, position: 'relative' as const }, children: 'Team A' } },
        ] } },
        // VS center
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: halfW2 - s(36), width: s(72), height: height, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }, children: [
          { type: 'div', props: { style: { background: '#000000', borderRadius: 999, width: s(64), height: s(64), display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: [
            { type: 'div', props: { style: { fontSize: s(14), fontWeight: 900, color: '#ffffff', letterSpacing: 1 }, children: 'VS' } },
          ] } },
        ] } },
        // Team B
        { type: 'div', props: { style: { width: halfW2, height: height, flexShrink: 0, background: accentBar, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(12) }, children: [
          { type: 'div', props: { style: { fontSize: sh(36), fontWeight: 900, color: contrastText(accentBar), textTransform: 'uppercase' as const, textAlign: 'center' }, children: teamB3.slice(0, 12) } },
          { type: 'div', props: { style: { fontSize: s(11), color: contrastText(accentBar), opacity: 0.50, letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Team B' } },
        ] } },
        // Match info bottom
        { type: 'div', props: { style: { position: 'absolute', bottom: s(12), left: 0, right: 0, display: 'flex', justifyContent: 'center' }, children: [
          { type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.5)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: [opts.eventDate, opts.sportType].filter(Boolean).join(' • ') || brandName } },
        ] } },
      ] } }
    }

    case 'award-badge': {
      const awardName = headline
      const recipient = opts.recipientName ?? brandName
      const awardOrg  = opts.awardOrg ?? brandName
      const year      = opts.releaseDate ?? new Date().getFullYear().toString()
      const cR        = Math.round(Math.min(w, height) * 0.42)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#fffdf7' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(14) }, children: [
          // Concentric circles badge
          { type: 'div', props: { style: { width: cR, height: cR, borderRadius: 999, background: primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }, children: [
            { type: 'div', props: { style: { width: Math.round(cR * 0.85), height: Math.round(cR * 0.85), borderRadius: 999, background: '#facc15', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }, children: [
              { type: 'div', props: { style: { width: Math.round(cR * 0.68), height: Math.round(cR * 0.68), borderRadius: 999, background: primaryColor, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(4), position: 'relative' }, children: [
                { type: 'div', props: { style: { fontSize: s(28) }, children: '🏅' } },
                { type: 'div', props: { style: { fontSize: s(9), fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' as const, color: contrastText(primaryColor), textAlign: 'center' }, children: 'Best in Class' } },
              ] } },
            ] } },
          ] } },
          // Text below
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: '#1a1a1a', textAlign: 'center' }, children: awardName.slice(0, 30) } },
            { type: 'div', props: { style: { fontSize: s(13), color: '#888', textAlign: 'center' }, children: `${recipient} • ${awardOrg} • ${year}` } },
          ] } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(18), objectFit: 'contain', maxWidth: s(70), opacity: 0.4 } } }] : []),
        ] } },
      ] } }
    }

    case 'trust-badge': {
      const ratingNum  = opts.rating ?? 4.9
      const revCount   = opts.reviewCount ?? '2,847 reviews'
      const platform   = opts.reviewPlatform ?? 'Verified Reviews'
      const stars      = Math.round(ratingNum)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(10), padding: sp(24) }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 2, color: primaryColor, textTransform: 'uppercase' as const }, children: platform } }]),
          { type: 'div', props: { style: { display: 'flex', gap: s(4) }, children:
            Array.from({ length: 5 }, (_, i) => ({ type: 'div', props: { style: { fontSize: s(24), color: i < stars ? '#facc15' : '#ddd' }, children: '★' } }))
          } },
          { type: 'div', props: { style: { fontSize: s(40), fontWeight: 900, color: '#1a1a1a', lineHeight: 1 }, children: String(ratingNum) } },
          { type: 'div', props: { style: { fontSize: s(12), color: '#888' }, children: revCount } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6), background: '#f0fdf4', paddingTop: s(6), paddingBottom: s(6), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(20) }, children: [
            { type: 'div', props: { style: { fontSize: s(12) }, children: '✓' } },
            { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, color: '#16a34a' }, children: 'Verified Reviews' } },
          ] } },
        ] } },
      ] } }
    }

    default: return null
  }
}
