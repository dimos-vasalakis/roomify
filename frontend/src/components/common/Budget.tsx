import { useState } from 'react'
import { money } from '../../lib/format'
import { useActions } from '../../state/actions'

const MIN_BUDGET = 20
const MAX_BUDGET = 1_000_000

/** The budget, editable at any time: click it, type, Enter. Escape or a bad number leaves it as it was. */
export function Budget({ value, currency, label }: { value: number; currency?: string; label: (v: string) => string }) {
  const actions = useActions()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const save = () => {
    const n = Number(draft.replace(/[^\d.,]/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'))
    if (!draft.trim() || n === value) return setEditing(false)
    if (!Number.isFinite(n) || n < MIN_BUDGET) return setProblem(`A budget starts at ${money(MIN_BUDGET, currency)}.`)
    if (n > MAX_BUDGET) return setProblem('That budget is too big to shop for.')
    actions.setBudget(n)
    setProblem(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(value))
          setProblem(null)
          setEditing(true)
        }}
        title="Change the budget"
        className="press -mx-1 rounded-[4px] px-1 underline decoration-control decoration-dotted underline-offset-4 hover:bg-raised hover:decoration-ink"
      >
        {label(money(value, currency))}
      </button>
    )
  }
  return (
    <span className="relative inline-flex items-center">
      <span className="inline-flex h-7 items-center rounded-[4px] bg-surface pr-1 pl-2 ring-1 ring-ink">
        <span className="text-chrome text-muted">€</span>
        <input
          autoFocus
          aria-label="Budget in euros"
          inputMode="decimal"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value.slice(0, 9))
            setProblem(null)
          }}
          onFocus={(e) => e.target.select()}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setProblem(null)
              setEditing(false)
            }
          }}
          className="num h-full w-20 bg-transparent px-1 font-mono text-chrome font-medium text-ink focus:outline-none"
        />
      </span>
      {problem && (
        <span role="alert" className="absolute top-full left-0 z-10 mt-1 rounded-[6px] bg-ink px-2 py-1 text-small whitespace-nowrap text-surface">
          {problem}
        </span>
      )}
    </span>
  )
}
