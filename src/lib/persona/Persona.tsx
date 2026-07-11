import { useEffect, useState } from 'react'
import { Avatar, type PersonaState } from './Avatar'
import { PortraitAvatar } from './PortraitAvatar'
import { PORTRAIT } from './portrait-config'

let portraitAvailable: boolean | null = null

/**
 * The face of the brain. Renders the 2.5D portrait rig when portrait images
 * exist in public/persona/ (see portrait-config.ts), otherwise the built-in
 * illustrated avatar. Detection runs once per session.
 */
export function Persona(props: {
  state: PersonaState
  levelRef: React.MutableRefObject<number>
  className?: string
}) {
  const [hasPortrait, setHasPortrait] = useState<boolean | null>(portraitAvailable)

  useEffect(() => {
    if (portraitAvailable !== null) return
    const img = new Image()
    img.onload = () => {
      portraitAvailable = true
      setHasPortrait(true)
    }
    img.onerror = () => {
      portraitAvailable = false
      setHasPortrait(false)
    }
    img.src = PORTRAIT.base
  }, [])

  if (hasPortrait) return <PortraitAvatar {...props} />
  return <Avatar {...props} />
}

export type { PersonaState }
