import { useEffect, useRef } from 'react'
import type { PersonaState } from './Avatar'
import { PORTRAIT } from './portrait-config'

/**
 * 2.5D portrait rig — a real portrait brought to life with the calm, reliable
 * cues only: breathes, sways gently, tilts to listen, and blinks (snap swap to
 * the eyes-closed variant). NO lip-sync — photo mouth-swapping on two stills
 * always read as a puppet, so she simply keeps her natural smile and blinks
 * while she talks (Asaf's call, 2026-07-13). A soft glow marks speaking so
 * she still feels alive without the mouth.
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
  const ringRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<PersonaState>(state)
  stateRef.current = state

  useEffect(() => {
    let raf = 0
    let nextBlink = performance.now() + 1800
    let blinkStart = 0

    const tick = (now: number) => {
      const t = now / 1000
      const s = stateRef.current
      const level = levelRef.current

      const breathe = Math.sin(t * 1.4) * 0.55
      // a touch more life while she's talking, calm otherwise — no mouth motion
      const sway = s === 'speaking' ? Math.sin(t * 2.0) * 0.7 : Math.sin(t * 0.7) * 0.3
      const tilt = s === 'listening' ? 2.2 : s === 'thinking' ? -1.2 : 0
      if (frameRef.current) {
        frameRef.current.style.transform = `translateY(${breathe.toFixed(2)}%) rotate(${(sway + tilt).toFixed(2)}deg) scale(${(1.015 + Math.sin(t * 1.4) * 0.004).toFixed(4)})`
      }

      if (now >= nextBlink && blinkStart === 0) {
        blinkStart = now
        nextBlink = now + 1800 + Math.random() * 3600
      }
      // snap blink — a 1-frame swap to eyes-closed reads as a real blink
      let lidsDown = false
      if (blinkStart > 0) {
        const elapsed = now - blinkStart
        lidsDown = elapsed < 110
        if (elapsed >= 110) blinkStart = 0
      }
      if (eyesRef.current) eyesRef.current.style.opacity = lidsDown ? '1' : '0'

      // soft ring: pulses to her voice while speaking, to the mic while listening
      if (ringRef.current) {
        if (s === 'listening') {
          ringRef.current.style.opacity = String(0.3 + level * 0.5)
          ringRef.current.style.transform = `scale(${(1 + level * 0.06).toFixed(3)})`
        } else if (s === 'speaking') {
          ringRef.current.style.opacity = String(0.25 + level * 0.55)
          ringRef.current.style.transform = `scale(${(1 + level * 0.05).toFixed(3)})`
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
    // soft-edged mask so the blink region blends into the base portrait
    WebkitMaskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, black 55%, transparent 78%)',
    maskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, black 55%, transparent 78%)',
    pointerEvents: 'none',
  })

  return (
    <div className={`relative aspect-square ${className ?? ''}`} role="img" aria-label="The Brain — your assistant">
      {/* speaking / listening ring */}
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
          {/* mouth overlay removed — she keeps her natural smile while talking */}
        </div>
      </div>
    </div>
  )
}
