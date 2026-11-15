import { Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { LIVE } from '../../api/config'
import { useAuth } from '../../auth/AuthGate'
import { enter, useGSAP } from '../../lib/motion'
import { statusText } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import type { Session } from '../../types'
import { BlockError } from '../common/BlockError'
import { Mark } from './Mark'
import { Thumb } from './Rail'

const GROUPS: Session['group'][] = ['Today', 'Yesterday', 'Last week', 'Earlier']

/** Every room, grouped by day. A panel over the board on desktop, a full sheet on a phone. */
export function RoomsPanel() {
  const { state, dispatch } = useStore()
  const actions = useActions()
  const { email, signOut } = useAuth()
  const open = state.sidebarOpen || state.sheetOpen
  const panel = useRef<HTMLDivElement>(null)
  const close = () => {
    if (state.sidebarOpen) dispatch({ type: 'toggleSidebar' })
    if (state.sheetOpen) dispatch({ type: 'setSheet', open: false })
  }

  useGSAP(() => void (open && enter(panel.current, { x: -12, duration: 0.22 })), { dependencies: [open] })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close rooms" onClick={close} className="absolute inset-0 bg-scrim/20" />
      <div ref={panel} role="dialog" aria-label="Rooms" className={`absolute inset-y-0 left-0 flex w-full flex-col bg-ground sm:w-panel sm:border-r sm:border-border ${state.railHidden ? '' : 'lg:left-rail'}`}>
        <div className="flex h-16 items-center justify-between px-4">
          <Mark />
          <button type="button" onClick={close} aria-label="Close" className="press grid size-10 place-items-center rounded-control hover:bg-raised">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="px-3">
          <button
            type="button"
            onClick={() => {
              void actions.newRoom()
              close()
            }}
            className="press flex h-11 w-full items-center gap-2 rounded-control bg-primary px-3 text-body font-medium text-surface"
          >
            <Plus size={18} strokeWidth={2} /> New room
          </button>
          <BlockError block="rooms" className="mt-2" />
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {state.roomsLoading && <p className="px-2 py-3 text-chrome text-muted">Loading your rooms…</p>}
          {GROUPS.map((g) => {
            const rooms = state.sessions.filter((s) => s.group === g)
            if (!rooms.length) return null
            return (
              <section key={g} className="mt-3">
                <h2 className="px-2 pb-1 text-small font-semibold text-muted">{g}</h2>
                <ul className="flex flex-col gap-0.5">
                  {rooms.map((s) => {
                    const on = s.id === state.activeId
                    return (
                      <li key={s.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => {
                            dispatch({ type: 'select', id: s.id })
                            close()
                          }}
                          aria-current={on ? 'page' : undefined}
                          className={`flex w-full items-center gap-3 rounded-card p-1.5 pr-10 text-left transition-colors ${on ? 'bg-active' : 'hover:bg-raised'}`}
                        >
                          <Thumb s={s} className="w-16 shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate text-chrome font-semibold text-ink">{s.name}</span>
                            <span className="block truncate text-small text-muted">{statusText(s)}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void actions.deleteRoom(s.id)}
                          aria-label={`Delete ${s.name}`}
                          className="press absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-control text-muted opacity-0 group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100"
                        >
                          <Trash2 size={15} strokeWidth={2} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
        {LIVE && email && (
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <span className="truncate text-chrome text-muted">{email}</span>
            <button type="button" onClick={() => void signOut()} className="press shrink-0 text-chrome font-medium text-ink underline underline-offset-4">
              Log out
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
