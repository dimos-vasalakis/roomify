import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { Mark } from '../shell/Mark'
import { LIVE } from '../../api/config'
import { HAS_SAMPLES } from '../../data/loadSamples'
import { AccountRow } from './AccountRow'
import { Credits } from './Credits'
import { SessionList } from './SessionList'

/** Desktop rooms list. Open: names and status. Closed: a rail of room thumbnails. */
export function Sidebar() {
  const { state, dispatch } = useStore()
  const actions = useActions()
  const open = state.sidebarOpen
  const toggleLabel = open ? 'Hide rooms (Ctrl B)' : 'Show rooms (Ctrl B)'

  return (
    <nav
      aria-label="Rooms"
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col lg:flex ${open ? 'w-64 px-3' : 'w-16 items-center px-2'}`}
    >
      <div className={`flex h-14 shrink-0 items-center ${open ? 'justify-between pl-2' : 'justify-center'}`}>
        {open && <Mark />}
        <button
          type="button"
          title={toggleLabel}
          aria-label={toggleLabel}
          onClick={() => dispatch({ type: 'toggleSidebar' })}
          className="press grid size-9 place-items-center rounded-control text-muted hover:bg-active hover:text-ink"
        >
          {open ? <PanelLeftClose size={16} strokeWidth={1.75} /> : <PanelLeftOpen size={16} strokeWidth={1.75} />}
        </button>
      </div>

      <button
        type="button"
        onClick={() => void actions.newRoom()}
        aria-label="New room"
        title="New room"
        className={`press mb-5 flex h-control shrink-0 items-center gap-2 rounded-control bg-secondary font-medium text-ink hover:bg-control ${open ? 'w-full px-3' : 'w-9 justify-center'}`}
      >
        <Plus size={16} strokeWidth={2} />
        {open && 'New room'}
      </button>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        <SessionList compact={!open} />
      </div>

      {open && <AccountRow />}
      {open && !LIVE && HAS_SAMPLES && (
        <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 px-2 py-4 text-small text-muted">
          Sample rooms and prices. <Credits />
        </div>
      )}
    </nav>
  )
}
