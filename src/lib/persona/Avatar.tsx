import { useEffect, useRef } from 'react'

export type PersonaState = 'idle' | 'listening' | 'thinking' | 'speaking'

/**
 * The face of the brain — hand-built illustrated portrait, animated at 60fps
 * without re-renders: blinks, breathes, tilts to listen, glances up to think,
 * and speaks with her lips driven by the live TTS amplitude in levelRef.
 * Soft-shaded editorial style on the workshop palette; no vendors, no video.
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
  const lidLRef = useRef<SVGPathElement | null>(null)
  const lidRRef = useRef<SVGPathElement | null>(null)
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
        <radialGradient id="spot" cx="50%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#243450" />
          <stop offset="70%" stopColor="#131a28" />
          <stop offset="100%" stopColor="#0e1219" />
        </radialGradient>
        {/* skin with soft top-light */}
        <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f2c39c" />
          <stop offset="62%" stopColor="#eab490" />
          <stop offset="100%" stopColor="#d99f7a" />
        </linearGradient>
        <linearGradient id="skinNeck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c98f66" />
          <stop offset="55%" stopColor="#e0a87e" />
        </linearGradient>
        {/* hair: espresso with warm sheen */}
        <linearGradient id="hairBase" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#3d2a1c" />
          <stop offset="55%" stopColor="#271a10" />
          <stop offset="100%" stopColor="#1c120a" />
        </linearGradient>
        <linearGradient id="hairLight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6b4b30" />
          <stop offset="100%" stopColor="#3d2a1c" />
        </linearGradient>
        <radialGradient id="iris" cx="38%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#9c6b3f" />
          <stop offset="55%" stopColor="#6b4224" />
          <stop offset="100%" stopColor="#3f2413" />
        </radialGradient>
        <linearGradient id="lip" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d47f90" />
          <stop offset="100%" stopColor="#b2596c" />
        </linearGradient>
        <linearGradient id="jacket" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a5484" />
          <stop offset="100%" stopColor="#273c60" />
        </linearGradient>
        <radialGradient id="blushG" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e58a70" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#e58a70" stopOpacity="0" />
        </radialGradient>
        <clipPath id="eyeL">
          <path d="M147 231 Q165 215 185 229 Q167 246 147 231 Z" />
        </clipPath>
        <clipPath id="eyeR">
          <path d="M215 229 Q235 215 253 231 Q233 246 215 229 Z" />
        </clipPath>
      </defs>

      {/* backdrop spotlight + rim + listening ring */}
      <circle cx="200" cy="230" r="186" fill="url(#spot)" />
      <circle cx="200" cy="230" r="185" fill="none" stroke="#7c97c9" strokeOpacity="0.12" strokeWidth="1.5" />
      <circle ref={ringRef} cx="200" cy="230" r="180" fill="none" stroke="#ff6b1a" strokeWidth="2.5" strokeDasharray="9 14" opacity="0" />

      <g ref={headRef}>
        {/* ── hair: back mass with soft waves falling over the shoulders ── */}
        <path
          fill="url(#hairBase)"
          d="M200 76 C136 76 104 126 106 190 C107 232 112 262 106 300 C102 328 112 348 130 356 C122 330 124 306 130 284 C126 322 136 352 158 366 C148 338 148 314 150 292 L250 292 C252 314 252 338 242 366 C264 352 274 322 270 284 C276 306 278 330 270 356 C288 348 298 328 294 300 C288 262 293 232 294 190 C296 126 264 76 200 76 Z"
        />

        {/* ── shoulders: denim jacket + tee + pendant ── */}
        <path fill="url(#jacket)" d="M92 460 C94 406 126 380 164 370 L236 370 C274 380 306 406 308 460 Z" />
        <path fill="#48679c" d="M164 370 C160 396 158 428 162 460 L180 460 C174 428 172 396 176 372 Z" />
        <path fill="#48679c" d="M236 370 C240 396 242 428 238 460 L220 460 C226 428 228 396 224 372 Z" />
        <path fill="#22355a" d="M164 370 L176 372 C176 380 178 390 180 398 L166 388 Z" />
        <path fill="#22355a" d="M236 370 L224 372 C224 380 222 390 220 398 L234 388 Z" />
        <path fill="#f2f5fa" d="M176 372 C184 396 216 396 224 372 C226 398 222 432 218 460 L182 460 C178 432 174 398 176 372 Z" />
        <path d="M200 388 L200 370" stroke="#c9d4e6" strokeWidth="1.5" opacity="0.7" />
        <circle cx="200" cy="392" r="4.4" fill="#ff6b1a" />
        <path d="M188 372 Q200 384 212 372" stroke="#c9a45c" strokeWidth="1.6" fill="none" opacity="0.9" />

        {/* ── neck with jaw shadow ── */}
        <path fill="url(#skinNeck)" d="M181 312 L219 312 L219 358 C219 374 181 374 181 358 Z" />

        {/* ── face: soft heart shape, gentle chin ── */}
        <path
          fill="url(#skin)"
          d="M200 118 C154 118 137 154 137 198 C137 230 143 258 156 280 C168 300 183 311 200 311 C217 311 232 300 244 280 C257 258 263 230 263 198 C263 154 246 118 200 118 Z"
        />
        {/* forehead sheen */}
        <ellipse cx="200" cy="170" rx="44" ry="22" fill="#fdf8f2" opacity="0.10" />
        {/* cheek blush */}
        <ellipse cx="161" cy="260" rx="15" ry="9" fill="url(#blushG)" />
        <ellipse cx="239" cy="260" rx="15" ry="9" fill="url(#blushG)" />

        {/* ── brows: sculpted tapered shapes ── */}
        <g ref={browsRef} fill="#33231a">
          <path d="M147 208 Q160 198 182 204 Q183 208 181 209 Q161 205 149 212 Z" />
          <path d="M218 204 Q240 198 253 208 Q251 212 249 211 Q239 205 219 209 Z" />
        </g>

        {/* ── eyes ── */}
        <g>
          {/* soft shadow above lids */}
          <path d="M147 227 Q166 212 185 226" stroke="#c98f66" strokeWidth="5" fill="none" opacity="0.35" strokeLinecap="round" />
          <path d="M215 226 Q234 212 253 227" stroke="#c98f66" strokeWidth="5" fill="none" opacity="0.35" strokeLinecap="round" />
          {/* whites */}
          <path d="M147 231 Q165 215 185 229 Q167 246 147 231 Z" fill="#fdfaf6" />
          <path d="M215 229 Q235 215 253 231 Q233 246 215 229 Z" fill="#fdfaf6" />
          {/* iris + pupil + catchlights */}
          <g ref={pupilsRef}>
            <g clipPath="url(#eyeL)">
              <circle cx="167" cy="230" r="9.6" fill="url(#iris)" />
              <circle cx="167" cy="230" r="4.4" fill="#160c05" />
              <circle cx="170.5" cy="226.5" r="2.5" fill="#ffffff" />
              <circle cx="163.5" cy="233.5" r="1.2" fill="#ffffff" opacity="0.6" />
            </g>
            <g clipPath="url(#eyeR)">
              <circle cx="233" cy="230" r="9.6" fill="url(#iris)" />
              <circle cx="233" cy="230" r="4.4" fill="#160c05" />
              <circle cx="236.5" cy="226.5" r="2.5" fill="#ffffff" />
              <circle cx="229.5" cy="233.5" r="1.2" fill="#ffffff" opacity="0.6" />
            </g>
          </g>
          {/* eyelids (blink) — skin shutters shaped to the sockets */}
          <path ref={lidLRef} d="M145 218 L187 218 L187 246 Q166 250 145 246 Z" fill="#ecb891" style={{ transformOrigin: '166px 218px' }} transform="scale(1 0.001)" />
          <path ref={lidRRef} d="M213 218 L255 218 L255 246 Q234 250 213 246 Z" fill="#ecb891" style={{ transformOrigin: '234px 218px' }} transform="scale(1 0.001)" />
          {/* lash lines with wings */}
          <path d="M147 230 Q165 214 185 228" stroke="#241408" strokeWidth="3.8" fill="none" strokeLinecap="round" />
          <path d="M215 228 Q235 214 253 230" stroke="#241408" strokeWidth="3.8" fill="none" strokeLinecap="round" />
          <path d="M147 230 L141 225" stroke="#241408" strokeWidth="3" strokeLinecap="round" />
          <path d="M253 230 L259 225" stroke="#241408" strokeWidth="3" strokeLinecap="round" />
          {/* lower lash hint */}
          <path d="M152 239 Q166 245 181 239" stroke="#b07a54" strokeWidth="2" fill="none" opacity="0.55" strokeLinecap="round" />
          <path d="M219 239 Q234 245 248 239" stroke="#b07a54" strokeWidth="2" fill="none" opacity="0.55" strokeLinecap="round" />
        </g>

        {/* ── nose: soft shadow, no outline ── */}
        <path d="M197 240 Q193 258 190 264 Q195 270 200 268" fill="none" stroke="#d99f7a" strokeWidth="3.4" strokeLinecap="round" opacity="0.8" />
        <ellipse cx="194" cy="267" rx="2" ry="1.3" fill="#c98f66" opacity="0.7" />
        <ellipse cx="205" cy="267" rx="2" ry="1.3" fill="#c98f66" opacity="0.7" />

        {/* ── mouth: open layer (amplitude-driven) ── */}
        <g ref={mouthOpenRef} opacity="0" style={{ transformOrigin: '200px 288px' }}>
          <path d="M182 288 Q200 283 218 288 Q215 308 200 310 Q185 308 182 288 Z" fill="#59202c" />
          <path d="M188 288 Q200 285 212 288 Q210 294 200 295 Q190 294 188 288 Z" fill="#fdfaf6" />
          <path d="M186 301 Q200 309 214 301 Q209 307 200 308 Q191 307 186 301 Z" fill="#c9697e" />
        </g>
        {/* ── mouth: closed — full lips, cupid's bow, soft smile ── */}
        <g ref={lipsClosedRef}>
          <path
            d="M181 287 Q190 279 197 283 Q200 285 203 283 Q210 279 219 287 Q212 291 200 291 Q188 291 181 287 Z"
            fill="url(#lip)"
          />
          <path d="M183 288 Q200 299 217 288 Q211 297 200 297 Q189 297 183 288 Z" fill="#a94f63" />
          <path d="M193 285 Q200 288 207 285" stroke="#8e3c50" strokeWidth="1.4" fill="none" opacity="0.7" />
          <ellipse cx="200" cy="293" rx="6" ry="1.6" fill="#e8a2b0" opacity="0.55" />
        </g>

        {/* ── hair: front — two clean curtain lobes meeting at a centre part;
               they hug the OUTSIDE of the face and never cross it ── */}
        <path
          fill="url(#hairBase)"
          d="M204 110 C168 114 146 144 140 186 C130 238 132 296 150 338 C156 341 161 338 163 333 C152 296 150 246 156 206 C160 178 172 154 192 142 C198 133 202 122 204 110 Z"
        />
        <path
          fill="url(#hairBase)"
          d="M204 110 C244 111 264 142 268 184 C276 238 272 300 256 338 C250 341 245 338 243 333 C254 296 256 248 250 208 C246 180 236 158 218 146 C210 136 205 122 204 110 Z"
        />
        {/* crown — solid cover, part reads as a seam line */}
        <path fill="url(#hairBase)" d="M148 176 C142 118 170 98 202 97 C238 96 262 122 256 172 C248 134 228 118 204 118 C178 118 158 140 148 176 Z" />
        <path d="M205 103 L199 136" stroke="#150b05" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
        {/* highlight ribbons on the outer falls */}
        <path d="M148 160 Q136 220 146 300" stroke="url(#hairLight)" strokeWidth="5.5" fill="none" strokeLinecap="round" opacity="0.5" />
        <path d="M258 164 Q270 224 260 302" stroke="url(#hairLight)" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.45" />
        <path d="M186 146 Q172 176 166 214" stroke="url(#hairLight)" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.4" />
      </g>
    </svg>
  )
}
