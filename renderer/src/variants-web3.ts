import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height,
          primaryColor, brandName, headline, subheadline, bgImageData, logoData, accentBar, contrastText,
          canvasBg, isDark: _isDark } = h

  switch (variant) {

    case 'nft-showcase': {
      const nftName   = opts.nftName ?? headline
      const edition   = opts.nftEdition ?? ''
      const nftPrice  = opts.nftPrice ?? opts.price ?? ''
      const chain     = opts.blockchain ?? 'Ethereum'
      const cardW     = Math.round(Math.min(w * 0.5, height * 0.78))
      const cardH     = Math.round(cardW * 1.25)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg, alignItems: 'center', justifyContent: 'center' }, children: [
        // Background subtle pattern
        { type: 'div', props: { style: { position: 'absolute', top: s(-80), right: s(-80), width: s(320), height: s(320), borderRadius: 999, background: primaryColor, opacity: 0.08 } } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(-60), left: s(-60), width: s(240), height: s(240), borderRadius: 999, background: accentBar, opacity: 0.06 } } },
        // Center layout — explicit width so flex children are properly constrained
        { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(40), paddingLeft: s(40), paddingRight: s(40), width: w }, children: [
          // NFT card
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: cardW, borderRadius: s(12), overflow: 'hidden', borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.12)', background: '#13131a' }, children: [
            // Image area
            { type: 'div', props: { style: { display: 'flex', width: cardW, height: cardH, overflow: 'hidden', background: primaryColor, position: 'relative', flexShrink: 0 }, children: [
              ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: cardW, height: cardH, objectFit: 'cover' } } }] : []),
            ] } },
            // Info area
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6), padding: s(14) }, children: [
              { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: h.sTxt, lineHeight: 1.2 }, children: nftName.slice(0, 28) } },
              ...(edition ? [{ type: 'div', props: { style: { fontSize: s(10), color: h.sMuted }, children: edition } }] : []),
              { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
                ...(nftPrice ? [{ type: 'div', props: { style: { fontSize: s(16), fontWeight: 900, color: primaryColor }, children: nftPrice } }] : []),
                { type: 'div', props: { style: { display: 'flex', fontSize: s(9), fontWeight: 600, color: h.sMuted, background: 'rgba(255,255,255,0.07)', paddingTop: s(3), paddingBottom: s(3), paddingLeft: s(7), paddingRight: s(7), borderRadius: s(3) }, children: chain } },
              ] } },
            ] } },
          ] } },
          // Info text
          { type: 'div', props: { style: { display: 'flex', flex: 1, flexDirection: 'column', gap: s(14) }, children: [
            ...(logoData
              ? [{ type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(100) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, letterSpacing: 2, color: h.sMuted, textTransform: 'uppercase' as const }, children: brandName } }]),
            { type: 'div', props: { style: { fontSize: sh(22), fontWeight: 900, color: h.sTxt, lineHeight: 1.1 }, children: nftName.slice(0, h.lk.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(14), color: h.sMuted, lineHeight: 1.4 }, children: subheadline.slice(0, 70) } }] : []),
            // Stats
            { type: 'div', props: { style: { display: 'flex', gap: s(20) }, children: [
              ...(opts.floorPrice ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
                { type: 'div', props: { style: { fontSize: s(10), color: h.sMuted, letterSpacing: 1 }, children: 'FLOOR' } },
                { type: 'div', props: { style: { fontSize: s(18), fontWeight: 900, color: h.sTxt }, children: opts.floorPrice } },
              ] } }] : []),
              ...(opts.holderCount ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
                { type: 'div', props: { style: { fontSize: s(10), color: h.sMuted, letterSpacing: 1 }, children: 'HOLDERS' } },
                { type: 'div', props: { style: { fontSize: s(18), fontWeight: 900, color: h.sTxt }, children: opts.holderCount } },
              ] } }] : []),
            ] } },
          ] } },
        ] } },
      ] } }
    }

    case 'mint-announcement': {
      const nftName   = opts.nftName ?? headline
      const supply    = opts.totalSupply ?? ''
      const mintDate  = opts.mintDate ?? opts.releaseDate ?? opts.eventDate ?? ''
      const mintPrice = opts.nftPrice ?? opts.price ?? ''
      const ctaLabel  = opts.ctaText ?? 'Mint Now'
      const ctaBg     = opts.ctaColor ?? primaryColor
      const ctaTxt    = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.25 } } }] : []),
        ...(h.lk.brandTop ? [{ type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), right: s(24), display: 'flex', justifyContent: 'center' }, children: [
          ...(logoData
            ? [{ type: 'img', props: { src: logoData, style: { height: s(32), objectFit: 'contain', maxWidth: s(110) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, letterSpacing: 3, color: h.sMuted, textTransform: 'uppercase' as const }, children: brandName } }]),
        ] } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: sp(48), gap: s(16) }, children: [
          // Logo (inline when brandTop false)
          ...(!h.lk.brandTop ? [
            ...(logoData
              ? [{ type: 'img', props: { src: logoData, style: { height: s(32), objectFit: 'contain', maxWidth: s(110) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(12), fontWeight: 800, letterSpacing: 3, color: h.sMuted, textTransform: 'uppercase' as const }, children: brandName } }]),
          ] : []),
          // Minting badge
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: primaryColor, color: contrastText(primaryColor), fontSize: s(11), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(16), paddingRight: s(16), borderRadius: s(3) }, children: mintDate ? 'MINT OPENS' : 'MINTING NOW' } },
          // Name
          { type: 'div', props: { style: { fontSize: sh(52), fontWeight: 900, color: h.sTxt, lineHeight: 1.0, textAlign: h.lta, letterSpacing: -1, width: Math.round(w * h.lk.textMaxFrac) }, children: nftName.slice(0, h.lk.headlineChars) } },
          // Meta row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(32) }, children: [
            ...(supply ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), color: h.sMuted, letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'SUPPLY' } },
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 900, color: h.sTxt }, children: supply } },
            ] } }] : []),
            ...(mintDate ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), color: h.sMuted, letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'DATE' } },
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 900, color: h.sTxt }, children: mintDate } },
            ] } }] : []),
            ...(mintPrice ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), color: h.sMuted, letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'PRICE' } },
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 900, color: primaryColor }, children: mintPrice } },
            ] } }] : []),
          ] } },
          // CTA
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(13), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(40), paddingRight: s(40), borderRadius: s(4) }, children: ctaLabel } },
        ] } },
      ] } }
    }

    case 'dao-proposal': {
      const proposalId = opts.proposalId ?? '#001'
      const daoName    = opts.daoName ?? brandName
      const voteDeadline = opts.eventDate ?? ''
      const yesVotes   = opts.stat ?? ''
      const ctaLabel   = opts.ctaText ?? 'Vote Now'
      const ctaBg      = opts.ctaColor ?? primaryColor
      const ctaTxt     = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: sp(48), gap: s(18) }, children: [
          // Header row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
              ...(logoData
                ? [{ type: 'img', props: { src: logoData, style: { height: s(26), objectFit: 'contain', maxWidth: s(90) } } }]
                : [{ type: 'div', props: { style: { fontSize: s(14), fontWeight: 800, color: h.sTxt, letterSpacing: 1 }, children: daoName } }]),
              { type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, color: primaryColor, textTransform: 'uppercase' as const }, children: 'DAO PROPOSAL' } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', fontSize: s(18), fontWeight: 900, color: 'rgba(255,255,255,0.30)' }, children: proposalId } },
          ] } },
          // Divider
          { type: 'div', props: { style: { display: 'flex', height: 1, background: 'rgba(255,255,255,0.10)' } } },
          // Title
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: Math.round(w * h.lk.textMaxFrac), gap: s(18) }, children: [
            { type: 'div', props: { style: { fontSize: sh(30), fontWeight: 800, color: h.sTxt, lineHeight: 1.15 }, children: headline.slice(0, h.lk.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(14), color: h.sMuted, lineHeight: 1.5 }, children: subheadline.slice(0, 100) } }] : []),
          ] } },
          // Stats + CTA row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', gap: s(28) }, children: [
              ...(yesVotes ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
                { type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.35)', letterSpacing: 2 }, children: 'YES VOTES' } },
                { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: '#22c55e' }, children: yesVotes } },
              ] } }] : []),
              ...(voteDeadline ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
                { type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.35)', letterSpacing: 2 }, children: 'DEADLINE' } },
                { type: 'div', props: { style: { fontSize: s(16), fontWeight: 700, color: h.sBody }, children: voteDeadline } },
              ] } }] : []),
            ] } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(12), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(4) }, children: ctaLabel } },
          ] } },
        ] } },
      ] } }
    }

    case 'token-launch': {
      const symbol   = opts.tokenSymbol ?? opts.ticker ?? '$TOKEN'
      const tPrice   = opts.tokenPrice ?? opts.price ?? ''
      const change   = opts.tokenChange ?? opts.priceChange ?? ''
      const isPos    = change.startsWith('+')
      const supply   = opts.totalSupply ?? opts.stat ?? ''
      const chain    = opts.blockchain ?? ''
      const ctaLabel = opts.ctaText ?? 'Trade Now'
      const ctaBg    = opts.ctaColor ?? primaryColor
      const ctaTxt   = contrastText(ctaBg)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.15 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: s(-100), right: s(-100), width: s(400), height: s(400), borderRadius: 999, background: primaryColor, opacity: 0.07 } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: sp(52), gap: s(24) }, children: [
          // Logo + brand
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12) }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(90) } } }] : []),
            { type: 'div', props: { style: { fontSize: s(12), fontWeight: 700, color: h.sMuted, letterSpacing: 2, textTransform: 'uppercase' as const }, children: brandName } },
          ] } },
          // Symbol + token name — wrapped in flex column so yoga measures heights correctly
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: Math.round(w * h.lk.textMaxFrac), gap: s(6) }, children: [
            { type: 'div', props: { style: { fontSize: s(80), fontWeight: 900, color: h.sTxt, lineHeight: 1.1, letterSpacing: -2, width: Math.round(w * h.lk.textMaxFrac) }, children: symbol } },
            { type: 'div', props: { style: { fontSize: s(18), fontWeight: 600, color: h.sMuted, width: Math.round(w * h.lk.textMaxFrac) }, children: headline.replace(new RegExp('^' + symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s:—\\-]*', 'i'), '').trim().slice(0, 40) || headline.slice(0, 40) } },
          ] } },
          // Price + change row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: s(16) }, children: [
            ...(tPrice ? [{ type: 'div', props: { style: { fontSize: s(36), fontWeight: 900, color: h.sTxt }, children: tPrice } }] : []),
            ...(change ? [{ type: 'div', props: { style: { fontSize: s(20), fontWeight: 700, color: isPos ? '#22c55e' : '#ef4444' }, children: change } }] : []),
          ] } },
          // Meta row
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(24) }, children: [
            ...(supply ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.35)', letterSpacing: 2 }, children: 'SUPPLY' } },
              { type: 'div', props: { style: { fontSize: s(15), fontWeight: 700, color: h.sBody }, children: supply } },
            ] } }] : []),
            ...(chain ? [{ type: 'div', props: { style: { display: 'flex', fontSize: s(10), fontWeight: 600, color: h.sMuted, background: 'rgba(255,255,255,0.08)', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: chain } }] : []),
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: ctaBg, color: ctaTxt, fontSize: s(11), fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(22), paddingRight: s(22), borderRadius: s(4) }, children: ctaLabel } },
          ] } },
        ] } },
      ] } }
    }

    case 'web3-stats': {
      const nftName    = opts.nftName ?? headline
      const floor      = opts.floorPrice ?? ''
      const holders    = opts.holderCount ?? ''
      const supply     = opts.totalSupply ?? ''
      const volume     = opts.stat ?? ''
      const change7d   = opts.tokenChange ?? opts.priceChange ?? ''
      const isPos      = change7d.startsWith('+')
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: canvasBg }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: sp(44), gap: s(22) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
              ...(logoData
                ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(80) } } }]
                : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 2, color: h.sMuted, textTransform: 'uppercase' as const }, children: brandName } }]),
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 800, color: h.sTxt, lineHeight: 1.1 }, children: nftName.slice(0, 35) } },
            ] } },
            ...(change7d ? [{ type: 'div', props: { style: { display: 'flex', fontSize: s(18), fontWeight: 800, color: isPos ? '#22c55e' : '#ef4444' }, children: `${change7d} 7d` } }] : []),
          ] } },
          // Divider
          { type: 'div', props: { style: { display: 'flex', height: 1, background: 'rgba(255,255,255,0.08)' } } },
          // Stats grid
          { type: 'div', props: { style: { display: 'flex', gap: s(16), flexWrap: 'wrap' as const }, children: [
            ...(floor ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: s(8), paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(16), paddingRight: s(16) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Floor' } },
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: primaryColor } , children: floor } },
            ] } }] : []),
            ...(volume ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: s(8), paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(16), paddingRight: s(16) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Volume' } },
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: h.sTxt }, children: volume } },
            ] } }] : []),
            ...(holders ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: s(8), paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(16), paddingRight: s(16) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Holders' } },
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: h.sTxt }, children: holders } },
            ] } }] : []),
            ...(supply ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: s(8), paddingTop: s(14), paddingBottom: s(14), paddingLeft: s(16), paddingRight: s(16) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Supply' } },
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: h.sTxt }, children: supply } },
            ] } }] : []),
          ] } },
        ] } },
      ] } }
    }

    default:
      return null
  }
}
