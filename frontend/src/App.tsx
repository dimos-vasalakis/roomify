import { PanelLeftOpen } from 'lucide-react'
import { useEffect } from 'react'
import { LIVE } from './api/config'
import { AuthGate, useAuth } from './auth/AuthGate'
import { Board } from './components/board/Board'
import { Backdrop } from './components/shell/Backdrop'
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
        dispatch({ type: 'toggleRail' })
        return
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        if (state.view3d) dispatch({ type: 'view3d', on: false })
        else if (state.playingWalkInId) dispatch({ type: 'play', id: null })
        else if (state.selectedProductId) dispatch({ type: 'selectProduct', id: null })
        else if (state.voice.pending) dispatch({ type: 'setVoice', voice: { pending: null } })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.view3d, state.playingWalkInId, state.selectedProductId, state.voice.pending, dispatch])
}

/** The board: rooms rail, the room, and the conversation. */
function Workspace() {
  const { signedIn } = useAuth()
  const { state, dispatch } = useStore()
  useSampleRun()
  useLiveSync(signedIn)
  useShortcuts()
  const hidden = state.railHidden

  return (
    <div className="relative flex min-h-dvh">
      <Backdrop />
      {/* The rail slides fully away; the room takes the width. */}
      <div
        className={`sticky top-0 z-10 hidden h-dvh shrink-0 overflow-hidden transition-[width] duration-500 ease-[var(--ease-in-out)] lg:block ${hidden ? 'w-0' : 'w-rail'}`}
        inert={hidden}
      >
        <div className={`transition-[transform,opacity] duration-500 ease-[var(--ease-in-out)] ${hidden ? '-translate-x-full opacity-0' : ''}`}>
          <Rail />
        </div>
      </div>
      {hidden && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'toggleRail' })}
          aria-label="Show rooms (Ctrl B)"
          title="Show rooms (Ctrl B)"
          className="press fixed top-4 left-4 z-30 hidden size-10 place-items-center rounded-control bg-surface text-ink ring-1 ring-border hover:ring-ink lg:grid"
        >
          <PanelLeftOpen size={18} strokeWidth={2} />
        </button>
      )}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <PhoneBar />
        <main
          className={`grid flex-1 grid-cols-[minmax(0,1fr)] items-start gap-4 px-4 pb-4 transition-[padding] duration-500 ease-[var(--ease-in-out)] lg:h-dvh lg:grid-cols-[minmax(0,1fr)_var(--spacing-talk)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:py-4 lg:pr-4 ${hidden ? 'lg:pl-16' : 'lg:pl-0'}`}
        >
          <div className="flex min-h-0 min-w-0 flex-col justify-center">
            <Board />
          </div>
          <div className="h-[78dvh] min-h-0 lg:h-auto">
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
