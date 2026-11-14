import { useEffect } from 'react'
import { LIVE } from './api/config'
import { AuthGate, useAuth } from './auth/AuthGate'
import { Receipt } from './components/receipt/Receipt'
import { RoomsSheet } from './components/rooms/RoomsSheet'
import { Sidebar } from './components/rooms/Sidebar'
import { MobileBar } from './components/shell/MobileBar'
import { TitleRow } from './components/shell/TitleRow'
import { Stage } from './components/stage/Stage'
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
  useEffect(() => {
    if (LIVE || !state.swapping) return
    const t = setTimeout(() => dispatch({ type: 'finishSwap' }), 2200)
    return () => clearTimeout(t)
  }, [state.swapping, dispatch])

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
  const { state, active, dispatch } = useStore()
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
        else if (state.draft) dispatch({ type: 'setDraft', draft: null })
        else if (state.walkMode) dispatch({ type: 'setWalkMode', on: false })
        else if (state.selectedProductId) dispatch({ type: 'selectProduct', id: null })
        else if (state.compare) dispatch({ type: 'toggleCompare' })
      }
      if (e.key.toLowerCase() === 'w' && active.status === 'done') dispatch({ type: 'setWalkMode', on: !state.walkMode })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.playingWalkInId, state.draft, state.walkMode, state.selectedProductId, state.compare, active.status, dispatch])
}

function Workspace() {
  const { signedIn } = useAuth()
  useSampleRun()
  useLiveSync(signedIn)
  useShortcuts()

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar />
        <main className="flex flex-1 flex-col px-4 pb-4 lg:pr-6 lg:pb-6 lg:pl-2">
          <TitleRow />
          <div className="grid flex-1 items-start gap-gap xl:grid-cols-[minmax(0,1fr)_var(--spacing-receipt)] xl:items-stretch">
            <Stage />
            <Receipt />
          </div>
        </main>
      </div>
      <RoomsSheet />
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
