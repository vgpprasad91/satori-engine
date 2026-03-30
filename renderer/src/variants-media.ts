import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height, txt: _txt, muted, accent: _accent, lightTxt, lightMuted: _lightMuted,
          primaryColor, brandName, headline, subheadline: _sub, stat, bgImageData, logoData, tk, accentBar, contrastText } = h

  switch (variant) {

    case 'spotify-now-playing': {
      const track    = opts.spotifyTrack    ?? headline
      const artist   = opts.spotifyArtist   ?? opts.subheadline ?? brandName
      const album    = opts.spotifyAlbum    ?? ''
      const progress = opts.spotifyProgress ?? 35
      const barW     = Math.round(w * 0.55)
      const progFill = Math.round((progress / 100) * barW)
      const thumbSz  = height
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#121212' }, children: [
        // album art left
        { type: 'div', props: { style: { width: thumbSz, height: thumbSz, flexShrink: 0, display: 'flex', position: 'relative', overflow: 'hidden', background: primaryColor }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: thumbSz, height: thumbSz, objectFit: 'cover' } } }] : []),
          ...(!bgImageData ? [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: [
            { type: 'div', props: { style: { fontSize: s(48) }, children: '🎵' } },
          ] } }] : []),
        ] } },
        // right panel
        { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(12), paddingLeft: s(32), paddingRight: s(32) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(14) }, children: '▶' } },
            { type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: '#1DB954' }, children: 'Now Playing' } },
          ] } },
          { type: 'div', props: { style: { fontSize: sh(28), fontWeight: 800, color: h.sTxt, lineHeight: 1.1, letterSpacing: -0.5 }, children: track.slice(0, 30) } },
          { type: 'div', props: { style: { fontSize: sb(14), color: h.sMuted }, children: artist } },
          ...(album ? [{ type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.35)' }, children: album } }] : []),
          // progress bar
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6), marginTop: s(8) }, children: [
            { type: 'div', props: { style: { width: barW, height: s(4), background: 'rgba(255,255,255,0.15)', borderRadius: s(2), position: 'relative', overflow: 'hidden', display: 'flex' }, children: [
              { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: progFill, height: s(4), background: '#1DB954', borderRadius: s(2) } } },
            ] } },
          ] } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(18), objectFit: 'contain', maxWidth: s(70), opacity: 0.5, marginTop: s(4) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(9), color: 'rgba(255,255,255,0.25)', letterSpacing: 2, marginTop: s(4) }, children: 'SPOTIFY' } }]),
        ] } },
      ] } }
    }

    case 'album-art': {
      const artist = opts.spotifyArtist ?? opts.subheadline ?? brandName
      const genre  = opts.genre ?? ''
      const year   = opts.releaseDate ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover' } } }]
          : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } }]),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.45), background: 'rgba(0,0,0,0.75)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: sp(32) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(80) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const }, children: brandName } }]),
            ...(genre ? [{ type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: primaryColor, background: 'rgba(255,255,255,0.15)', paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(10), paddingRight: s(10), borderRadius: s(3) }, children: genre } }] : []),
          ] } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            { type: 'div', props: { style: { fontSize: s(11), color: h.sMuted, letterSpacing: 2, textTransform: 'uppercase' as const }, children: artist } },
            { type: 'div', props: { style: { fontSize: sh(48), fontWeight: 900, color: h.sTxt, lineHeight: 1, letterSpacing: -1 }, children: headline.slice(0, h.lk.headlineChars) } },
            ...(year ? [{ type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.4)' }, children: year } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'movie-poster': {
      const director = opts.author ?? ''
      const ratingStr = opts.rating ? `${opts.rating}/10` : ''
      const release  = opts.releaseDate ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover' } } }]
          : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: '#0a0a0a' } } }]),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.5), background: 'rgba(0,0,0,0.85)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(20), right: s(20), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(9), fontWeight: 800, letterSpacing: 3, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' as const }, children: brandName } }]),
          ...(ratingStr ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(12) }, children: '⭐' } },
            { type: 'div', props: { style: { fontSize: s(13), fontWeight: 800, color: '#facc15' }, children: ratingStr } },
          ] } }] : []),
        ] } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(24), width: w - 2 * s(24), display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
          { type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.5)', letterSpacing: 4, textTransform: 'uppercase' as const }, children: opts.genre ?? 'Feature Film' } },
          { type: 'div', props: { style: { fontSize: sh(56), fontWeight: 900, color: h.sTxt, lineHeight: 1.0, letterSpacing: -2, textTransform: 'uppercase' as const, width: Math.round(w * h.lk.textMaxFrac) }, children: headline.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16) }, children: [
            ...(director ? [{ type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.5)' }, children: `Dir. ${director}` } }] : []),
            ...(release ? [{ type: 'div', props: { style: { fontSize: s(11), color: primaryColor, fontWeight: 700 }, children: release } }] : []),
          ] } },
        ] } },
      ] } }
    }

    case 'music-release': {
      const artist = opts.spotifyArtist ?? brandName
      const releaseType = opts.genre ?? 'Single'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0a0a0a' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.4 } } }] : []),
        ...(h.lk.brandTop && logoData ? [{ type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), display: 'flex' }, children: [
          { type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80), opacity: 0.5 } } },
        ] } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(14) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { fontSize: s(9), fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase' as const, color: primaryColor, background: 'rgba(255,255,255,0.1)', paddingTop: s(5), paddingBottom: s(5), paddingLeft: s(12), paddingRight: s(12), borderRadius: s(3) }, children: `New ${releaseType}` } },
            ...(opts.releaseDate ? [{ type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.4)' }, children: opts.releaseDate } }] : []),
          ] } },
          { type: 'div', props: { style: { fontSize: sh(62), fontWeight: 900, color: h.sTxt, textAlign: h.lta, lineHeight: 1.0, letterSpacing: -2, width: Math.round(w * h.lk.textMaxFrac) }, children: headline.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { fontSize: s(16), color: 'rgba(255,255,255,0.6)', letterSpacing: 3, textTransform: 'uppercase' as const }, children: artist } },
          ...(!h.lk.brandTop && logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80), opacity: 0.5, marginTop: s(12) } } }] : []),
        ] } },
      ] } }
    }

    case 'twitch-banner': {
      const viewers = opts.streamViewers ?? ''
      const gameTitle = opts.gameTitle ?? opts.subheadline ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0e0e10' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.3 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: sp(32) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(10) }, children: [
              { type: 'div', props: { style: { background: '#ef4444', color: h.paletteContrastText('#ef4444'), fontSize: s(9), fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(4), paddingBottom: s(4), paddingLeft: s(8), paddingRight: s(8), borderRadius: s(3) }, children: '● LIVE' } },
              ...(viewers ? [{ type: 'div', props: { style: { fontSize: s(12), color: 'rgba(255,255,255,0.7)', fontWeight: 600 }, children: `${viewers} watching` } }] : []),
            ] } },
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(100) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 800, color: '#9146FF', letterSpacing: 2 }, children: brandName } }]),
          ] } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8) }, children: [
            ...(gameTitle ? [{ type: 'div', props: { style: { fontSize: s(10), color: '#9146FF', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const }, children: gameTitle } }] : []),
            { type: 'div', props: { style: { fontSize: sh(40), fontWeight: 900, color: h.sTxt, lineHeight: 1.05, letterSpacing: -0.5 }, children: headline.slice(0, h.lk.headlineChars) } },
          ] } },
        ] } },
      ] } }
    }

    case 'youtube-stats': {
      const subscribers = opts.studentCount ?? stat ?? ''
      const videoCount  = opts.lessonCount ? `${opts.lessonCount}` : ''
      const views       = opts.tweetLikes ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0f0f0f' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.2 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(16) }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(40), objectFit: 'contain', maxWidth: s(160) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(32), fontWeight: 900, color: h.sTxt, letterSpacing: -1 }, children: brandName } }]),
          { type: 'div', props: { style: { display: 'flex', gap: s(32) }, children: [
            ...(subscribers ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4) }, children: [
              { type: 'div', props: { style: { fontSize: s(36), fontWeight: 900, color: '#ff0000' }, children: subscribers } },
              { type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.5)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Subscribers' } },
            ] } }] : []),
            ...(videoCount ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4) }, children: [
              { type: 'div', props: { style: { fontSize: s(36), fontWeight: 900, color: h.sTxt }, children: videoCount } },
              { type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.5)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Videos' } },
            ] } }] : []),
            ...(views ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4) }, children: [
              { type: 'div', props: { style: { fontSize: s(36), fontWeight: 900, color: h.sTxt }, children: views } },
              { type: 'div', props: { style: { fontSize: s(10), color: 'rgba(255,255,255,0.5)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Views' } },
            ] } }] : []),
          ] } },
          { type: 'div', props: { style: { fontSize: s(14), color: 'rgba(255,255,255,0.5)', textAlign: 'center' }, children: headline.slice(0, 60) } },
        ] } },
      ] } }
    }

    case 'soundcloud-track': {
      const artist  = opts.spotifyArtist ?? opts.subheadline ?? brandName
      const plays   = opts.tweetLikes ?? stat ?? ''
      const duration = opts.duration ?? ''
      const barW    = Math.round(w * 0.6)
      const waveSegs = 40
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#111111' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.15 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'row', gap: s(24), padding: s(32), alignItems: 'center' }, children: [
          // Album art
          { type: 'div', props: { style: { width: s(120), height: s(120), flexShrink: 0, borderRadius: s(4), overflow: 'hidden', background: primaryColor, position: 'relative', display: 'flex' }, children: [
            ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: s(120), height: s(120), objectFit: 'cover' } } }] : []),
          ] } },
          // Right content
          { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: s(10), justifyContent: 'center' }, children: [
            { type: 'div', props: { style: { fontSize: s(11), color: h.sMuted, letterSpacing: 1 }, children: artist } },
            { type: 'div', props: { style: { fontSize: sb(26), fontWeight: 800, color: h.sTxt, lineHeight: 1.1 }, children: headline.slice(0, h.lk.headlineChars) } },
            // Waveform simulation
            { type: 'div', props: { style: { display: 'flex', alignItems: 'flex-end', gap: s(2), width: barW, height: s(32) }, children:
              Array.from({ length: waveSegs }, (_, i) => {
                const barH = s(4 + Math.abs(Math.sin(i * 0.8) * 24))
                const played = i < waveSegs * 0.4
                return { type: 'div', props: { style: { width: s(4), height: barH, background: played ? '#ff5500' : 'rgba(255,255,255,0.2)', borderRadius: s(1), flexShrink: 0 } } }
              })
            } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16) }, children: [
              ...(plays ? [{ type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.4)' }, children: `♪ ${plays} plays` } }] : []),
              ...(duration ? [{ type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.4)' }, children: duration } }] : []),
            ] } },
          ] } },
        ] } },
      ] } }
    }

    case 'live-stream-alert': {
      const viewers = opts.streamViewers ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.25 } } }] : []),
        ...(h.lk.brandTop ? [{ type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), right: s(24), display: 'flex', justifyContent: 'center' }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(40), objectFit: 'contain', maxWidth: s(160) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(36), fontWeight: 900, color: h.sTxt, letterSpacing: -1 }, children: brandName } }]),
        ] } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(12) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
            { type: 'div', props: { style: { width: s(10), height: s(10), borderRadius: s(5), background: '#ef4444' } } },
            { type: 'div', props: { style: { fontSize: s(11), fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase' as const, color: h.sTxt }, children: 'Live Now' } },
          ] } },
          ...(!h.lk.brandTop ? [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(40), objectFit: 'contain', maxWidth: s(160) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(36), fontWeight: 900, color: h.sTxt, letterSpacing: -1 }, children: brandName } }]),
          ] : []),
          { type: 'div', props: { style: { fontSize: sb(20), color: 'rgba(255,255,255,0.8)', textAlign: h.lta }, children: headline.slice(0, h.lk.headlineChars) } },
          ...(viewers ? [{ type: 'div', props: { style: { fontSize: s(13), color: 'rgba(255,255,255,0.6)' }, children: `${viewers} watching` } }] : []),
        ] } },
      ] } }
    }

    case 'podcast-stats': {
      const eps     = opts.lessonCount ? `${opts.lessonCount}` : ''
      const listens = opts.studentCount ?? stat ?? ''
      const ratingVal = opts.rating ?? 5
      const panelW  = Math.round(w * 0.38)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg }, children: [
        { type: 'div', props: { style: { width: panelW, height: height, flexShrink: 0, position: 'relative', overflow: 'hidden', background: primaryColor, display: 'flex' }, children: [
          ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: panelW, height: height, objectFit: 'cover' } } }] : []),
          { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: s(20) }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(100) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 800, letterSpacing: 2, color: contrastText(primaryColor) }, children: brandName } }]),
          ] } },
        ] } },
        { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(18), paddingLeft: s(36), paddingRight: s(36) }, children: [
          { type: 'div', props: { style: { fontSize: sh(30), fontWeight: 900, color: h.ptxtLight, letterSpacing: -0.5, lineHeight: 1.1 }, children: headline.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { display: 'flex', gap: s(24) }, children: [
            ...(eps ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(28), fontWeight: 900, color: primaryColor }, children: eps } },
              { type: 'div', props: { style: { fontSize: s(9), color: muted, letterSpacing: 1 }, children: 'EPISODES' } },
            ] } }] : []),
            ...(listens ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(28), fontWeight: 900, color: primaryColor }, children: listens } },
              { type: 'div', props: { style: { fontSize: s(9), color: muted, letterSpacing: 1 }, children: 'LISTENS' } },
            ] } }] : []),
          ] } },
          { type: 'div', props: { style: { display: 'flex', gap: s(3) }, children:
            Array.from({ length: 5 }, (_, i) => ({ type: 'div', props: { style: { fontSize: s(16), color: i < ratingVal ? '#facc15' : 'rgba(0,0,0,0.15)' }, children: '★' } }))
          } },
        ] } },
      ] } }
    }

    default: return null
  }
}
