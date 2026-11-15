import { Menu, Plus } from 'lucide-react'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { Mark } from './Mark'

/** Phone: rooms, the mark, and a new room. */
export function PhoneBar() {
  const { state, dispatch } = useStore()
  const actions = useActions()
  const waiting = state.sessions.filter((s) => s.status === 'asking').length

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between bg-ground/95 px-2 backdrop-blur-sm lg:hidden">
      <button type="button" onClick={() => dispatch({ type: 'setSheet', open: true })} className="press relative flex h-11 items-center gap-2 rounded-control px-3 text-chrome font-medium hover:bg-raised">
        <Menu size={18} strokeWidth={2} /> Rooms
        {waiting > 0 && <span className="num grid size-5 place-items-center rounded-full bg-chosen text-small font-semibold text-surface">{waiting}</span>}
      </button>
      <Mark />
      <button type="button" onClick={() => void actions.newRoom()} aria-label="New room" className="press grid size-11 place-items-center rounded-control hover:bg-raised">
        <Plus size={20} strokeWidth={2} />
      </button>
    </header>
  )
}
