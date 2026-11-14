import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { pictureOf } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import type { Session } from '../../types'
import { StatusLine } from './StatusLine'

const GROUPS: Session['group'][] = ['Today', 'Yesterday', 'Last week', 'Earlier']

function Thumb({ s }: { s: Session }) {
  const pic = pictureOf(s)
  return pic ? (
    <img src={pic} alt="" className="size-full object-cover" draggable={false} />
  ) : (
    <span className="block size-full rounded-[3px] border border-dashed border-control" />
  )
}

/** A room's menu: rename in place, or delete after saying what goes with it. */
function RoomMenu({ s, onRename, onClose }: { s: Session; onRename: () => void; onClose: () => void }) {
  const actions = useActions()
  const [confirm, setConfirm] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute top-full right-1 z-20 mt-1 w-60 rounded-card border border-border bg-surface p-1 shadow-[0_10px_28px_rgb(0_0_0/0.12)]"
    >
      {confirm ? (
        <div className="p-2">
          <p className="text-chrome font-medium text-ink">Delete “{s.name}”?</p>
          <p className="mt-0.5 text-small text-muted">Its photo, basket and walk-ins go too. This can't be undone.</p>
          <div className="mt-3 flex justify-end gap-1.5">
            <button type="button" onClick={onClose} className="press h-8 rounded-control px-2.5 text-chrome font-medium hover:bg-raised">
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                onClose()
                void actions.deleteRoom(s.id)
              }}
              className="press h-8 rounded-control bg-negative px-2.5 text-chrome font-medium text-surface"
            >
              Delete room
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            role="menuitem"
            type="button"
            autoFocus
            onClick={() => {
              onClose()
              onRename()
            }}
            className="flex h-9 w-full items-center rounded-control px-2.5 text-left text-chrome hover:bg-raised"
          >
            Rename
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => setConfirm(true)}
            className="flex h-9 w-full items-center rounded-control px-2.5 text-left text-chrome text-negative hover:bg-raised"
          >
            Delete…
          </button>
        </>
      )}
    </div>
  )
}

function RoomRow({ s }: { s: Session }) {
  const { state, dispatch } = useStore()
  const actions = useActions()
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const active = s.id === state.activeId

  return (
    <li className={`group relative flex items-center rounded-card transition-colors duration-150 ${active ? 'bg-active' : 'hover:bg-active/60'}`}>
      {editing ? (
        <form
          className="grid w-full grid-cols-[3rem_1fr] items-center gap-3 px-2 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            const value = new FormData(e.currentTarget).get('name')
            setEditing(false)
            void actions.renameRoom(s.id, String(value ?? ''))
          }}
        >
          <span className="block h-8 w-12 overflow-hidden rounded-[4px] bg-raised">
            <Thumb s={s} />
          </span>
          <input
            name="name"
            defaultValue={s.name}
            autoFocus
            maxLength={120}
            aria-label="Room name"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            className="h-8 min-w-0 rounded-control border border-ink bg-surface px-2 text-chrome font-medium focus:outline-none"
          />
        </form>
      ) : (
        <button
          type="button"
          aria-current={active || undefined}
          onClick={() => dispatch({ type: 'select', id: s.id })}
          onDoubleClick={() => setEditing(true)}
          className="grid min-w-0 flex-1 grid-cols-[3rem_1fr] items-center gap-3 px-2 py-2 pr-9 text-left"
        >
          <span className="block h-8 w-12 overflow-hidden rounded-[4px] bg-raised">
            <Thumb s={s} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-chrome font-medium text-ink">{s.name}</span>
            <span className="block truncate text-small">
              <StatusLine session={s} />
            </span>
          </span>
        </button>
      )}
      {!editing && (
        <button
          type="button"
          aria-label={`Options for ${s.name}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
          className={`press absolute right-1 grid size-8 place-items-center rounded-control text-muted transition-opacity duration-150 hover:bg-raised hover:text-ink focus-visible:opacity-100 ${menu || active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <MoreHorizontal size={16} strokeWidth={1.75} />
        </button>
      )}
      {menu && <RoomMenu s={s} onRename={() => setEditing(true)} onClose={() => setMenu(false)} />}
    </li>
  )
}

/** Rooms grouped by when they were last touched. Compact = thumbnails only (collapsed rail). */
export function SessionList({ compact = false }: { compact?: boolean }) {
  const { state, dispatch } = useStore()
  const error = state.errors.rooms

  if (state.roomsLoading) {
    return (
      <ul aria-busy="true" aria-label="Loading rooms" className={compact ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-0.5 pt-6'}>
        {[0, 1, 2].map((i) =>
          compact ? (
            <li key={i} className="h-8 w-12 rounded-[4px] bg-raised" />
          ) : (
            <li key={i} className="grid grid-cols-[3rem_1fr] items-center gap-3 px-2 py-2">
              <span className="h-8 w-12 rounded-[4px] bg-raised" />
              <span>
                <span className="block h-3.5 w-32 rounded-[3px] bg-raised" />
                <span className="mt-1.5 block h-3 w-20 rounded-[3px] bg-raised" />
              </span>
            </li>
          ),
        )}
      </ul>
    )
  }

  return (
    <div className={compact ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-5'}>
      {error && !compact && (
        <p role="alert" className="flex gap-2 rounded-card bg-raised px-2.5 py-2 text-small text-ink">
          <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-negative" />
          {error.message}
        </p>
      )}
      {GROUPS.map((group) => {
        const rooms = state.sessions.filter((s) => s.group === group)
        if (!rooms.length) return null
        return (
          <section key={group} aria-label={group} className={compact ? 'contents' : ''}>
            {!compact && <h2 className="mb-1 px-2 text-small text-muted">{group}</h2>}
            <ul className={compact ? 'contents' : 'flex flex-col gap-0.5'}>
              {rooms.map((s) =>
                compact ? (
                  <li key={s.id}>
                    <button
                      type="button"
                      title={s.name}
                      aria-label={s.name}
                      aria-current={s.id === state.activeId || undefined}
                      onClick={() => dispatch({ type: 'select', id: s.id })}
                      className={`press block h-8 w-12 overflow-hidden rounded-[4px] outline-offset-2 ${s.id === state.activeId ? 'outline-2 outline-ink' : 'opacity-80 hover:opacity-100'}`}
                    >
                      <Thumb s={s} />
                    </button>
                  </li>
                ) : (
                  <RoomRow key={s.id} s={s} />
                ),
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
