import { useEffect, useRef } from 'react'

export type PersonaState = 'idle' | 'listening' | 'thinking' | 'speaking'

/**
 * The face of the brain — hand-built illustrated portrait, animated at 60fps
 * without re-renders: blinks, breathes, tilts to listen, glances up to think,
 * and speaks with her lips driven by the live TTS amplitude in levelRef.
 * Flat editorial style on the workshop palette; no vendors, no video.
 */
export function Avatar({
  state,
  levelRef,
  className,
}: {
  state: PersonaState
  levelRef: React.MutableRefObject<number>
  className?: string
}) {
  const headRef = useRef<SVGGElement | null>(null)
  const lidLRef = useRef<SVGRectElement | null>(null)
  const lidRRef = useRef<SVGRectElement | null>(null)
  const pupilsRef = useRef<SVGGElement | null>(null)
  const browsRef = useRef<SVGGElement | null>(null)
  const lipsClosedRef = useRef<SVGGElement | null>(null)
  const mouthOpenRef = useRef<SVGGElement | null>(null)
  const ringRef = useRef<SVGCircleElement | null>(null)
  const stateRef = useRef<PersonaState>(state)
  stateRef.current = state

  useEffect(() => {
    let raf = 0
    let nextBlink = performance.now() + 1800
    let blinkStart = 0
    let open = 0 // smoothed mouth openness 0..1

    const tick = (now: number) => {
      const t = now / 1000
      const s = stateRef.current
      const level = levelRef.current

      // ── head: breathe always, sway while speaking, tilt while listening ──
      const breathe = Math.sin(t * 1.4) * 2.2
      const sway = s === 'speaking' ? Math.sin(t * 2.1) * 1.4 + level * 1.2 : Math.sin(t * 0.7) * 0.5
      const tilt = s === 'listening' ? 3.2 : s === 'thinking' ? -1.6 : 0
      headRef.current?.setAttribute('transform', `translate(0 ${breathe.toFixed(2)}) rotate(${(sway + tilt).toFixed(2)} 200 250)`)

      // ── blink ──
      if (now >= nextBlink && blinkStart === 0) {
        blinkStart = now
        nextBlink = now + 1800 + Math.random() * 3600
      }
      let lid = 0
      if (blinkStart > 0) {
        const p = (now - blinkStart) / 130
        lid = p >= 2 ? 0 : p <= 1 ? p : 2 - p
        if (p >= 2) blinkStart = 0
      }
      const lidScale = Math.max(0.001, lid).toFixed(3)
      lidLRef.current?.setAttribute('transform', `scale(1 ${lidScale})`)
      lidRRef.current?.setAttribute('transform', `scale(1 ${lidScale})`)

      // ── gaze: up-left when thinking, tiny wander when idle ──
      const gx = s === 'thinking' ? 3.4 : Math.sin(t * 0.33) * 1.1
      const gy = s === 'thinking' ? -3.6 : Math.cos(t * 0.41) * 0.7
      pupilsRef.current?.setAttribute('transform', `translate(${gx.toFixed(2)} ${gy.toFixed(2)})`)

      // ── brows: raised while listening/thinking ──
      const browLift = s === 'listening' ? -3.5 : s === 'thinking' ? -2.2 : 0
      browsRef.current?.setAttribute('transform', `translate(0 ${browLift.toFixed(2)})`)

      // ── mouth: amplitude-driven while speaking ──
      const target = s === 'speaking' ? Math.min(1, level * 1.9) : 0
      open += (target - open) * 0.42
      const o = Math.max(0, Math.min(1, open))
      mouthOpenRef.current?.setAttribute('transform', `translate(0 ${(o * 2).toFixed(2)}) scale(1 ${Math.max(0.001, o).toFixed(3)})`)
      mouthOpenRef.current?.setAttribute('opacity', o < 0.06 ? '0' : '1')
      lipsClosedRef.current?.setAttribute('opacity', o < 0.06 ? '1' : String(Math.max(0, 1 - o * 2.4).toFixed(2)))

      // ── listening ring: pulses with the caller's mic level ──
      if (ringRef.current) {
        if (s === 'listening') {
          ringRef.current.setAttribute('r', String(178 + level * 26))
          ringRef.current.setAttribute('opacity', String(0.25 + level * 0.5))
        } else {
          ringRef.current.setAttribute('opacity', '0')
        }
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [levelRef])

  return (
    <svg viewBox="0 0 400 460" className={className} role="img" aria-label="The Brain — your assistant">
      <defs>
        <radialGradient id="spot" cx="50%" cy="34%" r="70%">
          <stop offset="0%" stopColor="#22314b" />
          <stop offset="100%" stopColor="#0e1219" />
        </radialGradient>
        <linearGradient id="hairShine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4a3526" />
          <stop offset="100%" stopColor="#2b1d16" />
        </linearGradient>
        <clipPath id="eyeL">
          <path d="M146 230 Q163 216 181 229 Q164 245 146 230 Z" />
        </clipPath>
        <clipPath id="eyeR">
          <path d="M219 229 Q237 216 254 230 Q236 245 219 229 Z" />
        </clipPath>
      </defs>

      {/* backdrop spotlight + listening ring */}
      <circle cx="200" cy="230" r="186" fill="url(#spot)" />
      <circle ref={ringRef} cx="200" cy="230" r="180" fill="none" stroke="#ff6b1a" strokeWidth="2.5" strokeDasharray="9 14" opacity="0" />

      <g ref={headRef}>
        {/* hair — back mass */}
        <path
          fill="url(#hairShine)"
          d="M200 82 C132 82 106 138 108 196 C109 238 118 280 112 330 C108 362 128 378 156 378 L244 378 C272 378 292 362 288 330 C282 280 291 238 292 196 C294 138 268 82 200 82 Z"
        />

        {/* shoulders — denim jacket over tee */}
        <g>
          <path fill="#2e4470" d="M96 460 C98 408 128 382 165 372 L235 372 C272 382 302 408 304 460 Z" />
          <path fill="#48679c" d="M162 372 L165 372 C165 396 172 428 178 460 L160 460 C152 428 154 396 162 372 Z" />
          <path fill="#48679c" d="M238 372 L235 372 C235 396 228 428 222 460 L240 460 C248 428 246 396 238 372 Z" />
          <path fill="#edf1f8" d="M178 376 C186 400 214 400 222 376 C222 396 218 430 214 460 L186 460 C182 430 178 396 178 376 Z" />
        </g>

        {/* neck */}
        <path fill="#e0a87e" d="M178 318 L222 318 L222 362 C222 378 178 378 178 362 Z" />
        <path fill="#c98f66" d="M178 318 L222 318 L222 334 C208 344 192 344 178 334 Z" />

        {/* face — soft oval, fuller cheeks, gentle chin */}
        <path
          fill="#e8b48f"
          d="M200 122 C152 122 136 160 136 202 C136 232 142 258 154 278 C166 298 182 310 200 310 C218 310 234 298 246 278 C258 258 264 232 264 202 C264 160 248 122 200 122 Z"
        />
        {/* earrings peeking below the hair */}
        <circle cx="141" cy="250" r="4" fill="#ff6b1a" />
        <circle cx="259" cy="250" r="4" fill="#ff6b1a" />

        {/* brows — soft arches */}
        <g ref={browsRef} stroke="#3a2a20" strokeWidth="4.2" strokeLinecap="round" fill="none">
          <path d="M148 209 Q163 201 180 207" />
          <path d="M220 207 Q237 201 252 209" />
        </g>

        {/* eyes — larger, open, warm */}
        <g>
          <path d="M146 230 Q163 216 181 229 Q164 245 146 230 Z" fill="#fdf8f2" />
          <path d="M219 229 Q237 216 254 230 Q236 245 219 229 Z" fill="#fdf8f2" />
          <g ref={pupilsRef}>
            <g clipPath="url(#eyeL)">
              <circle cx="164" cy="230" r="8.6" fill="#5b3a24" />
              <circle cx="164" cy="230" r="4" fill="#241408" />
              <circle cx="167" cy="227" r="2" fill="#fdf8f2" />
            </g>
            <g clipPath="url(#eyeR)">
              <circle cx="236" cy="230" r="8.6" fill="#5b3a24" />
              <circle cx="236" cy="230" r="4" fill="#241408" />
              <circle cx="239" cy="227" r="2" fill="#fdf8f2" />
            </g>
          </g>
          {/* eyelids (blink) — skin-toned shutters scaling down over the eyes */}
          <g>
            <rect ref={lidLRef} x="143" y="215" width="42" height="30" fill="#e8b48f" style={{ transformOrigin: '164px 215px' }} transform="scale(1 0.001)" />
            <rect ref={lidRRef} x="216" y="215" width="42" height="30" fill="#e8b48f" style={{ transformOrigin: '237px 215px' }} transform="scale(1 0.001)" />
          </g>
          {/* lash lines + small flicks */}
          <path d="M146 229 Q163 215 181 228" stroke="#2b1d16" strokeWidth="3.4" fill="none" strokeLinecap="round" />
          <path d="M219 228 Q237 215 254 229" stroke="#2b1d16" strokeWidth="3.4" fill="none" strokeLinecap="round" />
          <path d="M146 230 L140 226" stroke="#2b1d16" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M254 230 L260 226" stroke="#2b1d16" strokeWidth="2.6" strokeLinecap="round" />
        </g>

        {/* nose — minimal */}
        <path d="M200 246 Q198 258 194 264 Q199 268 206 265" stroke="#c98f66" strokeWidth="3" fill="none" strokeLinecap="round" />

        {/* blush */}
        <ellipse cx="158" cy="258" rx="11" ry="6" fill="#e59a78" opacity="0.45" />
        <ellipse cx="242" cy="258" rx="11" ry="6" fill="#e59a78" opacity="0.45" />

        {/* mouth — open layer (amplitude-driven), pivot at lip line */}
        <g ref={mouthOpenRef} opacity="0" style={{ transformOrigin: '200px 286px' }}>
          <path d="M183 286 Q200 282 217 286 Q214 305 200 307 Q186 305 183 286 Z" fill="#5e2330" />
          <path d="M188 286 Q200 284 212 286 Q210 292 200 293 Q190 292 188 286 Z" fill="#fdf8f2" />
          <path d="M187 299 Q200 306 213 299 Q208 305 200 306 Q192 305 187 299 Z" fill="#c66a80" />
        </g>
        {/* mouth — closed: soft smile with cupid's bow */}
        <g ref={lipsClosedRef}>
          <path d="M183 286 Q192 280 198 284 Q200 285 202 284 Q208 280 217 286 Q209 293 200 293 Q191 293 183 286 Z" fill="#c66a80" />
          <path d="M186 288 Q200 296 214 288 Q208 296 200 296 Q192 296 186 288 Z" fill="#a94f66" />
        </g>

        {/* hair — front: curtain part, both eyes clear, face-framing strands */}
        <path
          fill="url(#hairShine)"
          d="M200 84 C144 84 120 126 122 184 L128 300 C129 316 138 324 148 322 C142 288 138 246 142 212 C146 178 154 156 170 144 C163 168 161 190 162 204 C176 178 206 166 224 150 C230 168 238 184 252 194 C256 206 258 240 254 288 C252 310 258 322 268 320 C276 316 279 306 278 292 L280 184 C282 126 256 84 200 84 Z"
        />
        {/* loose face-framing strand */}
        <path d="M168 148 Q158 190 162 232" stroke="url(#hairShine)" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path d="M240 160 Q248 196 246 234" stroke="url(#hairShine)" strokeWidth="8" fill="none" strokeLinecap="round" />
        {/* hair shine */}
        <path d="M150 130 Q138 176 142 230" stroke="#5d4432" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.45" />
        <path d="M254 136 Q262 180 258 232" stroke="#5d4432" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.4" />
      </g>
    </svg>
  )
}
