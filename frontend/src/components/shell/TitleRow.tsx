import { Columns2, Footprints, X } from 'lucide-react'
import { money } from '../../lib/format'
import { shopsOf, totalOf } from '../../lib/session'
import { useStore } from '../../state/store'

/** The room's name, the one finding, and the two things you do with a finished room. */
export function TitleRow() {
  const { state, active: s, dispatch } = useStore()
  const done = s.status === 'done'
  const total = totalOf(s)
  const shops = shopsOf(s)

  const finding = (() => {
    switch (s.status) {
      case 'done':
        return `${money(total)} of ${money(s.budgetEur)} · ${s.products.length} items from ${shops} ${shops === 1 ? 'shop' : 'shops'} · ${s.city}`
      case 'shopping':
        return `Shopping in ${s.city} · ${money(s.budgetEur)} budget · ${s.products.length} in the basket so far`
      case 'drawing':
        return `Drawing your room with the ${s.products.length} products it chose`
      case 'asking':
        return `${money(s.budgetEur)} budget · ${s.city} · the agent is waiting for one answer`
      case 'failed':
        return `Stopped while drawing · ${s.products.length} products are still in the basket`
      case 'new':
        return 'Add a photo, say what the room needs, set a budget'
    }
  })()

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-4 pb-3 lg:pt-4">
      <div className="min-w-0">
        <h1 className="truncate text-title font-semibold tracking-[-0.01em] text-ink">{s.name}</h1>
        <p className="num mt-0.5 text-chrome text-muted">{finding}</p>
      </div>
      {done && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={state.compare}
            onClick={() => dispatch({ type: 'toggleCompare' })}
            className={`press inline-flex h-control items-center gap-2 rounded-control px-3 text-chrome font-medium transition-colors duration-150 ${state.compare ? 'bg-ink text-surface' : 'bg-secondary text-ink hover:bg-control'}`}
          >
            <Columns2 size={16} strokeWidth={1.75} />
            Compare
          </button>
          <button
            type="button"
            aria-pressed={state.walkMode}
            onClick={() => dispatch({ type: 'setWalkMode', on: !state.walkMode })}
            className="press inline-flex h-control items-center gap-2 rounded-control bg-primary px-3.5 text-chrome font-medium text-surface hover:bg-ink/85"
          >
            {state.walkMode ? <X size={16} strokeWidth={2} /> : <Footprints size={16} strokeWidth={1.75} />}
            {state.walkMode ? 'Cancel walk-in' : 'Walk in'}
            {!state.walkMode && <kbd className="ml-0.5 hidden rounded-[4px] bg-surface/15 px-1.5 text-small font-sans lg:inline">W</kbd>}
          </button>
        </div>
      )}
    </div>
  )
}
