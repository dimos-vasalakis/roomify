import { PanelLeft, PanelLeftClose, Plus } from 'lucide-react'
import { useState } from 'react'
import { pictureOf, statusText } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import type { Session } from '../../types'
import { Mark } from './Mark'

/** The state of a room as one small mark on its thumbnail. */
export function StateDot({ s }: { s: Session }) {
  if (s.status === 'shopping' || s.status === 'drawing')
    return <span className="size-2 rounded-full bg-ink ring-2 ring-surface motion-safe:animate-[breathe_1.6s_ease-in-out_infinite]" />
  if (s.status === 'asking') return <span className="size-2 rounded-full bg-chosen ring-2 ring-surface" />
  if (s.status === 'failed') return <span className="size-2 rounded-full bg-negative ring-2 ring-surface" />
  return null
}

export function Thumb({ s, className = '' }: { s: Session; className?: string }) {
  const src = pictureOf(s)
  return (
    <span className={`relative block aspect-[3/2] overflow-hidden rounded-[6px] bg-raised ${className}`}>
      {src && <img src={src} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />}
      <span className="absolute top-1 right-1 flex">
        <StateDot s={s} />
      </span>
    </span>
  )
}

/** Desktop: a thin rail of room thumbnails. Hover shows the name; the mark opens the full list; Ctrl B puts the rail away. */
export function Rail() {
  const { state, dispatch } = useStore()
  const actions = useActions()
  const [tip, setTip] = useState<{ s: Session; top: number } | null>(null)

  return (
    <nav aria-label="Rooms" className="flex h-dvh w-rail flex-col items-center gap-3 py-4">
      <button
        type="button"
        onClick={() => dispatch({ type: 'toggleSidebar' })}
        aria-label="All rooms"
        title="All rooms"
        className="press group relative grid size-10 place-items-center rounded-control hover:bg-raised"
      >
        <span className="transition-opacity group-hover:opacity-0">
          <Mark withName={false} />
        </span>
        <PanelLeft size={18} strokeWidth={2} className="absolute opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      <button
        type="button"
        onClick={() => void actions.newRoom()}
        aria-label="New room"
        title="New room"
        className="press grid size-10 place-items-center rounded-control bg-surface text-ink ring-1 ring-border hover:ring-ink"
      >
        <Plus size={18} strokeWidth={2} />
      </button>
      <span className="h-px w-6 bg-border" />
      <ul className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-visible px-2 [scrollbar-width:none]">
        {state.sessions.map((s) => {
          const on = s.id === state.activeId
          return (
            <li key={s.id} className="group relative">
              <button
                type="button"
                onClick={() => dispatch({ type: 'select', id: s.id })}
                onPointerEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setTip({ s, top: r.top + r.height / 2 })
                }}
                onPointerLeave={() => setTip(null)}
                aria-current={on ? 'page' : undefined}
                aria-label={`${s.name}, ${statusText(s)}`}
                className={`press block w-12 rounded-[8px] p-0.5 transition-shadow duration-200 ${on ? 'ring-2 ring-ink' : 'ring-0 hover:ring-1 hover:ring-control'}`}
              >
                <Thumb s={s} />
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={() => dispatch({ type: 'toggleRail' })}
        aria-label="Hide rooms (Ctrl B)"
        title="Hide rooms (Ctrl B)"
        className="press grid size-10 shrink-0 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
      >
        <PanelLeftClose size={18} strokeWidth={2} />
      </button>
      {tip && (
        <span role="tooltip" className="pointer-events-none fixed left-[4.25rem] z-50 -translate-y-1/2 rounded-control bg-ink px-2.5 py-1.5 text-surface" style={{ top: tip.top }}>
          <span className="block text-chrome font-semibold whitespace-nowrap">{tip.s.name}</span>
          <span className="block text-small whitespace-nowrap text-surface/75">{statusText(tip.s)}</span>
        </span>
      )}
    </nav>
  )
}
