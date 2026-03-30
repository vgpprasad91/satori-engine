import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height, txt, muted, accent: _accent, lightTxt, lightMuted,
          primaryColor, brandName, headline, subheadline, stat, bgImageData, logoData, tk, accentBar, contrastText } = h

  switch (variant) {

    case 'tweet-card': {
      const tweetText  = opts.tweetText ?? headline
      const handle     = opts.tweetAuthor ?? brandName
      const displayName = opts.tweetHandle ?? brandName
      const likes      = opts.tweetLikes ?? ''
      const retweets   = opts.tweetRetweets ?? ''
      const replies    = opts.tweetReplies ?? ''
      const cardBg     = '#ffffff'
      const cardTxt    = '#0f1419'
      const cardMuted  = '#536471'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: cardBg }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: sp(40), gap: s(20) }, children: [
          // Header row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12) }, children: [
              { type: 'div', props: { style: { width: s(44), height: s(44), borderRadius: 999, background: primaryColor, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: [
                { type: 'div', props: { style: { fontSize: s(18), fontWeight: 900, color: contrastText(primaryColor) }, children: handle.slice(0, 1).toUpperCase() } },
              ] } },
              { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
                { type: 'div', props: { style: { fontSize: s(15), fontWeight: 700, color: cardTxt }, children: displayName } },
                { type: 'div', props: { style: { fontSize: s(13), color: cardMuted }, children: `@${handle}` } },
              ] } },
            ] } },
            { type: 'div', props: { style: { fontSize: s(20), color: '#1d9bf0', fontWeight: 900 }, children: '𝕏' } },
          ] } },
          // Tweet text
          { type: 'div', props: { style: { fontSize: s(24), fontWeight: 400, color: cardTxt, lineHeight: 1.5 }, children: tweetText.slice(0, 200) } },
          // Stats row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(24), paddingTop: s(8), borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'rgba(0,0,0,0.08)' }, children: [
            ...(replies ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: [
              { type: 'div', props: { style: { fontSize: s(14), color: cardMuted }, children: '💬' } },
              { type: 'div', props: { style: { fontSize: s(13), color: cardMuted }, children: replies } },
            ] } }] : []),
            ...(retweets ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: [
              { type: 'div', props: { style: { fontSize: s(14), color: '#00ba7c' }, children: '↻' } },
              { type: 'div', props: { style: { fontSize: s(13), color: cardMuted }, children: retweets } },
            ] } }] : []),
            ...(likes ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: [
              { type: 'div', props: { style: { fontSize: s(14), color: '#f91880' }, children: '♥' } },
              { type: 'div', props: { style: { fontSize: s(13), color: cardMuted }, children: likes } },
            ] } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'linkedin-article': {
      const readTime   = opts.readTime ?? '5 min read'
      const category   = opts.category ?? 'Article'
      const author     = opts.author ?? brandName
      const pubDate    = opts.publishDate ?? opts.releaseDate ?? ''
      const panelW     = Math.round(w * 0.42)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        // Left panel
        { type: 'div', props: { style: { width: panelW, height: height, flexShrink: 0, background: primaryColor, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(16), position: 'relative', overflow: 'hidden' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: panelW, height: height, objectFit: 'cover', opacity: 0.3 } } }] : []),
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(44), objectFit: 'contain', maxWidth: s(160), position: 'relative' } } }]
            : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase' as const, color: contrastText(primaryColor), position: 'relative' as const }, children: brandName } }]),
          { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.6)', position: 'relative' as const }, children: 'LinkedIn' } },
        ] } },
        // Right panel
        { type: 'div', props: { style: { flex: 1, height: height, background: '#ffffff', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(14), paddingLeft: s(36), paddingRight: s(36) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: primaryColor, background: `${primaryColor}18`, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: category } },
            ...(readTime ? [{ type: 'div', props: { style: { fontSize: s(11), color: '#666' }, children: readTime } }] : []),
          ] } },
          { type: 'div', props: { style: { fontSize: sh(28), fontWeight: 800, color: '#1a1a1a', lineHeight: 1.2, letterSpacing: -0.3 }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(14), color: '#666', lineHeight: 1.5 }, children: subheadline.slice(0, 100) } }] : []),
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(12), fontWeight: 600, color: '#1a1a1a' }, children: author } },
            ...(pubDate ? [
              { type: 'div', props: { style: { width: s(3), height: s(3), borderRadius: 999, background: '#ccc' } } },
              { type: 'div', props: { style: { fontSize: s(12), color: '#888' }, children: pubDate } },
            ] : []),
          ] } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a66c2', color: h.paletteContrastText('#0a66c2'), fontSize: s(12), fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(11), paddingBottom: s(11), paddingLeft: s(24), paddingRight: s(24), borderRadius: s(3), alignSelf: 'flex-start' }, children: 'Read on LinkedIn' } },
        ] } },
      ] } }
    }

    case 'product-hunt': {
      const upvotes   = opts.upvotes ?? stat ?? ''
      const tagline2  = subheadline ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(16), padding: sp(48) }, children: [
          { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, color: '#da552f', background: '#da552f18', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(3) }, children: 'Product of the Day' } },
          { type: 'div', props: { style: { fontSize: s(64) }, children: '🚀' } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(36), objectFit: 'contain', maxWidth: s(140) } } }]
            : [{ type: 'div', props: { style: { fontSize: sh(36), fontWeight: 900, color: '#1a1a1a', letterSpacing: -1 }, children: headline.slice(0, h.lk.headlineChars) } }]),
          ...(tagline2 ? [{ type: 'div', props: { style: { fontSize: s(16), color: '#666', textAlign: h.lta, width: Math.round(w * h.lk.textMaxFrac) }, children: tagline2.slice(0, 80) } }] : []),
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#da552f', color: h.paletteContrastText('#da552f'), fontSize: s(13), fontWeight: 700, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(20), paddingRight: s(20), borderRadius: s(4), gap: s(6) }, children: [
              { type: 'div', props: { children: '▲' } },
              ...(upvotes ? [{ type: 'div', props: { children: upvotes } }] : []),
            ] } },
            { type: 'div', props: { style: { fontSize: s(12), fontWeight: 600, color: '#888' }, children: brandName } },
          ] } },
        ] } },
      ] } }
    }

    case 'reddit-post': {
      const upvotes   = opts.upvotes ?? stat ?? '2.4K'
      const subreddit = opts.subreddit ?? `r/${brandName}`
      const comments  = opts.tweetReplies ?? '247'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }, children: [
          // Vote column
          { type: 'div', props: { style: { width: s(60), height: height, flexShrink: 0, background: '#f6f7f8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: s(16), gap: s(6) }, children: [
            { type: 'div', props: { style: { fontSize: s(18), color: '#ff4500', fontWeight: 900 }, children: '▲' } },
            { type: 'div', props: { style: { fontSize: s(13), fontWeight: 800, color: '#1c1c1c' }, children: upvotes } },
            { type: 'div', props: { style: { fontSize: s(18), color: '#ccc' }, children: '▼' } },
          ] } },
          // Content
          { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(12), paddingLeft: s(20), paddingRight: s(28), paddingTop: s(20), paddingBottom: s(20) }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, color: '#ff4500' }, children: subreddit } },
              { type: 'div', props: { style: { fontSize: s(11), color: '#878a8c' }, children: '• Posted by' } },
              { type: 'div', props: { style: { fontSize: s(11), color: '#878a8c' }, children: `u/${brandName}` } },
            ] } },
            { type: 'div', props: { style: { fontSize: sb(26), fontWeight: 700, color: '#1c1c1c', lineHeight: 1.3 }, children: headline.slice(0, h.lk.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(14), color: '#878a8c', lineHeight: 1.5 }, children: subheadline.slice(0, 120) } }] : []),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16), paddingTop: s(8), borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'rgba(0,0,0,0.06)' }, children: [
              { type: 'div', props: { style: { fontSize: s(12), color: '#878a8c', fontWeight: 600 }, children: `💬 ${comments} Comments` } },
              { type: 'div', props: { style: { fontSize: s(12), color: '#878a8c', fontWeight: 600 }, children: '⟳ Share' } },
            ] } },
          ] } },
        ] } },
      ] } }
    }

    case 'instagram-quote': {
      const quoteText = opts.reviewText ?? headline
      const author2   = opts.reviewerName ?? brandName
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: tk.headlineFamily }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover' } } }]
          : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: tk.panelBg } } }]),
        ...(bgImageData ? [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.82)' } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: sp(56) }, children: [
          { type: 'div', props: { style: { display: 'flex', fontSize: s(80), fontWeight: 900, color: primaryColor, lineHeight: 1.0, opacity: 0.4, marginBottom: s(4), fontFamily: 'Inter' }, children: '\u201C' } },
          { type: 'div', props: { style: { fontSize: sb(32), fontWeight: tk.headlineWeight, fontStyle: tk.headlineStyle, lineHeight: 1.45, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight, textAlign: 'center', width: Math.round(w * h.lk.textMaxFrac) }, children: quoteText.slice(0, 150) } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(8), marginTop: s(32) }, children: [
            { type: 'div', props: { style: { width: s(40), height: s(2), background: primaryColor } } },
            { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: primaryColor, letterSpacing: 2, textTransform: 'uppercase' as const }, children: author2 } },
          ] } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(80), opacity: 0.4, marginTop: s(16) } } }] : []),
        ] } },
      ] } }
    }

    case 'tiktok-caption': {
      const hashtags = (opts.changelogItems ?? []).slice(0, 5)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#000000' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.5 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.6), background: 'rgba(0,0,0,0.65)' } } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(28), left: s(24), right: s(80), display: 'flex' }, children: [
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(12) }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(80) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 800, color: h.sTxt, letterSpacing: 1 }, children: `@${brandName}` } }]),
            { type: 'div', props: { style: { fontSize: sb(22), fontWeight: 700, color: h.sTxt, lineHeight: 1.3 }, children: headline.slice(0, h.lk.headlineChars) } },
            { type: 'div', props: { style: { display: 'flex', flexWrap: 'nowrap', gap: s(8) }, children: [
              ...hashtags.map((tag: string) => ({ type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: primaryColor }, children: `#${tag.replace(/\s+/g, '')}` } })),
              ...(!hashtags.length ? [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: primaryColor }, children: `#${brandName}` } }] : []),
            ] } },
          ] } },
        ] } },
        // Side buttons
        { type: 'div', props: { style: { position: 'absolute', right: s(16), bottom: s(28), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(20) }, children: [
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(28) }, children: '♥' } },
            { type: 'div', props: { style: { fontSize: s(11), color: h.sTxt, fontWeight: 600 }, children: opts.tweetLikes ?? '' } },
          ] } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(28) }, children: '💬' } },
            { type: 'div', props: { style: { fontSize: s(11), color: h.sTxt, fontWeight: 600 }, children: opts.tweetReplies ?? '' } },
          ] } },
        ] } },
      ] } }
    }

    case 'discord-announcement': {
      const serverName = brandName
      const msgBody    = subheadline ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#36393f' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }, children: [
          // Server header
          { type: 'div', props: { style: { background: '#2f3136', paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(20), paddingRight: s(20), display: 'flex', alignItems: 'center', gap: s(10) }, children: [
            { type: 'div', props: { style: { width: s(32), height: s(32), borderRadius: 999, background: primaryColor, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: [
              { type: 'div', props: { style: { fontSize: s(14), fontWeight: 900, color: contrastText(primaryColor) }, children: serverName.slice(0, 1).toUpperCase() } },
            ] } },
            { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: h.sTxt }, children: serverName } },
            { type: 'div', props: { style: { fontSize: s(11), color: '#72767d', marginLeft: s(8) }, children: '#announcements' } },
          ] } },
          // Message area with left border embed
          { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: s(24) }, children: [
            { type: 'div', props: { style: { display: 'flex', gap: s(16), alignItems: 'flex-start' }, children: [
              // Avatar
              { type: 'div', props: { style: { width: s(40), height: s(40), borderRadius: 999, background: primaryColor, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: [
                { type: 'div', props: { style: { fontSize: s(18) }, children: '📢' } },
              ] } },
              // Message content
              { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
                { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: s(8) }, children: [
                  { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: primaryColor }, children: 'Announcements' } },
                  { type: 'div', props: { style: { fontSize: s(11), color: '#72767d' }, children: 'Today at 12:00 PM' } },
                ] } },
                // Embed block
                { type: 'div', props: { style: { display: 'flex', gap: 0, marginTop: s(4) }, children: [
                  { type: 'div', props: { style: { width: s(4), background: primaryColor, borderRadius: s(2), flexShrink: 0 } } },
                  { type: 'div', props: { style: { flex: 1, background: '#2f3136', borderRadius: s(4), paddingTop: s(10), paddingBottom: s(12), paddingLeft: s(14), paddingRight: s(14), display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
                    { type: 'div', props: { style: { fontSize: sb(20), fontWeight: 800, color: h.sTxt, lineHeight: 1.2 }, children: headline.slice(0, h.lk.headlineChars) } },
                    ...(msgBody ? [{ type: 'div', props: { style: { fontSize: s(14), color: '#dcddde', lineHeight: 1.5 }, children: msgBody.slice(0, 150) } }] : []),
                  ] } },
                ] } },
              ] } },
            ] } },
          ] } },
          // Online indicator footer
          { type: 'div', props: { style: { background: '#2f3136', paddingTop: s(8), paddingBottom: s(8), paddingLeft: s(20), paddingRight: s(20), display: 'flex', alignItems: 'center', gap: s(6) }, children: [
            { type: 'div', props: { style: { width: s(8), height: s(8), borderRadius: 999, background: '#23a55a' } } },
            { type: 'div', props: { style: { fontSize: s(11), color: '#72767d' }, children: `${brandName} is online` } },
          ] } },
        ] } },
      ] } }
    }

    case 'github-stats': {
      const repo      = opts.githubRepo ?? headline
      const desc      = opts.subheadline ?? subheadline ?? ''
      const stars     = opts.githubStars ?? stat ?? ''
      const forks     = opts.githubForks ?? ''
      const lang      = opts.githubLanguage ?? 'TypeScript'
      const commits   = opts.githubCommits ?? ''
      const langColors: Record<string, string> = {
        TypeScript: '#3178c6', JavaScript: '#f7df1e', Python: '#3572a5',
        Rust: '#dea584', Go: '#00add8', Ruby: '#701516', Java: '#b07219',
      }
      const langColor = langColors[lang] ?? primaryColor
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0d1117' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', padding: s(32), gap: s(20) }, children: [
          // Header row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10) }, children: [
              { type: 'div', props: { style: { fontSize: s(18), color: '#c9d1d9', fontWeight: 600, fontFamily: 'Inter' }, children: '📦' } },
              { type: 'div', props: { style: { fontSize: s(18), fontWeight: 700, color: '#58a6ff' }, children: repo.slice(0, 40) } },
            ] } },
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(20), color: '#c9d1d9' }, children: '⬡' } }]),
          ] } },
          // Description
          ...(desc ? [{ type: 'div', props: { style: { fontSize: s(16), color: '#8b949e', lineHeight: 1.5 }, children: desc.slice(0, 100) } }] : []),
          // Stats row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(20), flexWrap: 'nowrap' }, children: [
            ...(stars ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: [
              { type: 'div', props: { style: { fontSize: s(14), color: '#e3b341' }, children: '★' } },
              { type: 'div', props: { style: { fontSize: s(14), color: '#c9d1d9' }, children: stars } },
            ] } }] : []),
            ...(forks ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: [
              { type: 'div', props: { style: { fontSize: s(13), color: '#8b949e' }, children: '⑂' } },
              { type: 'div', props: { style: { fontSize: s(14), color: '#c9d1d9' }, children: forks } },
            ] } }] : []),
            ...(commits ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: [
              { type: 'div', props: { style: { fontSize: s(13), color: '#8b949e' }, children: '●' } },
              { type: 'div', props: { style: { fontSize: s(14), color: '#c9d1d9' }, children: commits } },
            ] } }] : []),
          ] } },
          // Language badge
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { width: s(12), height: s(12), borderRadius: 999, background: langColor, flexShrink: 0 } } },
            { type: 'div', props: { style: { fontSize: s(13), color: '#c9d1d9' }, children: lang } },
          ] } },
        ] } },
      ] } }
    }

    case 'npm-package': {
      const pkgName  = opts.packageName ?? headline
      const version  = opts.packageVersion ?? opts.version ?? '^1.0.0'
      const desc     = opts.subheadline ?? subheadline ?? ''
      const downloads = opts.packageDownloads ?? ''
      const installCmd = `npm install ${pkgName}`
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', padding: s(32), gap: s(16) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12) }, children: [
              { type: 'div', props: { style: { background: '#cb3837', color: h.paletteContrastText('#cb3837'), fontSize: s(12), fontWeight: 900, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(6), paddingRight: s(6), borderRadius: s(3) }, children: 'npm' } },
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 800, color: '#1a1a1a' }, children: pkgName.slice(0, 30) } },
            ] } },
            { type: 'div', props: { style: { fontSize: s(13), fontWeight: 600, color: '#cb3837', background: '#cb383718', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(20) }, children: version } },
          ] } },
          ...(desc ? [{ type: 'div', props: { style: { fontSize: s(15), color: '#555', lineHeight: 1.5 }, children: desc.slice(0, 100) } }] : []),
          // Install command
          { type: 'div', props: { style: { background: '#1a1a1a', borderRadius: s(6), paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(16), paddingRight: s(16), display: 'flex' }, children: [
            { type: 'div', props: { style: { fontSize: s(14), fontFamily: 'Inter', color: '#4ade80', letterSpacing: 0.3 }, children: `$ ${installCmd}` } },
          ] } },
          // Downloads stat
          ...(downloads ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(20), color: primaryColor } , children: '↓' } },
            { type: 'div', props: { style: { fontSize: s(20), fontWeight: 800, color: '#1a1a1a' }, children: downloads } },
            { type: 'div', props: { style: { fontSize: s(13), color: '#888' }, children: 'weekly downloads' } },
          ] } }] : []),
          // Footer
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: s(8), borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: '#eee' }, children: [
            { type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: `Published by ${brandName}` } },
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(16), objectFit: 'contain', maxWidth: s(60) } } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'api-status': {
      const statusItems = opts.statusItems ?? [
        { name: 'API Gateway',    status: 'operational' },
        { name: 'Database',       status: 'operational' },
        { name: 'CDN',            status: 'operational' },
        { name: 'Webhooks',       status: 'degraded' },
      ]
      const allOperational = statusItems.every((si: { status: string }) => si.status === 'operational')
      const statusColor = allOperational ? '#22c55e' : '#f59e0b'
      const statusLabel = allOperational ? 'All Systems Operational' : 'Partial Outage'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', padding: s(28), gap: s(16) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(120) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(16), fontWeight: 800, color: '#1a1a1a' }, children: brandName } }]),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6), background: `${statusColor}18`, paddingTop: s(6), paddingBottom: s(6), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(20) }, children: [
              { type: 'div', props: { style: { width: s(8), height: s(8), borderRadius: 999, background: statusColor } } },
              { type: 'div', props: { style: { fontSize: s(12), fontWeight: 700, color: statusColor }, children: statusLabel } },
            ] } },
          ] } },
          // Status items
          { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: s(10), justifyContent: 'center' }, children:
            statusItems.slice(0, 5).map((item: { name: string; status: 'operational' | 'degraded' | 'down' }) => {
              const c = item.status === 'operational' ? '#22c55e' : item.status === 'degraded' ? '#f59e0b' : '#ef4444'
              return { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: s(8), paddingBottom: s(8), borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: '#f0f0f0' }, children: [
                { type: 'div', props: { style: { fontSize: s(14), fontWeight: 500, color: '#333' }, children: item.name } },
                { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(6) }, children: [
                  { type: 'div', props: { style: { width: s(8), height: s(8), borderRadius: 999, background: c } } },
                  { type: 'div', props: { style: { fontSize: s(12), fontWeight: 600, color: c }, children: item.status } },
                ] } },
              ] } }
            })
          } },
        ] } },
      ] } }
    }

    case 'code-snippet': {
      const lang    = opts.codeLanguage ?? 'typescript'
      const code    = opts.codeSnippet ?? headline
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#1e1e2e' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column' }, children: [
          // Title bar
          { type: 'div', props: { style: { background: '#181825', paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(20), paddingRight: s(20), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { width: s(10), height: s(10), borderRadius: 999, background: '#ff5f57' } } },
              { type: 'div', props: { style: { width: s(10), height: s(10), borderRadius: 999, background: '#febc2e' } } },
              { type: 'div', props: { style: { width: s(10), height: s(10), borderRadius: 999, background: '#28c840' } } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
              ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(18), objectFit: 'contain', maxWidth: s(60) } } }]
                : [{ type: 'div', props: { style: { fontSize: s(11), color: '#585b70', fontWeight: 600 }, children: brandName } }]),
              { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, color: primaryColor, background: `${primaryColor}30`, paddingTop: s(2), paddingBottom: s(2), paddingLeft: s(8), paddingRight: s(8), borderRadius: s(3) }, children: lang } },
            ] } },
          ] } },
          // Code area
          { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: s(28), gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(12), color: '#585b70', fontFamily: 'Inter', marginBottom: s(4) }, children: `// ${brandName}` } },
            { type: 'div', props: { style: { fontSize: s(16), fontFamily: 'Inter', color: '#cdd6f4', lineHeight: 1.8, letterSpacing: 0.2 }, children: code.slice(0, 120) } },
          ] } },
        ] } },
      ] } }
    }

    case 'status-page': {
      const statusOpts: Record<string, { emoji: string; color: string; label: string }> = {
        operational: { emoji: '✅', color: '#22c55e', label: 'Operational' },
        degraded:    { emoji: '⚠️', color: '#f59e0b', label: 'Degraded' },
        down:        { emoji: '❌', color: '#ef4444', label: 'Outage' },
        investigating: { emoji: '🔍', color: '#6366f1', label: 'Investigating' },
        resolved:    { emoji: '✅', color: '#22c55e', label: 'Resolved' },
      }
      const statusKey = (stat ?? 'operational').toLowerCase() as keyof typeof statusOpts
      const statusInfo = statusOpts[statusKey] ?? statusOpts.operational
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: s(4), background: statusInfo.color } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(16), padding: sp(40) }, children: [
          { type: 'div', props: { style: { fontSize: s(52) }, children: statusInfo.emoji } },
          { type: 'div', props: { style: { fontSize: sh(30), fontWeight: 900, color: '#1a1a1a', textAlign: h.lta, lineHeight: 1.1 }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(16), color: '#555', textAlign: h.lta, width: Math.round(w * h.lk.textMaxFrac) }, children: subheadline.slice(0, 120) } }] : []),
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8), background: `${statusInfo.color}15`, paddingTop: s(8), paddingBottom: s(8), paddingLeft: s(16), paddingRight: s(16), borderRadius: s(20) }, children: [
            { type: 'div', props: { style: { width: s(8), height: s(8), borderRadius: 999, background: statusInfo.color } } },
            { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: statusInfo.color }, children: statusInfo.label } },
          ] } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(80), opacity: 0.4, marginTop: s(8) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), color: '#aaa', letterSpacing: 2, textTransform: 'uppercase' as const, marginTop: s(8) }, children: brandName } }]),
        ] } },
      ] } }
    }

    case 'release-notes': {
      const version   = opts.version ?? 'v1.0.0'
      const items     = (opts.changelogItems ?? []).slice(0, 4)
      const releaseDate = opts.publishDate ?? opts.releaseDate ?? opts.eventDate ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg }, children: [
        // Left accent bar
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: s(5), height: height, background: primaryColor } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: s(36), paddingRight: s(36), gap: s(16) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(100) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 800, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight }, children: brandName } }]),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: primaryColor, background: `${primaryColor}18`, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(20) }, children: version } },
              ...(releaseDate ? [{ type: 'div', props: { style: { fontSize: s(12), color: muted }, children: releaseDate } }] : []),
            ] } },
          ] } },
          { type: 'div', props: { style: { fontSize: sh(28), fontWeight: 900, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight, letterSpacing: -0.3 }, children: headline.slice(0, h.lk.headlineChars) } },
          // Changelog items
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
            ...items.map((item: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'flex-start', gap: s(10) }, children: [
              { type: 'div', props: { style: { width: s(6), height: s(6), borderRadius: 999, background: primaryColor, flexShrink: 0, marginTop: s(7) } } },
              { type: 'div', props: { style: { fontSize: s(14), color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight, lineHeight: 1.4 }, children: item.slice(0, 80) } },
            ] } })),
            ...(!items.length ? [{ type: 'div', props: { style: { fontSize: s(14), color: muted }, children: 'See changelog for full details.' } }] : []),
          ] } },
        ] } },
      ] } }
    }

    default: return null
  }
}
