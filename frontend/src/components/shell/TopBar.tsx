import { ChevronDown, Plus } from 'lucide-react'
import { money } from '../../lib/format'
import { totalOf } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { Budget } from '../common/Budget'
import { Mark } from './Mark'
import { StateDot, Thumb } from './Thumb'

/**
 * The sheet's title strip: which room this is (and every other room, one tap away), a new
 * room, and the one number that matters, the total against the budget, editable in place.
 */
export function TopBar() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const total = totalOf(s)
  const over = total > s.budgetEur
  const share = Math.min(1, total / Math.max(1, s.budgetEur))
  const others = state.sessions.filter((x) => x.id !== s.id && x.status !== 'done' && x.status !== 'new')

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-ink/15 px-3 sm:gap-5 sm:px-4">
      <span className="max-sm:hidden"><Mark /></span>
      <span className="sm:hidden"><Mark withName={false} /></span>
      <span aria-hidden="true" className="h-6 w-px bg-ink/15 max-sm:hidden" />
      <button
        type="button"
        onClick={() => dispatch({ type: 'toggleSidebar' })}
        aria-label={`Rooms. Open: ${s.name}`}
        className="press group flex min-w-0 items-center gap-2.5 rounded-[6px] py-1 pr-2 pl-1 hover:bg-raised"
      >
        <Thumb s={s} className="w-9 shrink-0 max-sm:hidden" />
        <span className="min-w-0 text-left">
          <span className="label block text-muted max-sm:hidden">Room · {String(state.sessions.findIndex((x) => x.id === s.id) + 1).padStart(2, '0')}</span>
          <span className="block max-w-[8.5rem] truncate text-chrome font-semibold text-ink sm:max-w-[20rem]">{s.name}</span>
        </span>
        <ChevronDown size={14} strokeWidth={2} className="shrink-0 text-muted transition-transform group-hover:translate-y-0.5" />
        {others.length > 0 && (
          <span className="flex items-center gap-1 max-sm:hidden" title={`${others.length} other room${others.length === 1 ? '' : 's'} need you or are working`}>
            {others.slice(0, 3).map((o) => (
              <StateDot key={o.id} s={o} />
            ))}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => void actions.newRoom()}
        className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-chrome font-medium text-ink ring-1 ring-ink/20 hover:ring-ink max-sm:px-2"
      >
        <Plus size={15} strokeWidth={2} /> <span className="max-sm:sr-only">New room</span>
      </button>

      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div className="text-right">
          <span className="label block text-muted max-sm:hidden">Total / budget</span>
          <span className="num block font-mono text-small font-medium whitespace-nowrap text-ink sm:text-chrome">
            <span className={over ? 'text-negative' : ''}>{money(total, s.currency)}</span>
            <span className="text-muted"> / </span>
            <Budget value={s.budgetEur} currency={s.currency} label={(v) => v} />
          </span>
        </div>
        <div className="relative h-8 w-20 shrink-0 max-sm:hidden" aria-hidden="true">
          {/* A scale bar: ticks every quarter, the fill is what is spent. */}
          <span className="absolute inset-x-0 top-1/2 h-px bg-ink/30" />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <span key={t} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-ink/40" style={{ left: `${t * 100}%` }} />
          ))}
          <span
            className={`absolute top-1/2 left-0 h-1.5 origin-left -translate-y-1/2 transition-transform duration-700 ease-[var(--ease-out)] ${over ? 'bg-negative' : 'bg-chosen'}`}
            style={{ width: '100%', transform: `translateY(-50%) scaleX(${share})` }}
          />
        </div>
      </div>
    </header>
  )
}
