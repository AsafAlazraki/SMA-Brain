import { useEffect, useRef } from 'react'
import type { PersonaState } from './Avatar'
import { PORTRAIT } from './portrait-config'

/**
 * 2.5D portrait rig — a real portrait image brought to life: breathes, sways,
 * tilts to listen, blinks (eye-region crossfade to the eyes-closed variant)
 * and speaks (mouth-region crossfade to the mouth-open variant, driven by
 * live TTS amplitude). Regions are soft-masked so seams vanish.
 */
export function PortraitAvatar({
  state,
  levelRef,
  className,
}: {
  state: PersonaState
  levelRef: React.MutableRefObject<number>
  className?: string
}) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const eyesRef = useRef<HTMLDivElement | null>(null)
  const mouthRef = useRef<HTMLDivElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<PersonaState>(state)
  stateRef.current = state

  useEffect(() => {
    let raf = 0
    let nextBlink = performance.now() + 1800
    let blinkStart = 0
    let mouthOpen = false
    let mouthChangedAt = 0

    const tick = (now: number) => {
      const t = now / 1000
      const s = stateRef.current
      const level = levelRef.current

      const breathe = Math.sin(t * 1.4) * 0.55
      const sway = s === 'speaking' ? Math.sin(t * 2.1) * 0.8 + level * 0.7 : Math.sin(t * 0.7) * 0.3
      const tilt = s === 'listening' ? 2.2 : s === 'thinking' ? -1.2 : 0
      if (frameRef.current) {
        frameRef.current.style.transform = `translateY(${breathe.toFixed(2)}%) rotate(${(sway + tilt).toFixed(2)}deg) scale(${(1.015 + Math.sin(t * 1.4) * 0.004).toFixed(4)})`
      }

      if (now >= nextBlink && blinkStart === 0) {
        blinkStart = now
        nextBlink = now + 1800 + Math.random() * 3600
      }
      // snap blink — no crossfade frames (ghosting between non-identical
      // portrait variants looks wrong; a 1-frame swap reads as a real blink)
      let lidsDown = false
      if (blinkStart > 0) {
        const elapsed = now - blinkStart
        lidsDown = elapsed < 110
        if (elapsed >= 110) blinkStart = 0
      }
      if (eyesRef.current) eyesRef.current.style.opacity = lidsDown ? '1' : '0'

      // mouth: 2-frame flap with hysteresis + minimum hold — crossfading
      // between non-identical variants at 60fps strobes and looks unhinged
      if (s === 'speaking') {
        if (mouthOpen) {
          if (level < 0.09 && now - mouthChangedAt > 90) {
            mouthOpen = false
            mouthChangedAt = now
          }
        } else if (level > 0.2 && now - mouthChangedAt > 70) {
          mouthOpen = true
          mouthChangedAt = now
        }
      } else {
        mouthOpen = false
      }
      if (mouthRef.current) mouthRef.current.style.opacity = mouthOpen ? '1' : '0'

      if (ringRef.current) {
        if (s === 'listening') {
          ringRef.current.style.opacity = String(0.3 + level * 0.5)
          ringRef.current.style.transform = `scale(${(1 + level * 0.06).toFixed(3)})`
        } else {
          ringRef.current.style.opacity = '0'
        }
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [levelRef])

  const region = (
    box: { x: number; y: number; w: number; h: number; dx?: number; dy?: number },
    image: string,
  ): React.CSSProperties => ({
    position: 'absolute',
    left: `${box.x}%`,
    top: `${box.y}%`,
    width: `${box.w}%`,
    height: `${box.h}%`,
    backgroundImage: `url(${image})`,
    backgroundSize: `${10000 / box.w}% ${10000 / box.h}%`,
    backgroundPosition: `${((box.x - (box.dx ?? 0)) / (100 - box.w)) * 100}% ${((box.y - (box.dy ?? 0)) / (100 - box.h)) * 100}%`,
    opacity: 0,
    // soft-edged mask so the crossfade region blends into the base portrait
    WebkitMaskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, black 55%, transparent 78%)',
    maskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, black 55%, transparent 78%)',
    pointerEvents: 'none',
  })

  return (
    <div className={`relative aspect-square ${className ?? ''}`} role="img" aria-label="The Brain — your assistant">
      {/* listening ring */}
      <div
        ref={ringRef}
        className="pointer-events-none absolute inset-0 rounded-full border-2 border-dashed border-safety-500 transition-none"
        style={{ opacity: 0 }}
        aria-hidden
      />
      <div className="absolute inset-[3%] overflow-hidden rounded-full bg-steel-900">
        <div ref={frameRef} className="relative h-full w-full will-change-transform">
          <img src={PORTRAIT.base} alt="" className="h-full w-full object-cover" draggable={false} />
          <div ref={eyesRef} style={region(PORTRAIT.eyes, PORTRAIT.eyesClosed)} aria-hidden />
          <div ref={mouthRef} style={region(PORTRAIT.mouth, PORTRAIT.mouthOpen)} aria-hidden />
        </div>
      </div>
    </div>
  )
}
