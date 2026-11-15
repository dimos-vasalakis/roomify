import { useRef } from 'react'
import { money } from '../../lib/format'
import { gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { totalOf } from '../../lib/session'
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

/** The conversation column: the total against the budget, the conversation, and the composer. */
export function Talk() {
  const { active: s } = useStore()
  const total = totalOf(s)
  const over = total > s.budgetEur

  return (
    <aside aria-label="Conversation with Roomify" className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-ink/10 pt-1 pb-4">
        {s.products.length ? (
          <div className="min-w-0 flex-1">
            <p className="num text-[2.25rem] leading-[2.5rem] font-semibold tracking-[-0.03em] text-ink">
              <Count value={total} currency={s.currency} />
              <span className="ml-1.5 text-body font-normal tracking-normal text-muted">of {money(s.budgetEur, s.currency)}</span>
            </p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
              <div
                className={`h-full origin-left rounded-full transition-transform duration-700 ease-[var(--ease-out)] ${over ? 'bg-negative' : 'bg-chosen'}`}
                style={{ transform: `scaleX(${Math.min(1, total / Math.max(1, s.budgetEur))})` }}
              />
            </div>
            {over && <p className="mt-1.5 text-chrome text-ink">Over budget by {money(total - s.budgetEur, s.currency)}</p>}
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-title font-semibold tracking-[-0.015em] text-ink">{s.name}</p>
            <p className="num mt-0.5 text-chrome text-muted">{s.status === 'new' ? 'Budget and brief in one sentence' : `Budget ${money(s.budgetEur, s.currency)}`}</p>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-6 pr-1 [mask-image:linear-gradient(to_bottom,transparent,#000_3rem)] [scrollbar-width:none]">
        <Thread />
      </div>

      <div className="pt-3">
        <Composer key={s.id} />
      </div>
    </aside>
  )
}
