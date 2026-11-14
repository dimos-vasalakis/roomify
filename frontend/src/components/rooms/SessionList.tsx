import { pictureOf } from '../../lib/session'
import { useStore } from '../../state/store'
import type { Session } from '../../types'
import { StatusLine } from './StatusLine'

const GROUPS: Session['group'][] = ['Today', 'Yesterday', 'Last week']

/** Rooms grouped by when they were last touched. Compact = thumbnails only (collapsed rail). */
export function SessionList({ compact = false }: { compact?: boolean }) {
  const { state, dispatch } = useStore()

  return (
    <div className={compact ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-5'}>
      {GROUPS.map((group) => {
        const rooms = state.sessions.filter((s) => s.group === group)
        if (!rooms.length) return null
        return (
          <section key={group} aria-label={group} className={compact ? 'contents' : ''}>
            {!compact && <h2 className="mb-1 px-2 text-small text-muted">{group}</h2>}
            <ul className={compact ? 'contents' : 'flex flex-col gap-0.5'}>
              {rooms.map((s) => {
                const active = s.id === state.activeId
                const pic = pictureOf(s)
                const thumb = pic ? (
                  <img src={pic} alt="" className="size-full object-cover" draggable={false} />
                ) : (
                  <span className="block size-full rounded-[3px] border border-dashed border-control" />
                )
                if (compact) {
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        title={s.name}
                        aria-label={s.name}
                        aria-current={active || undefined}
                        onClick={() => dispatch({ type: 'select', id: s.id })}
                        className={`press block h-8 w-12 overflow-hidden rounded-[4px] outline-offset-2 ${active ? 'outline-2 outline-ink' : 'opacity-80 hover:opacity-100'}`}
                      >
                        {thumb}
                      </button>
                    </li>
                  )
                }
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-current={active || undefined}
                      onClick={() => dispatch({ type: 'select', id: s.id })}
                      className={`group grid w-full grid-cols-[3rem_1fr] items-center gap-3 rounded-card px-2 py-2 text-left transition-colors duration-150 ${active ? 'bg-active' : 'hover:bg-active/60'}`}
                    >
                      <span className="block h-8 w-12 overflow-hidden rounded-[4px] bg-raised">{thumb}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-chrome font-medium text-ink">{s.name}</span>
                        <span className="block truncate text-small">
                          <StatusLine session={s} />
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
