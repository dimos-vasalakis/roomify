import { Menu, Plus } from 'lucide-react'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { Mark } from './Mark'

/** Phone and tablet: the mark, a button for the rooms list, and New room. */
export function MobileBar() {
  const { state, dispatch } = useStore()
  const actions = useActions()
  const waiting = state.sessions.filter((s) => s.status === 'asking').length

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-ground px-4 lg:hidden">
      <button
        type="button"
        onClick={() => dispatch({ type: 'setSheet', open: true })}
        className="press -ml-2 flex h-11 items-center gap-2 rounded-control px-2 text-chrome font-medium hover:bg-active"
      >
        <Menu size={18} strokeWidth={1.75} />
        Rooms
        {waiting > 0 && <span className="num rounded-full bg-ink px-1.5 text-small text-surface">{waiting}</span>}
      </button>
      <Mark />
      <button
        type="button"
        aria-label="New room"
        onClick={() => void actions.newRoom()}
        className="press -mr-2 grid size-11 place-items-center rounded-control hover:bg-active"
      >
        <Plus size={18} strokeWidth={1.75} />
      </button>
    </header>
  )
}
