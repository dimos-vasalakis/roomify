import { useEffect } from 'react'
import { LIVE } from './api/config'
import { AuthGate, useAuth } from './auth/AuthGate'
import { Board } from './components/board/Board'
import { PhoneBar } from './components/shell/PhoneBar'
import { Rail } from './components/shell/Rail'
import { RoomsPanel } from './components/shell/RoomsPanel'
import { Talk } from './components/talk/Talk'
import { StoreProvider, useStore } from './state/store'
import { useLiveSync } from './state/useLiveSync'

if (new URLSearchParams(location.search).has('stage')) {
  document.documentElement.dataset.stage = ''
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** Timers that stand in for the back end while the app runs on sample data. */
function useSampleRun() {
  const { state, dispatch } = useStore()

  // The recorded live run prints a new step every 1.6 s.
  useEffect(() => {
    if (LIVE) return
    const t = setInterval(() => dispatch({ type: 'liveTick' }), 1600)
    return () => clearInterval(t)
  }, [dispatch])

  // A swap takes about two seconds.
  const realSwap = !!state.sessions.find((s) => s.id === state.activeId)?.offer
  useEffect(() => {
    if (LIVE || realSwap || !state.swapping) return
    const t = setTimeout(() => dispatch({ type: 'finishSwap' }), 2200)
    return () => clearTimeout(t)
  }, [state.swapping, realSwap, dispatch])

  // A walk-in takes about five seconds in the sample (about a minute for real).
  const making = state.sessions.flatMap((s) => s.walkIns.filter((w) => w.status === 'making').map((w) => w.id)).join()
  useEffect(() => {
    if (LIVE || !making) return
    const ids = making.split(',')
    const t = setTimeout(() => ids.forEach((id) => dispatch({ type: 'walkInReady', id })), 5000)
    return () => clearTimeout(t)
  }, [making, dispatch])
}

function useShortcuts() {
  const { state, dispatch } = useStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        dispatch({ type: 'toggleSidebar' })
        return
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        if (state.playingWalkInId) dispatch({ type: 'play', id: null })
        else if (state.selectedProductId) dispatch({ type: 'selectProduct', id: null })
        else if (state.voice.pending) dispatch({ type: 'setVoice', voice: { pending: null } })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.playingWalkInId, state.selectedProductId, state.voice.pending, dispatch])
}

/** The board: rooms rail, the room, and the conversation. */
function Workspace() {
  const { signedIn } = useAuth()
  useSampleRun()
  useLiveSync(signedIn)
  useShortcuts()

  return (
    <div className="flex min-h-dvh">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <PhoneBar />
        <main className="grid flex-1 items-start gap-4 px-4 pb-4 lg:h-dvh lg:grid-cols-[minmax(0,1fr)_var(--spacing-talk)] lg:items-stretch lg:gap-5 lg:py-4 lg:pr-4 lg:pl-0">
          <div className="flex min-w-0 flex-col justify-center">
            <Board />
          </div>
          <div className="min-h-[32rem] lg:min-h-0">
            <Talk />
          </div>
        </main>
      </div>
      <RoomsPanel />
    </div>
  )
}

export default function App() {
  return (
    <AuthGate>
      <StoreProvider>
        <Workspace />
      </StoreProvider>
    </AuthGate>
  )
}
