import { createContext, useContext, useState, type ReactNode } from 'react'
import { ConversationProvider } from '@elevenlabs/react'
import { RealtimeCall } from './RealtimeCall'
import { PersonaBadge } from '../persona/PersonaBadge'
import { prewarmApi } from '../prewarm'

type CallContextValue = { open: () => void; close: () => void; isOpen: boolean }
const CallContext = createContext<CallContextValue | null>(null)

/**
 * The call is global, not a page. A big friendly "Talk to your Brain" button
 * sits on every screen; tapping it drops a full-screen call over whatever
 * you're doing. This is the front door for non-technical staff — one button,
 * everywhere, always the same.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false)

  const openCall = () => {
    prewarmApi() // boot the lambdas while the overlay animates in
    setOpen(true)
  }

  return (
    <CallContext.Provider value={{ open: openCall, close: () => setOpen(false), isOpen }}>
      {children}

      {!isOpen && (
        <button
          onClick={openCall}
          aria-label="Talk to your Brain"
          className="group fixed bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5rem))] right-4 z-40 flex items-center gap-3 rounded-full bg-safety-500 py-2 pl-2 pr-5 text-safety-950 shadow-[0_6px_20px_rgba(255,107,26,0.45)] transition hover:brightness-110 active:translate-y-0.5"
        >
          <span className="h-11 w-11 overflow-hidden rounded-full ring-2 ring-safety-950/20">
            <PersonaBadge />
          </span>
          <span className="display text-lg leading-none tracking-wide">Talk</span>
        </button>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-iron-950">
          <ConversationProvider>
            <RealtimeCall onClose={() => setOpen(false)} />
          </ConversationProvider>
        </div>
      )}
    </CallContext.Provider>
  )
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall must be used inside <CallProvider>')
  return ctx
}
