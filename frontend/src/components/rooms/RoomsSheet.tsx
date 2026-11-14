import { Plus, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useStore } from '../../state/store'
import { Mark } from '../shell/Mark'
import { HAS_SAMPLES } from '../../data/loadSamples'
import { Credits } from './Credits'
import { SessionList } from './SessionList'

/** Phone: the rooms list as a full-screen sheet. */
export function RoomsSheet() {
  const { state, dispatch } = useStore()
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (state.sheetOpen) dialog.current?.showModal()
    else dialog.current?.close()
  }, [state.sheetOpen])

  return (
    <dialog
      ref={dialog}
      onClose={() => dispatch({ type: 'setSheet', open: false })}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-ground p-0 text-ink backdrop:bg-transparent"
    >
      <div className="flex h-full flex-col px-4">
        <div className="flex h-14 shrink-0 items-center justify-between">
          <Mark />
          <button
            type="button"
            aria-label="Close rooms"
            onClick={() => dispatch({ type: 'setSheet', open: false })}
            className="press grid size-11 place-items-center rounded-control hover:bg-active"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'newRoom' })}
          className="press mb-5 flex h-11 shrink-0 items-center justify-center gap-2 rounded-control bg-primary text-body font-medium text-surface"
        >
          <Plus size={16} strokeWidth={2} /> New room
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <SessionList />
        </div>
        {HAS_SAMPLES && (
          <div className="flex shrink-0 gap-2 py-4 text-small text-muted">
            Sample rooms and prices. <Credits />
          </div>
        )}
      </div>
    </dialog>
  )
}
