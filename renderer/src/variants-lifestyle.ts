import type { VariantHelpers } from './variant-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVariants(variant: string, opts: any, h: VariantHelpers): any | null {
  const { s, sh, sb, sp, w, h: height, txt, muted, accent: _accent, lightTxt, lightMuted,
          primaryColor, brandName, headline, subheadline, stat, bgImageData, logoData, tk, accentBar, contrastText } = h

  switch (variant) {

    case 'referral-card': {
      const bonus   = opts.referralBonus ?? opts.price ?? '$25 credit'
      const code    = opts.couponCode ?? brandName.replace(/\s+/g, '').toUpperCase().slice(0, 8)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: s(-80), right: s(-80), width: s(300), height: s(300), borderRadius: 999, background: 'rgba(255,255,255,0.07)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: s(16), padding: sp(40) }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(30), objectFit: 'contain', maxWidth: s(120) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(13), fontWeight: 800, letterSpacing: 2, color: contrastText(primaryColor), opacity: 0.44, textTransform: 'uppercase' as const }, children: brandName } }]),
          { type: 'div', props: { style: { fontSize: s(14), fontWeight: 600, color: contrastText(primaryColor), opacity: 0.50, textAlign: 'center' }, children: 'Share & Earn' } },
          { type: 'div', props: { style: { display: 'flex', fontSize: s(60), fontWeight: 900, color: h.sTxt, lineHeight: 1, letterSpacing: -2, textAlign: 'center' }, children: bonus } },
          { type: 'div', props: { style: { fontSize: s(15), color: contrastText(primaryColor), opacity: 0.44, textAlign: 'center' }, children: headline.slice(0, 50) } },
          { type: 'div', props: { style: { background: 'rgba(255,255,255,0.15)', borderRadius: s(6), paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(24), paddingRight: s(24), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(4) }, children: [
            { type: 'div', props: { style: { fontSize: s(10), color: contrastText(primaryColor), opacity: 0.31, letterSpacing: 2, textTransform: 'uppercase' as const }, children: 'Your code' } },
            { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: h.sTxt, letterSpacing: 4 }, children: code } },
          ] } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', color: primaryColor, fontSize: s(12), fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(12), paddingBottom: s(12), paddingLeft: s(32), paddingRight: s(32), borderRadius: s(4) }, children: opts.ctaText ?? 'Invite Friends' } },
        ] } },
      ] } }
    }

    case 'nutrition-facts': {
      const calories2 = opts.calories2 ?? opts.calories ?? '240'
      const servings  = opts.servings ?? '2'
      const nutrients = opts.exercises ?? [
        { name: 'Total Fat', sets: '12g', reps: '15%' },
        { name: 'Sodium', sets: '320mg', reps: '14%' },
        { name: 'Total Carbs', sets: '37g', reps: '13%' },
        { name: 'Protein', sets: '5g', reps: '' },
      ]
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff', borderWidth: s(2), borderStyle: 'solid', borderColor: '#000000' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', padding: s(16), gap: s(8) }, children: [
          // Header
          { type: 'div', props: { style: { fontSize: s(32), fontWeight: 900, color: '#000000', lineHeight: 1, borderBottomWidth: s(8), borderBottomStyle: 'solid', borderBottomColor: '#000000', paddingBottom: s(6) }, children: 'Nutrition Facts' } },
          { type: 'div', props: { style: { fontSize: s(12), color: '#000000' }, children: `${servings} servings per container` } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderTopWidth: s(4), borderTopStyle: 'solid', borderTopColor: '#000000', paddingTop: s(6) }, children: [
            { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: '#000000' }, children: 'Calories' } },
            { type: 'div', props: { style: { fontSize: s(40), fontWeight: 900, color: '#000000', lineHeight: 1 }, children: calories2 } },
          ] } },
          // Divider
          { type: 'div', props: { style: { borderTopWidth: s(4), borderTopStyle: 'solid', borderTopColor: '#000000' } } },
          // Nutrients
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4), flex: 1 }, children:
            nutrients.slice(0, 5).map((n: { name: string; sets?: string; reps?: string }) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: s(1), borderBottomStyle: 'solid', borderBottomColor: '#ccc', paddingTop: s(3), paddingBottom: s(3) }, children: [
              { type: 'div', props: { style: { fontSize: s(13), color: '#000000' }, children: `${n.name} ${n.sets ?? ''}` } },
              { type: 'div', props: { style: { fontSize: s(13), fontWeight: 700, color: '#000000' }, children: n.reps ?? '' } },
            ] } }))
          } },
          // Footer brand
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: s(6), borderTopWidth: s(4), borderTopStyle: 'solid', borderTopColor: '#000000' }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(16), objectFit: 'contain', maxWidth: s(70) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(10), color: '#000', letterSpacing: 2 }, children: brandName } }]),
          ] } },
        ] } },
      ] } }
    }

    case 'cocktail-recipe': {
      const ingredients = (opts.changelogItems ?? []).slice(0, 4)
      const abv        = opts.alcoholContent ?? ''
      const servings2  = opts.servings ?? '1'
      const prepTime   = opts.prepTime ?? '5 min'
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0a0a0a' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.45 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.62), background: 'rgba(0,0,0,0.82)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), right: s(24), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' as const }, children: brandName } }]),
          ...(abv ? [{ type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.5)', fontWeight: 600 }, children: `ABV ${abv}` } }] : []),
        ] } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(24), right: s(24), display: 'flex', flexDirection: 'column', gap: s(12) }, children: [
          { type: 'div', props: { style: { fontSize: sh(38), fontWeight: 900, color: h.sTxt, lineHeight: 1, letterSpacing: -0.5 }, children: headline.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { display: 'flex', gap: s(16) }, children: [
            { type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.5)' }, children: `🕐 ${prepTime}` } },
            { type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.5)' }, children: `🥃 Makes ${servings2}` } },
          ] } },
          ...(ingredients.length ? [{ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children:
            ingredients.map((ing: string) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { width: s(4), height: s(4), borderRadius: 999, background: primaryColor, flexShrink: 0 } } },
              { type: 'div', props: { style: { fontSize: s(13), color: 'rgba(255,255,255,0.7)' }, children: ing.slice(0, 40) } },
            ] } }))
          } }] : []),
        ] } },
      ] } }
    }

    case 'workout-plan': {
      const exercises = opts.exercises ?? [
        { name: 'Push-ups', sets: '3', reps: '15' },
        { name: 'Squats', sets: '4', reps: '12' },
        { name: 'Plank', sets: '3', reps: '60s' },
        { name: 'Lunges', sets: '3', reps: '10ea' },
      ]
      const workoutType = opts.workoutType ?? opts.classType ?? subheadline ?? 'Workout'
      const difficulty  = opts.difficulty ?? 'Medium'
      const diffColors: Record<string, string> = { Easy: '#22c55e', Medium: '#f59e0b', Hard: '#ef4444' }
      const diffColor  = diffColors[difficulty] ?? primaryColor
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: tk.panelBg }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', gap: s(14), padding: sp(28) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(4) }, children: [
              { type: 'div', props: { style: { fontSize: s(9), fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: muted }, children: workoutType } },
              { type: 'div', props: { style: { fontSize: s(24), fontWeight: 900, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight, letterSpacing: -0.3 }, children: headline.slice(0, 30) } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: s(4) }, children: [
              { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, color: diffColor }, children: difficulty } },
              ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(18), objectFit: 'contain', maxWidth: s(60) } } }]
                : [{ type: 'div', props: { style: { fontSize: s(9), color: muted, letterSpacing: 1 }, children: brandName } }]),
            ] } },
          ] } },
          // Column headers
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', paddingLeft: s(8), paddingRight: s(8), paddingBottom: s(6), borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'rgba(0,0,0,0.1)' }, children: [
            { type: 'div', props: { style: { flex: 1, fontSize: s(10), fontWeight: 700, color: muted, letterSpacing: 1, textTransform: 'uppercase' as const }, children: 'Exercise' } },
            { type: 'div', props: { style: { width: s(40), fontSize: s(10), fontWeight: 700, color: muted, letterSpacing: 1, textTransform: 'uppercase' as const, textAlign: 'center' }, children: 'Sets' } },
            { type: 'div', props: { style: { width: s(50), fontSize: s(10), fontWeight: 700, color: muted, letterSpacing: 1, textTransform: 'uppercase' as const, textAlign: 'center' }, children: 'Reps' } },
          ] } },
          // Exercise rows
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8), flex: 1, justifyContent: 'center' }, children:
            exercises.slice(0, 5).map((ex: { name: string; sets?: string; reps?: string }, i: number) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', background: i % 2 === 0 ? 'rgba(0,0,0,0.03)' : 'transparent', borderRadius: s(4), paddingTop: s(8), paddingBottom: s(8), paddingLeft: s(8), paddingRight: s(8) }, children: [
              { type: 'div', props: { style: { flex: 1, fontSize: s(14), fontWeight: 600, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight }, children: ex.name.slice(0, 25) } },
              { type: 'div', props: { style: { width: s(40), fontSize: s(14), fontWeight: 700, color: primaryColor, textAlign: 'center' }, children: ex.sets ?? '3' } },
              { type: 'div', props: { style: { width: s(50), fontSize: s(14), fontWeight: 700, color: lightTxt === '#ffffff' ? lightTxt : h.ptxtLight, textAlign: 'center' }, children: ex.reps ?? '10' } },
            ] } }))
          } },
        ] } },
      ] } }
    }

    case 'travel-destination': {
      const destination = opts.destination ?? headline
      const duration2   = opts.flightDuration ?? ''
      const hotelStars  = opts.hotelStars ?? 5
      const price2      = opts.price ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover' } } }]
          : [{ type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: primaryColor } } }]),
        { type: 'div', props: { style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.round(height * 0.52), background: 'rgba(0,0,0,0.78)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: s(20), left: s(24), right: s(24), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(90) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(10), fontWeight: 800, color: 'rgba(255,255,255,0.7)', letterSpacing: 2, textTransform: 'uppercase' as const }, children: brandName } }]),
          { type: 'div', props: { style: { display: 'flex', gap: s(2) }, children:
            Array.from({ length: hotelStars }, () => ({ type: 'div', props: { style: { fontSize: s(12), color: '#facc15' }, children: '★' } }))
          } },
        ] } },
        { type: 'div', props: { style: { position: 'absolute', bottom: s(24), left: s(24), right: s(24), display: 'flex', flexDirection: 'column', gap: s(10) }, children: [
          { type: 'div', props: { style: { fontSize: sh(44), fontWeight: 900, color: h.sTxt, lineHeight: 1.05, letterSpacing: -0.5 }, children: destination.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(16) }, children: [
            ...(duration2 ? [{ type: 'div', props: { style: { fontSize: s(13), color: h.sMuted }, children: `✈ ${duration2}` } }] : []),
            ...(price2 ? [{ type: 'div', props: { style: { fontSize: s(20), fontWeight: 900, color: primaryColor }, children: `from ${price2}` } }] : []),
          ] } },
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: primaryColor, color: contrastText(primaryColor), fontSize: s(12), fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(28), paddingRight: s(28), borderRadius: s(4), alignSelf: 'flex-start' }, children: opts.ctaText ?? 'Book Now' } },
        ] } },
      ] } }
    }

    case 'birthday-card': {
      const toName    = opts.recipientName ?? headline
      const fromName2 = opts.giftFrom ?? `From: ${brandName}`
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        // Confetti dots simulation
        ...[...Array(12)].map((_, i) => ({ type: 'div', props: { style: { position: 'absolute', width: s(8), height: s(8), borderRadius: 999, background: i % 3 === 0 ? '#facc15' : i % 3 === 1 ? '#ffffff' : accentBar, top: `${(i * 7) % 90}%`, left: `${(i * 13) % 95}%`, opacity: 0.5 } } })),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(14) }, children: [
          { type: 'div', props: { style: { fontSize: s(52) }, children: '🎂' } },
          { type: 'div', props: { style: { fontSize: s(16), fontWeight: 700, color: contrastText(primaryColor), opacity: 0.50, letterSpacing: 3, textTransform: 'uppercase' as const }, children: 'Happy Birthday' } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(30), objectFit: 'contain', maxWidth: s(120) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(40), fontWeight: 900, color: h.sTxt, letterSpacing: -0.5, textAlign: 'center' }, children: toName.slice(0, 20) } }]),
          { type: 'div', props: { style: { fontSize: s(14), color: contrastText(primaryColor), opacity: 0.44, textAlign: 'center' }, children: subheadline?.slice(0, 80) ?? 'Wishing you an amazing day!' } },
          { type: 'div', props: { style: { fontSize: s(13), color: contrastText(primaryColor), opacity: 0.31 }, children: fromName2 } },
          { type: 'div', props: { style: { fontSize: s(28) }, children: '🎉🎁🎈' } },
        ] } },
      ] } }
    }

    case 'wedding-card': {
      const coupleNames = headline
      const weddingDate = opts.eventDate ?? ''
      const venue2      = opts.venue ?? opts.eventLocation ?? ''
      const rsvpDate    = opts.rsvpDeadline ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: tk.headlineFamily, background: '#fdfcf8' }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.1 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: s(6), height: height, background: primaryColor, opacity: 0.3 } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(14), padding: sp(40) }, children: [
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(24), objectFit: 'contain', maxWidth: s(90), opacity: 0.5 } } }] : []),
          { type: 'div', props: { style: { fontSize: s(11), fontWeight: 400, letterSpacing: 4, textTransform: 'uppercase' as const, color: '#888' }, children: 'Together we celebrate' } },
          { type: 'div', props: { style: { fontSize: sh(46), fontWeight: tk.headlineWeight, fontStyle: tk.headlineStyle, color: primaryColor, lineHeight: 1.15, textAlign: h.lta, letterSpacing: -0.5 }, children: coupleNames.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { width: s(60), height: s(1), background: primaryColor, opacity: 0.4 } } },
          ...(weddingDate ? [{ type: 'div', props: { style: { fontSize: s(16), fontWeight: 500, color: '#555', letterSpacing: 1 }, children: weddingDate } }] : []),
          ...(venue2 ? [{ type: 'div', props: { style: { fontSize: s(13), color: '#888', textAlign: 'center' }, children: venue2.slice(0, 50) } }] : []),
          ...(rsvpDate ? [{ type: 'div', props: { style: { fontSize: s(11), color: '#aaa', letterSpacing: 1, textTransform: 'uppercase' as const }, children: `RSVP by ${rsvpDate}` } }] : []),
        ] } },
      ] } }
    }

    case 'holiday-greeting': {
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: tk.headlineFamily, background: primaryColor }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.2 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: s(-80), right: s(-80), width: s(300), height: s(300), borderRadius: 999, background: 'rgba(255,255,255,0.06)' } } },
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(16) }, children: [
          { type: 'div', props: { style: { fontSize: s(44) }, children: '🎄' } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', width: Math.round(w * h.lk.textMaxFrac), gap: s(16) }, children: [
            { type: 'div', props: { style: { fontSize: sh(46), fontWeight: tk.headlineWeight, fontStyle: tk.headlineStyle, color: h.sTxt, lineHeight: 1.1, textAlign: h.lta, letterSpacing: -0.5 }, children: headline.slice(0, h.lk.headlineChars) } },
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: sb(16), color: h.sBody, textAlign: h.lta }, children: subheadline.slice(0, 80) } }] : []),
          ] } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(28), objectFit: 'contain', maxWidth: s(110), opacity: 0.7, marginTop: s(8) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, color: h.sMuted, letterSpacing: 3, textTransform: 'uppercase' as const, marginTop: s(8) }, children: brandName } }]),
        ] } },
      ] } }
    }

    case 'rsvp-card': {
      const eventName   = headline
      const eventDate2  = opts.eventDate ?? ''
      const eventTime2  = opts.eventTime ?? ''
      const venue3      = opts.venue ?? opts.eventLocation ?? ''
      const deadline    = opts.rsvpDeadline ?? ''
      const guestLimit2 = opts.guestLimit ?? ''
      const dressCode   = opts.dressCode ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: s(50), background: primaryColor } } },
        { type: 'div', props: { style: { position: 'absolute', top: s(14), left: s(24), right: s(24), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
          { type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.8)' }, children: 'RSVP' } },
          ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(20), objectFit: 'contain', maxWidth: s(80) } } }]
            : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, color: 'rgba(255,255,255,0.7)' }, children: brandName } }]),
        ] } },
        { type: 'div', props: { style: { position: 'absolute', top: s(50), left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(14), padding: s(24) }, children: [
          { type: 'div', props: { style: { fontSize: sh(26), fontWeight: 900, color: '#1a1a1a', lineHeight: 1.1 }, children: eventName.slice(0, h.lk.headlineChars) } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            ...(eventDate2 || eventTime2 ? [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { fontSize: s(14), color: primaryColor, fontWeight: 600 }, children: [eventDate2, eventTime2].filter(Boolean).join(' at ') } },
            ] } }] : []),
            ...(venue3 ? [{ type: 'div', props: { style: { fontSize: s(13), color: '#666' }, children: `📍 ${venue3}` } }] : []),
            ...(dressCode ? [{ type: 'div', props: { style: { fontSize: s(12), color: '#888' }, children: `Dress Code: ${dressCode}` } }] : []),
            ...(guestLimit2 ? [{ type: 'div', props: { style: { fontSize: s(12), color: '#888' }, children: guestLimit2 } }] : []),
          ] } },
          ...(deadline ? [{ type: 'div', props: { style: { fontSize: s(12), color: '#888', fontStyle: 'italic' }, children: `RSVP by ${deadline}` } }] : []),
          { type: 'div', props: { style: { display: 'flex', gap: s(10) }, children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: primaryColor, color: contrastText(primaryColor), fontSize: s(12), fontWeight: 700, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(24), paddingRight: s(24), borderRadius: s(4) }, children: 'Accept' } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: '#888', fontSize: s(12), fontWeight: 700, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(24), paddingRight: s(24), borderRadius: s(4), borderWidth: 1, borderStyle: 'solid', borderColor: '#ddd' }, children: 'Decline' } },
          ] } },
        ] } },
      ] } }
    }

    case 'crypto-price': {
      const symbol    = opts.cryptoSymbol ?? 'BTC'
      const price2    = opts.cryptoPrice ?? opts.price ?? '$94,200'
      const change    = opts.priceChange ?? stat ?? '+2.4%'
      const mktCap    = opts.marketCap ?? ''
      const isPos     = !change.startsWith('-')
      const chgColor  = isPos ? '#22c55e' : '#ef4444'
      const chartPts  = opts.chartData ?? [40, 55, 45, 60, 52, 68, 58, 72, 65, 80, 70, 85]
      const chartW    = s(160)
      const chartH    = s(50)
      const minV      = Math.min(...chartPts)
      const maxV      = Math.max(...chartPts)
      const chartPath = chartPts.map((v: number, i: number) => {
        const x = Math.round((i / (chartPts.length - 1)) * chartW)
        const y = Math.round(chartH - ((v - minV) / (maxV - minV || 1)) * chartH)
        return `${i === 0 ? 'M' : 'L'}${x},${y}`
      }).join(' ')
      const cryptoLogos: Record<string, string> = { BTC: '₿', ETH: 'Ξ', SOL: '◎', ADA: '₳' }
      const cryptoGlyph = cryptoLogos[symbol] ?? symbol.slice(0, 1)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0a0a0f' }, children: [
        { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(14), padding: sp(36) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12) }, children: [
            { type: 'div', props: { style: { width: s(36), height: s(36), borderRadius: 999, background: primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: [
              { type: 'div', props: { style: { fontSize: s(16), fontWeight: 900, color: contrastText(primaryColor) }, children: cryptoGlyph } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(16), fontWeight: 800, color: h.sTxt }, children: symbol } },
              { type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.4)' }, children: 'Cryptocurrency' } },
            ] } },
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(18), objectFit: 'contain', maxWidth: s(70), opacity: 0.4, marginLeft: 'auto' } } }] : []),
          ] } },
          // Price + change
          { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: s(12) }, children: [
            { type: 'div', props: { style: { fontSize: s(44), fontWeight: 900, color: h.sTxt, letterSpacing: -1, lineHeight: 1 }, children: price2 } },
            { type: 'div', props: { style: { fontSize: s(18), fontWeight: 700, color: chgColor }, children: change } },
          ] } },
          ...(mktCap ? [{ type: 'div', props: { style: { fontSize: s(12), color: 'rgba(255,255,255,0.4)' }, children: `Mkt Cap: ${mktCap}` } }] : []),
        ] } },
        // Sparkline
        { type: 'div', props: { style: { width: Math.round(w * 0.32), display: 'flex', alignItems: 'center', justifyContent: 'center', paddingRight: s(28), flexShrink: 0 }, children: [
          { type: 'svg', props: { width: chartW, height: chartH, viewBox: `0 0 ${chartW} ${chartH}`, style: {}, children: [
            { type: 'path', props: { d: chartPath, fill: 'none', stroke: chgColor, 'stroke-width': String(s(2)), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' } },
          ] } },
        ] } },
      ] } }
    }

    case 'portfolio-snapshot': {
      const value   = opts.portfolioValue ?? opts.price ?? '$47,320'
      const change2 = opts.portfolioChange ?? stat ?? '+$3,240'
      const isPos2  = !change2.startsWith('-')
      const chgC    = isPos2 ? '#22c55e' : '#ef4444'
      const pDate   = opts.publishDate ?? opts.eventDate ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#0a0a0f' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(20), padding: sp(40) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.4)' }, children: brandName } }]),
            { type: 'div', props: { style: { fontSize: s(11), color: 'rgba(255,255,255,0.3)' }, children: pDate || 'Portfolio' } },
          ] } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(6) }, children: [
            { type: 'div', props: { style: { fontSize: s(13), color: 'rgba(255,255,255,0.5)', letterSpacing: 1 }, children: 'Total Value' } },
            { type: 'div', props: { style: { display: 'flex', fontSize: s(56), fontWeight: 900, color: h.sTxt, letterSpacing: -2, lineHeight: 1 }, children: value } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { fontSize: s(20), fontWeight: 700, color: chgC }, children: change2 } },
              { type: 'div', props: { style: { fontSize: s(12), color: 'rgba(255,255,255,0.35)' }, children: 'Today' } },
            ] } },
          ] } },
          { type: 'div', props: { style: { fontSize: s(14), color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }, children: headline.slice(0, 60) } },
        ] } },
      ] } }
    }

    case 'savings-goal': {
      const goal     = opts.savingsGoal ?? '$10,000'
      const saved    = opts.savedAmount ?? stat ?? '$6,840'
      const progress = opts.savingsProgress ?? 68
      const barFillW = Math.round((progress / 100) * (w - s(80)))
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(18), padding: sp(36) }, children: [
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { fontSize: s(22), fontWeight: 800, color: '#1a1a1a' }, children: headline.slice(0, 35) } },
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(22), objectFit: 'contain', maxWidth: s(80) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: brandName } }]),
          ] } },
          // Progress bar large
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(10) }, children: [
            { type: 'div', props: { style: { width: w - s(72), height: s(18), background: '#f0f0f0', borderRadius: s(9), position: 'relative', overflow: 'hidden', display: 'flex' }, children: [
              { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, height: s(18), width: barFillW, background: primaryColor, borderRadius: s(9) } } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
              { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
                { type: 'div', props: { style: { fontSize: s(32), fontWeight: 900, color: primaryColor, lineHeight: 1 }, children: saved } },
                { type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: 'saved' } },
              ] } },
              { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: s(2) }, children: [
                { type: 'div', props: { style: { fontSize: s(24), fontWeight: 700, color: '#888', lineHeight: 1 }, children: goal } },
                { type: 'div', props: { style: { fontSize: s(11), color: '#bbb' }, children: 'goal' } },
              ] } },
            ] } },
            { type: 'div', props: { style: { fontSize: s(14), fontWeight: 700, color: primaryColor, textAlign: 'center' }, children: `${progress}% Complete` } },
          ] } },
          ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(13), color: '#888', textAlign: 'center', fontStyle: 'italic' }, children: subheadline.slice(0, 80) } }] : []),
        ] } },
      ] } }
    }

    case 'appointment-card': {
      const apptType   = opts.appointmentType ?? headline
      const apptTime   = opts.appointmentTime ?? opts.eventTime ?? ''
      const apptDate   = opts.eventDate ?? ''
      const provider   = opts.providerName ?? brandName
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: primaryColor }, children: [
        ...(bgImageData ? [{ type: 'img', props: { src: bgImageData, style: { position: 'absolute', top: 0, left: 0, width: w, height: height, objectFit: 'cover', opacity: 0.1 } } }] : []),
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }, children: [
          // Left: date
          { type: 'div', props: { style: { width: Math.round(w * 0.3), height: height, flexShrink: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(6) }, children: [
            { type: 'div', props: { style: { fontSize: s(52) }, children: '📅' } },
            ...(apptDate ? [{ type: 'div', props: { style: { fontSize: s(16), fontWeight: 800, color: h.sTxt, textAlign: 'center' }, children: apptDate } }] : []),
            ...(apptTime ? [{ type: 'div', props: { style: { fontSize: s(20), fontWeight: 900, color: h.sTxt }, children: apptTime } }] : []),
          ] } },
          // Right: info
          { type: 'div', props: { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: s(14), paddingLeft: s(28), paddingRight: s(28) }, children: [
            { type: 'div', props: { style: { fontSize: s(10), fontWeight: 700, letterSpacing: 3, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' as const }, children: 'Appointment' } },
            { type: 'div', props: { style: { fontSize: sh(26), fontWeight: 900, color: h.sTxt, lineHeight: 1.1 }, children: apptType.slice(0, h.lk.headlineChars) } },
            { type: 'div', props: { style: { fontSize: s(14), color: h.sBody }, children: provider } },
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', color: primaryColor, fontSize: s(11), fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' as const, paddingTop: s(10), paddingBottom: s(10), paddingLeft: s(20), paddingRight: s(20), borderRadius: s(4), alignSelf: 'flex-start' }, children: opts.ctaText ?? 'Add to Calendar' } },
          ] } },
        ] } },
      ] } }
    }

    case 'health-metrics': {
      const steps     = opts.steps ?? '8,432'
      const heartRate = opts.heartRate ?? '72 bpm'
      const calories3 = opts.calories2 ?? opts.calories ?? '1,840'
      const sleep     = opts.sleepHours ?? '7h 23m'
      const metrics   = [
        { icon: '👣', label: 'Steps', value: steps, color: '#22c55e' },
        { icon: '❤️', label: 'Heart Rate', value: heartRate, color: '#ef4444' },
        { icon: '🔥', label: 'Calories', value: calories3, color: '#f59e0b' },
        { icon: '😴', label: 'Sleep', value: sleep, color: '#6366f1' },
      ]
      const halfW2   = Math.round(w / 2)
      const halfH    = Math.round(height / 2)
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#f8fafc' }, children: [
        // 2x2 grid
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexWrap: 'nowrap', flexDirection: 'column' }, children: [
          // Row 1
          { type: 'div', props: { style: { display: 'flex', height: halfH, flexShrink: 0 }, children: [
            { type: 'div', props: { style: { width: halfW2, height: halfH, flexShrink: 0, borderRightWidth: s(2), borderRightStyle: 'solid', borderRightColor: '#e2e8f0', borderBottomWidth: s(2), borderBottomStyle: 'solid', borderBottomColor: '#e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { fontSize: s(28) }, children: metrics[0].icon } },
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: metrics[0].color }, children: metrics[0].value } },
              { type: 'div', props: { style: { fontSize: s(10), color: '#888', letterSpacing: 1 }, children: metrics[0].label } },
            ] } },
            { type: 'div', props: { style: { width: halfW2, height: halfH, flexShrink: 0, borderBottomWidth: s(2), borderBottomStyle: 'solid', borderBottomColor: '#e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { fontSize: s(28) }, children: metrics[1].icon } },
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: metrics[1].color }, children: metrics[1].value } },
              { type: 'div', props: { style: { fontSize: s(10), color: '#888', letterSpacing: 1 }, children: metrics[1].label } },
            ] } },
          ] } },
          // Row 2
          { type: 'div', props: { style: { display: 'flex', height: halfH, flexShrink: 0 }, children: [
            { type: 'div', props: { style: { width: halfW2, height: halfH, flexShrink: 0, borderRightWidth: s(2), borderRightStyle: 'solid', borderRightColor: '#e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { fontSize: s(28) }, children: metrics[2].icon } },
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: metrics[2].color }, children: metrics[2].value } },
              { type: 'div', props: { style: { fontSize: s(10), color: '#888', letterSpacing: 1 }, children: metrics[2].label } },
            ] } },
            { type: 'div', props: { style: { width: halfW2, height: halfH, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: s(8) }, children: [
              { type: 'div', props: { style: { fontSize: s(28) }, children: metrics[3].icon } },
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: metrics[3].color }, children: metrics[3].value } },
              { type: 'div', props: { style: { fontSize: s(10), color: '#888', letterSpacing: 1 }, children: metrics[3].label } },
            ] } },
          ] } },
        ] } },
        // Brand overlay
        ...(logoData ? [{ type: 'div', props: { style: { position: 'absolute', bottom: s(8), right: s(12) }, children: [
          { type: 'img', props: { src: logoData, style: { height: s(14), objectFit: 'contain', maxWidth: s(50), opacity: 0.3 } } },
        ] } }] : []),
      ] } }
    }

    case 'habit-tracker': {
      const habits    = opts.habitItems ?? [
        { name: 'Drink 8 glasses of water', done: true },
        { name: 'Exercise 30 minutes', done: true },
        { name: 'Read for 20 minutes', done: false },
        { name: 'Meditate', done: true },
        { name: 'Sleep 8 hours', done: false },
      ]
      const doneCount = habits.filter((hb: { done: boolean }) => hb.done).length
      const total     = habits.length
      const trackerDate = opts.eventDate ?? opts.publishDate ?? ''
      return { type: 'div', props: { style: { width: w, height: height, display: 'flex', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', background: '#ffffff' }, children: [
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', gap: s(14), padding: sp(28) }, children: [
          // Header
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(22), fontWeight: 900, color: '#1a1a1a' }, children: headline.slice(0, 30) } },
              ...(trackerDate ? [{ type: 'div', props: { style: { fontSize: s(11), color: '#888' }, children: trackerDate } }] : []),
            ] } },
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s(2) }, children: [
              { type: 'div', props: { style: { fontSize: s(26), fontWeight: 900, color: primaryColor }, children: `${doneCount}/${total}` } },
              { type: 'div', props: { style: { fontSize: s(9), color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }, children: 'done' } },
            ] } },
          ] } },
          // Habits
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: s(8), flex: 1, justifyContent: 'center' }, children:
            habits.slice(0, 6).map((habit: { name: string; done: boolean }) => ({ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: s(12) }, children: [
              { type: 'div', props: { style: { width: s(22), height: s(22), borderRadius: s(5), background: habit.done ? primaryColor : 'transparent', borderWidth: s(2), borderStyle: 'solid', borderColor: habit.done ? primaryColor : '#ddd', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: [
                ...(habit.done ? [{ type: 'div', props: { style: { fontSize: s(11), fontWeight: 900, color: contrastText(primaryColor) }, children: '✓' } }] : []),
              ] } },
              { type: 'div', props: { style: { fontSize: s(14), color: habit.done ? '#888' : '#1a1a1a', textDecoration: habit.done ? 'line-through' : 'none' }, children: habit.name.slice(0, 40) } },
            ] } }))
          } },
          // Footer
          { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: s(8), borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: '#eee' }, children: [
            ...(subheadline ? [{ type: 'div', props: { style: { fontSize: s(11), color: '#aaa', fontStyle: 'italic' }, children: subheadline.slice(0, 50) } }] : []),
            ...(logoData ? [{ type: 'img', props: { src: logoData, style: { height: s(16), objectFit: 'contain', maxWidth: s(60) } } }]
              : [{ type: 'div', props: { style: { fontSize: s(10), color: '#ccc', letterSpacing: 1 }, children: brandName } }]),
          ] } },
        ] } },
      ] } }
    }

    default: return null
  }
}
