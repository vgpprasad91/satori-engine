import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height, txt, muted, accent: _accent, lightTxt, lightMuted,
          primaryColor, brandName, headline, subheadline, stat, bgImageData, logoData, tk, accentBar, contrastText } = h

  switch (variant) {

    case 'newsletter-header': {
      const issueNum  = opts.issueNumber ?? opts.episodeNumber ?? ''
      const issueDate = opts.publishDate ?? opts.eventDate ?? ''
      const tagline2  = opts.tagline ?? subheadline ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.15 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: s(44), paddingRight: s(44) }, children: [
          // Left: logo + tagline
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8), flex: 1 }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(36), objectFit: 'contain', maxWidth: s(160) } } }]
              : [{ type: 'div', props: { style: { fontSize: sh(28), fontWeight: 900, color: contrastText(primaryColor), letterSpacing: -0.5 }, children: brandName } }]),
            ...(tagline2 ? [{ type: 'div', props: { style: { fontSize: s(13), color: contrastText(primaryColor), opacity: 0.50 }, children: tagline2.slice(0, 60) } }] : []),
          ] } },
          // Right: issue info
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: s(6) }, children: [
            ...(issueNum ? [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: contrastText(primaryColor), opacity: 0.44 }, children: `Issue ${issueNum}` } }] : []),
            ...(issueDate ? [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 600, color: contrastText(primaryColor) }, children: issueDate } }] : []),
            { type: 'div', props: { style: { fontSize: s(11), color: contrastText(primaryColor), opacity: 0.31, letterSpacing: 2, textTransform: 'uppercase' as const }, children: headline.slice(0, 20) } },
          ] } },
        ] } },
      ] } }
    }

    case 'book-cover': {
      const author2  = opts.author ?? brandName
      const subtitle = subheadline ?? ''
      const isbn     = opts.isbn ?? ''
      const spineW   = s(14)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: tk.headlineFamily, position: 'relative' }, children: [
        // Spine
        { type: 'div', props: { style: { width: spineW, height: height, flexShrink: 0, background: accentBar } } },
        // Cover
        { type: 'div', props: { style: { flex: 1, height: height, position: 'relative', overflow: 'hidden', background: primaryColor, display: 'flex' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: height, objectFit: 'cover', opacity: 0.4 } } }] : []),
          { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: s(32) }, children: [
            // Author
            { type: 'div', props: { style: { fontSize: s(12), fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.7)' }, children: author2 } },
            // Main title
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(12) }, children: [
              { type: 'div', props: { style: { fontSize: sh(52), fontWeight: tk.headlineWeight, fontStyle: tk.headlineStyle, color: h.sTxt, lineHeight: 1.05, letterSpacing: -0.5 }, children: headline.slice(0, h.lk.headlineChars) } },
              ...(subtitle ? [{ type: 'div', props: { style: { fontSize: sb(16), color: h.sMuted, lineHeight: 1.4 }, children: subtitle.slice(0, 60) } }] : []),
            ] } },
            // Publisher / ISBN
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
              ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
                : [{ type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.4)', letterSpacing: 2 }, children: brandName } }]),
              ...(isbn ? [{ type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.35)', letterSpacing: 1 }, children: `ISBN ${isbn}` } }] : []),
            ] } },
          ] } },
        ] } },
      ] } }
    }

    case 'magazine-cover': {
      const issueDate = opts.publishDate ?? opts.eventDate ?? ''
      const coverLines = (opts.changelogItems ?? []).slice(0, 3)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover' } } }]
          : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } }]),
        // Top scrim for masthead
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: Math.round(height * 0.28), background: 'rgba(0,0,0,0.75)' } } },
        // Bottom scrim for cover lines
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.32), background: 'rgba(0,0,0,0.72)' } } },
        // Masthead
        { type: 'div', props: { style: { position: 'absolute', top: s(16), left: s(20), right: s(20), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(36), objectFit: 'contain', maxWidth: s(160) } } }]
            : [{ type: 'div', props: { style: { fontSize: sh(36), fontWeight: 900, color: h.sTxt, letterSpacing: -1, fontFamily: tk.headlineFamily, fontStyle: tk.headlineStyle }, children: brandName } }]),
          ...(issueDate ? [{ type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.6)', textAlign: 'right', lineHeight: 1.4 }, children: issueDate } }] : []),
        ] } },
        // Main headline
        { type: 'div', props: { style: { position: 'absolute', top: Math.round(height * 0.32), left: s(20), right: s(20), display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
          { type: 'div', props: { style: { fontSize: sh(52), fontWeight: 900, color: h.sTxt, lineHeight: 1.05, letterSpacing: -1.5, textShadow: '0 2px 10px rgba(0,0,0,0.5)' }, children: headline.slice(0, h.lk.headlineChars) } },
        ] } },
        // Cover lines
        { type: 'div', props: { style: { position: 'absolute', bottom: s(20), left: s(20), right: s(20), display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
          ...coverLines.map((cl: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { width: s(3), height: s(14), background: primaryColor, flexShrink: 0 } } },
            { type: 'div', props: { style: { fontSize: s(13), fontWeight: 600, color: h.sTxt }, children: cl.slice(0, 60) } },
          ] } })),
          ...(!coverLines.length ? [{ type: 'div', props: { style: { fontSize: s(13), color: 'rgba(255,255,255,0.6)' }, children: subheadline?.slice(0, 80) ?? brandName } }] : []),
        ] } },
      ] } }
    }

    case 'blog-post-card': {
      const category2  = opts.category ?? 'Article'
      const readTime   = opts.readTime ?? '5 min read'
      const author2    = opts.author ?? brandName
      const pubDate    = opts.publishDate ?? opts.releaseDate ?? ''
      const hasImage   = !!bgImageData
      const textW      = hasImage ? Math.round(w * 0.58) : w
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        // Text panel
        { type: 'div', props: { style: { width: textW, height: height, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(14), paddingLeft: sp(36), paddingRight: sp(28), paddingTop: sp(28), paddingBottom: sp(28) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10) }, children: [
            { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: primaryColor, background: `${primaryColor}15`, paddingTop: s(3), paddingBottom: s(3), paddingLeft: s(8), paddingRight: s(8), borderRadius: s(3) }, children: category2 } },
            ...(readTime ? [{ type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: readTime } }] : []),
          ] } },
          { type: 'div', props: { style: { fontSize: sh(26), fontWeight: 800, color: '#1a1a1a', lineHeight: 1.25, letterSpacing: -0.3 }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(14), color: '#555', lineHeight: 1.55 }, children: subheadline.slice(0, 120) } }] : []),
          // Author row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10), paddingTop: s(10), borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: '#eee' }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(60) } } }]
              : [{ type: 'div', props: { style: { width: s(28), height: s(28), borderRadius: 999, background: primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: [
                { type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, color: contrastText(primaryColor) }, children: author2.slice(0, 1).toUpperCase() } },
              ] } }]),
            { type: 'div', props: { style: { display: 'flex', gap: s(6), alignItems: 'center' }, children: [
              { type: 'div', props: { style: { fontSize: s(12), fontWeight: 600, color: '#333' }, children: author2 } },
              ...(pubDate ? [
                { type: 'div', props: { style: { fontSize: s(11), color: '#bbb' }, children: '·' } },
                { type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: pubDate } },
              ] : []),
            ] } },
          ] } },
        ] } },
        // Image panel
        ...(hasImage ? [{ type: 'div', props: { style: { width: w - textW, height: height, position: 'relative', overflow: 'hidden', flexShrink: 0 }, children: [
          { type: 'img', props: { src: bgImageData!, style: { position: 'absolute', top: 0, left: 0, width: w - textW, height: height, objectFit: 'cover' } } },
        ] } }] : []),
      ] } }
    }

    case 'infographic-stat': {
      const bigStat  = stat ?? headline.match(/\d[\d.,×xX%+]+/)?.[0] ?? '94%'
      const context  = headline
      const source   = brandName
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: s(8), height: height, background: primaryColor } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(16), paddingLeft: sp(44), paddingRight: sp(44) }, children: [
          { type: 'div', props: { style: { fontSize: s(110), fontWeight: 900, color: primaryColor, lineHeight: 1.0, letterSpacing: -4, textAlign: 'center' }, children: bigStat } },
          { type: 'div', props: { style: { fontSize: sb(22), fontWeight: 600, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight, textAlign: h.lta, lineHeight: 1.3, width: Math.round(w * h.lk.textMaxFrac) }, children: context.slice(0, 80) } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { width: s(28), height: s(2), background: muted } } },
            { type: 'div', props: { style: { fontSize: s(11), color: muted, letterSpacing: 2, textTransform: 'uppercase' as const }, children: source } },
            { type: 'div', props: { style: { width: s(28), height: s(2), background: muted } } },
          ] } },
        ] } },
      ] } }
    }

    case 'press-release': {
      const prDate  = opts.publishDate ?? opts.eventDate ?? ''
      const city    = opts.eventLocation ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', padding: sp(32), gap: s(14) }, children: [
          // FOR IMMEDIATE RELEASE header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, color: primaryColor }, children: 'For Immediate Release' } },
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(100) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, color: '#888' }, children: brandName } }]),
          ] } },
          { type: 'div', props: { style: { width: '100%', height: s(2), background: '#000000' } } },
          // Date + city
          ...(prDate || city ? [{ type: 'div', props: { style: { fontSize: s(12), color: '#666', fontStyle: 'italic' }, children: [city, prDate].filter(Boolean).join(', ') } }] : []),
          // Headline
          { type: 'div', props: { style: { fontSize: sh(26), fontWeight: 900, color: '#1a1a1a', lineHeight: 1.2, letterSpacing: -0.3 }, children: headline.slice(0, h.lk.headlineChars) } },
          // Body excerpt
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(14), color: '#444', lineHeight: 1.65, flex: 1 }, children: subheadline.slice(0, 200) } }] : []),
          // Contact footer
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', paddingTop: s(8), borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: '#ddd', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: `Contact: press@${brandName.toLowerCase().replace(/\s+/g, '')}.com` } },
            { type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: '###' } },
          ] } },
        ] } },
      ] } }
    }

    case 'google-review': {
      const reviewTxt  = opts.reviewText ?? headline
      const reviewer   = opts.reviewerName ?? 'A Verified Customer'
      const reviewDate = opts.publishDate ?? opts.eventDate ?? ''
      const starRating = Math.max(1, Math.min(5, Math.round(opts.rating ?? 5)))
      const gColors    = ['#4285F4', '#EA4335', '#FBBC04', '#34A853']
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(16), padding: sp(36) }, children: [
          // Google badge
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10) }, children: [
            // G logo approximation
            { type: 'div', props: { style: { display: 'flex', gap: s(1) }, children:
              ['G','o','o','g','l','e'].map((letter: string, i: number) => ({ type: 'div', props: { style: { fontSize: s(18), fontWeight: 900, color: gColors[i % gColors.length] }, children: letter } }))
            } },
            { type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: 'Review' } },
          ] } },
          // Stars
          { type: 'div', props: { style: { display: 'flex', gap: s(3) }, children:
            Array.from({ length: 5 }, (_, i) => ({ type: 'div', props: { style: { fontSize: s(20), color: i < starRating ? '#FBBC04' : '#ddd' }, children: '★' } }))
          } },
          // Review text
          { type: 'div', props: { style: { fontSize: sb(20), color: '#1a1a1a', lineHeight: 1.55, fontStyle: 'italic' }, children: `"${reviewTxt.slice(0, 200)}"` } },
          // Reviewer + business
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: '#333' }, children: reviewer } },
              ...(reviewDate ? [{ type: 'div', props: { style: { fontSize: s(12), color: '#888' }, children: reviewDate } }] : []),
            ] } },
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(90) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: 700, color: primaryColor }, children: brandName } }]),
          ] } },
        ] } },
      ] } }
    }

    case 'star-rating': {
      const avg     = opts.rating ?? 4.8
      const cnt     = opts.reviewCount ?? '2,847 reviews'
      const plat    = opts.reviewPlatform ?? brandName
      const starsN  = Math.round(avg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(12), padding: sp(32) }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(26), objectFit: 'contain', maxWidth: s(110) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight }, children: plat } }]),
          { type: 'div', props: { style: { display: 'flex', gap: s(6) }, children:
            Array.from({ length: 5 }, (_, i) => ({ type: 'div', props: { style: { fontSize: s(36), color: i < starsN ? '#facc15' : '#ddd' }, children: '★' } }))
          } },
          { type: 'div', props: { style: { fontSize: s(64), fontWeight: 900, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight, lineHeight: 1, letterSpacing: -2 }, children: String(avg) } },
          { type: 'div', props: { style: { fontSize: s(14), color: muted }, children: cnt } },
        ] } },
      ] } }
    }

    case 'nps-score': {
      const nps        = opts.npsScore ?? 72
      const promoters  = opts.promoters ?? '78%'
      const detractors = opts.detractors ?? '8%'
      const passives   = opts.tagline ?? '14%'
      const npsColor   = nps >= 50 ? '#22c55e' : nps >= 0 ? '#f59e0b' : '#ef4444'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(20), padding: sp(36) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
              { type: 'div', props: { style: { fontSize: s(11), color: '#888', letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Net Promoter Score' } },
              { type: 'div', props: { style: { fontSize: s(72), fontWeight: 900, color: npsColor, lineHeight: 1, letterSpacing: -3 }, children: String(nps) } },
            ] } },
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(110) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: '#333' }, children: brandName } }]),
          ] } },
          // Breakdown bars
          { type: 'div', props: { style: { display: 'flex', gap: s(16) }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), flex: 1 }, children: [
              { type: 'div', props: { style: { height: s(8), background: '#22c55e', borderRadius: s(4), width: promoters } } },
              { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between' }, children: [
                { type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: 'Promoters' } },
                { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: '#22c55e' }, children: promoters } },
              ] } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), width: s(80), flexShrink: 0 }, children: [
              { type: 'div', props: { style: { height: s(8), background: '#888', borderRadius: s(4) } } },
              { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between' }, children: [
                { type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: 'Passive' } },
                { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: '#888' }, children: passives } },
              ] } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), width: s(80), flexShrink: 0 }, children: [
              { type: 'div', props: { style: { height: s(8), background: '#ef4444', borderRadius: s(4) } } },
              { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between' }, children: [
                { type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: 'Detractors' } },
                { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: '#ef4444' }, children: detractors } },
              ] } },
            ] } },
          ] } },
        ] } },
      ] } }
    }

    case 'case-study': {
      const result      = stat ?? '3x ROI'
      const client      = opts.recipientName ?? brandName
      const timeframe   = opts.duration ?? ''
      const challenge   = subheadline ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: s(6), height: height, background: primaryColor } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(16), paddingLeft: sp(36), paddingRight: sp(36) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10) }, children: [
            { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, color: primaryColor, background: `${primaryColor}15`, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(3) }, children: 'Case Study' } },
            { type: 'div', props: { style: { fontSize: s(13), fontWeight: 600, color: '#888' }, children: client } },
          ] } },
          { type: 'div', props: { style: { fontSize: sh(28), fontWeight: 800, color: '#1a1a1a', lineHeight: 1.2 }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(challenge ? [{ type: 'div', props: { style: { fontSize: sb(14), color: '#555', lineHeight: 1.5 }, children: challenge.slice(0, 120) } }] : []),
          // Result metric
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16) }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(48), fontWeight: 900, color: primaryColor, lineHeight: 1, letterSpacing: -2 }, children: result } },
              { type: 'div', props: { style: { fontSize: s(11), color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }, children: `Result${timeframe ? ` in ${timeframe}` : ''}` } },
            ] } },
            ...(logoData ? [{ type: 'div', props: { style: { flex: 1, display: 'flex', justifyContent: 'flex-end' }, children: [
              { type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(110) } } },
            ] } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'gift-card': {
      const giftAmt  = opts.giftAmount ?? opts.price ?? '$50'
      const fromName = opts.giftFrom ?? `From: ${brandName}`
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        // Decorative circles
        { type: 'div', props: { style: { position: 'absolute', top: s(-60), right: s(-60), width: s(240), height: s(240), borderRadius: 999, background: 'rgba(255,255,255,0.08)' } } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(-40), left: s(-40), width: s(180), height: s(180), borderRadius: 999, background: 'rgba(255,255,255,0.06)' } } },
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.1 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: s(28) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(90) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, letterSpacing: 3, color: contrastText(primaryColor), opacity: 0.50, textTransform: 'uppercase' as const }, children: brandName } }]),
            { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: contrastText(primaryColor), opacity: 0.38, borderWidth: 1, borderStyle: 'solid', borderColor: contrastText(primaryColor) === '#ffffff' ? 'rgba(255,255,255,0.19)' : 'rgba(17,17,17,0.19)', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: 'Gift Card' } },
          ] } },
          // Amount
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(6) }, children: [
            { type: 'div', props: { style: { display: 'flex', fontSize: s(68), fontWeight: 900, color: h.sTxt, lineHeight: 1, letterSpacing: -3 }, children: giftAmt } },
            { type: 'div', props: { style: { fontSize: s(13), color: contrastText(primaryColor), opacity: 0.44 }, children: fromName } },
          ] } },
          // Footer
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { fontSize: s(12), color: contrastText(primaryColor), opacity: 0.31 }, children: headline.slice(0, 30) } },
            { type: 'div', props: { style: { fontSize: s(10), color: contrastText(primaryColor), opacity: 0.25, letterSpacing: 3, fontFamily: 'Inter' }, children: '•••• •••• ••••' } },
          ] } },
        ] } },
      ] } }
    }

    case 'loyalty-card': {
      const points   = opts.loyaltyPoints ?? stat ?? '2,450'
      const tier     = opts.loyaltyTier ?? 'Gold'
      const member   = opts.recipientName ?? brandName
      const tierColors: Record<string, string> = { Gold: '#facc15', Silver: '#94a3b8', Platinum: '#e2e8f0', Bronze: '#cd7f32' }
      const tierColor = tierColors[tier] ?? primaryColor
      const nextTier = opts.referralBonus ?? '550 more points to Platinum'
      const progress = opts.savingsProgress ?? 65
      const barFill  = Math.round((progress / 100) * (w - s(80)))
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: s(-40), right: s(-40), width: s(200), height: s(200), borderRadius: 999, background: 'rgba(255,255,255,0.06)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: s(28) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, color: contrastText(primaryColor), opacity: 0.50, letterSpacing: 2 }, children: brandName } }]),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6), background: 'rgba(255,255,255,0.15)', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(20) }, children: [
              { type: 'div', props: { style: { fontSize: s(12) }, children: '★' } },
              { type: 'div', props: { style: { fontSize: s(11), fontWeight: 800, color: tierColor }, children: tier } },
            ] } },
          ] } },
          // Points
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(11), color: contrastText(primaryColor), opacity: 0.38, letterSpacing: 1, textTransform: 'uppercase' as const }, children: 'Points Balance' } },
            { type: 'div', props: { style: { fontSize: s(44), fontWeight: 900, color: h.sTxt, lineHeight: 1, letterSpacing: -1 }, children: points } },
          ] } },
          // Progress
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
            { type: 'div', props: { style: { width: w - s(56), height: s(6), background: 'rgba(255,255,255,0.2)', borderRadius: s(3), position: 'relative', overflow: 'hidden', display: 'flex' }, children: [
              { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, height: s(6), width: barFill, background: tierColor, borderRadius: s(3) } } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
              { type: 'div', props: { style: { fontSize: s(11), color: contrastText(primaryColor), opacity: 0.38 }, children: member.slice(0, 20) } },
              { type: 'div', props: { style: { fontSize: s(10), color: contrastText(primaryColor), opacity: 0.31 }, children: nextTier.slice(0, 40) } },
            ] } },
          ] } },
        ] } },
      ] } }
    }

    default: return null
  }
}
