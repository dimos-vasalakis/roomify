import { useRef, useState } from 'react'
import { money } from '../../lib/format'
import { gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { isWorking, totalOf } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { Composer } from './Composer'
import { Thread } from './Thread'

/** A figure that counts to its new value. */
function Count({ value, currency }: { value: number; currency?: string }) {
  const el = useRef<HTMLSpanElement>(null)
  const shown = useRef(value)
  useGSAP(
    () => {
      if (!el.current) return
      if (reducedMotion()) {
        shown.current = value
        el.current.textContent = money(value, currency)
        return
      }
      const proxy = { v: shown.current }
      gsap.to(proxy, {
        v: value,
        duration: 0.7,
        ease: 'power2.out',
        onUpdate: () => {
          shown.current = proxy.v
          if (el.current) el.current.textContent = money(Math.round(proxy.v * 100) / 100, currency)
        },
      })
    },
    { dependencies: [value, currency] },
  )
  return <span ref={el}>{money(shown.current, currency)}</span>
}

const MIN_BUDGET = 20
const MAX_BUDGET = 1_000_000

/** The budget, editable at any time: click it, type, Enter. Escape or a bad number leaves it as it was. */
function Budget({ value, currency, label }: { value: number; currency?: string; label: (v: string) => string }) {
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
        className="press rounded-[6px] px-1 -mx-1 underline decoration-control decoration-dotted underline-offset-4 hover:bg-raised hover:decoration-ink"
      >
        {label(money(value, currency))}
      </button>
    )
  }
  return (
    <span className="relative inline-flex items-center">
      <span className="inline-flex h-8 items-center rounded-control bg-surface pr-1 pl-2 ring-1 ring-ink">
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
          className="num h-full w-20 bg-transparent px-1 text-body font-semibold text-ink focus:outline-none"
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

/** The conversation column: the total against the budget, the conversation, and the composer. */
export function Talk() {
  const { active: s } = useStore()
  const actions = useActions()
  const total = totalOf(s)
  const over = total > s.budgetEur
  const working = isWorking(s)

  return (
    <aside aria-label="Conversation with Roomify" className="flex h-full min-h-0 flex-col">
      {/* One height in every state, so nothing below it moves when the first pieces arrive. */}
      <header className="flex h-[5.75rem] shrink-0 flex-col justify-end border-b border-ink/10 pb-4">
        {s.products.length ? (
          <>
            <p className="num text-[2.25rem] leading-[2.5rem] font-semibold tracking-[-0.03em] text-ink">
              <Count value={total} currency={s.currency} />
              <span className="ml-1.5 text-body font-normal tracking-normal text-muted">
                <Budget value={s.budgetEur} currency={s.currency} label={(v) => `of ${v}`} />
              </span>
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
                <div
                  className={`h-full origin-left rounded-full transition-transform duration-700 ease-[var(--ease-out)] ${over ? 'bg-negative' : 'bg-chosen'}`}
                  style={{ transform: `scaleX(${Math.min(1, total / Math.max(1, s.budgetEur))})` }}
                />
              </div>
              <span className={`num shrink-0 text-small font-medium ${over ? 'text-negative' : 'text-muted'}`}>
                {over ? `${money(total - s.budgetEur, s.currency)} over` : `${money(s.budgetEur - total, s.currency)} left`}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="truncate text-title font-semibold tracking-[-0.015em] text-ink">{s.name}</p>
            <p className="num mt-0.5 text-chrome text-muted">
              {s.status === 'new' ? 'Budget and brief in one sentence' : <Budget value={s.budgetEur} currency={s.currency} label={(v) => `Budget ${v}`} />}
            </p>
          </>
        )}
      </header>

      {/* Over budget is never a dead end: raise the budget, or ask for the same room for less. */}
      {over && !working && (
        <div className="flex flex-wrap items-center gap-1.5 pt-3">
          <button type="button" onClick={() => void actions.fitBudget()} className="press h-8 rounded-control bg-ink px-2.5 text-chrome font-medium text-surface">
            Bring it under {money(s.budgetEur, s.currency)}
          </button>
          <button type="button" onClick={() => actions.setBudget(Math.ceil(total / 10) * 10)} className="press h-8 rounded-control px-2.5 text-chrome font-medium text-ink ring-1 ring-control hover:ring-ink">
            Raise budget to {money(Math.ceil(total / 10) * 10, s.currency)}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:none] data-[scrolled=true]:[mask-image:linear-gradient(to_bottom,transparent,#000_2.5rem)]">
        <Thread />
      </div>

      <div className="pt-3">
        <Composer key={s.id} />
      </div>
    </aside>
  )
}
