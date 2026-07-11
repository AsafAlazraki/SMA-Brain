import { useEffect, useState } from 'react'
import { PORTRAIT } from './portrait-config'

/**
 * Tiny static face for the floating "Talk" button — the portrait if present,
 * else a simple safety-orange glyph. No animation (keeps the FAB cheap).
 */
export function PersonaBadge() {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => setSrc(PORTRAIT.base)
    img.src = PORTRAIT.base
  }, [])

  if (src) return <img src={src} alt="" className="h-full w-full scale-[1.15] object-cover" draggable={false} />
  return (
    <span className="flex h-full w-full items-center justify-center bg-steel-800">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff6b1a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      </svg>
    </span>
  )
}
