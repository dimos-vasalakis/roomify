import { useEffect } from 'react'
import { LIVE } from './api/config'
import { AuthGate, useAuth } from './auth/AuthGate'
import { Board } from './components/board/Board'
import { Backdrop } from './components/shell/Backdrop'
import { TopBar } from './components/shell/TopBar'
import { RoomsPanel } from './components/shell/RoomsPanel'
import { Toast } from './components/common/Toast'
import { Sheet } from './components/sheet/Sheet'
import { isWorking } from './lib/session'
import { useActions } from './state/actions'
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
}

function useShortcuts() {
  const { state, active, dispatch } = useStore()
  const actions = useActions()
  const undo = actions.undo
  const canUndo = !!active.past?.length && !isWorking(active) && active.status !== 'new'
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl Z / Cmd Z outside a text box: back to the room before the last message.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing(e.target)) {
        if (!canUndo) return
        e.preventDefault()
        undo()
        return
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        if (state.view3d) dispatch({ type: 'view3d', on: false })
        else if (state.selectedProductId) dispatch({ type: 'selectProduct', id: null })
        else if (state.voice.pending) dispatch({ type: 'setVoice', voice: { pending: null } })
        else if (state.toast) dispatch({ type: 'toast', toast: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.view3d, state.selectedProductId, state.voice.pending, state.toast, canUndo, undo, dispatch])

  // Closing or reloading the tab while Roomify works would throw the run away: the browser asks first.
  const anyWorking = state.sessions.some(isWorking)
  useEffect(() => {
    if (!anyWorking) return
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [anyWorking])
}

/** One drawing sheet: the title strip, the room as large as it fits, and the schedule beside it. */
function Workspace() {
  const { signedIn } = useAuth()
  useSampleRun()
  useLiveSync(signedIn)
  useShortcuts()

  return (
    <div className="relative flex min-h-dvh flex-col lg:h-dvh">
      <Backdrop />
      <TopBar />
      <main className="relative z-10 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col justify-center">
          <Board />
        </div>
        <div className="min-h-[34rem] lg:min-h-0">
          <Sheet />
        </div>
      </main>
      <RoomsPanel />
      <Toast />
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
