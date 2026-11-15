import { ChevronDown, ScrollText, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { money, shopName } from '../../lib/format'
import { enter, useGSAP } from '../../lib/motion'
import { PHASES, compose, isWorking, linesOf, phaseOf, totalOf } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'
import { LiveDot } from '../common/LiveDot'
import { Composer } from '../talk/Composer'
import { Thread } from '../talk/Thread'
import { PieceRow } from './PieceRow'

const EXAMPLES = ['A desk and a chair for long study days, €400', 'A cosy reading corner, €300', 'Make it a calm bedroom, €600']

/**
 * The right-hand column, drawn like an architect's furniture schedule: every chosen piece with
 * its number on the drawing, shop, size and price, and its own buttons. While the agent works
 * it shows what it is doing; at the foot, its latest word and one line for anything else.
 */
export function Sheet() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const [log, setLog] = useState(false)
  const [turned, setTurned] = useState(false)
  const list = useRef<HTMLOListElement>(null)
  const placed = s.products.filter((p) => p.placed !== false)
  const pieces = [...placed, ...s.products.filter((p) => p.placed === false)]
  const working = isWorking(s)
  const busy = working || !!state.swapping
  const phase = phaseOf(s)
  const step = phase ? PHASES.findIndex((p) => p.id === phase) : -1
  const total = totalOf(s)
  const over = total > s.budgetEur && !working
  const lines = linesOf(s)
  const last = [...lines].reverse().find((l) => l.role === 'agent')
  const fresh = s.status === 'new'
  // The agent's latest word; the question it is waiting on comes first.
  const note = s.status === 'asking' && s.ask ? s.ask.question : last?.text

  // A new piece rises into the schedule.
  useGSAP(
    () => {
      const rows = list.current?.querySelectorAll(':scope > li')
      if (rows?.length) enter(rows[rows.length - 1], { y: 6 })
    },
    { scope: list, dependencies: [pieces.length] },
  )

  return (
    <aside aria-label="Schedule of pieces" className="relative flex min-h-0 flex-col border border-ink/15 bg-ground/80 backdrop-blur-[2px] lg:h-full">
      <header className="flex items-center justify-between border-b border-ink/15 px-3 py-2">
        <span className="label text-ink">{fresh ? 'Brief' : 'Schedule of pieces'}</span>
        <span className="label text-muted">{fresh ? 'Sheet A-01' : `${pieces.length} item${pieces.length === 1 ? '' : 's'}`}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        {fresh ? (
          <div className="px-3 py-5">
            <p className="text-[1.375rem] leading-7 font-semibold tracking-[-0.02em] text-ink">What should this room hold, and for how much?</p>
            <p className="mt-2 text-chrome text-muted">
              One sentence with a budget. Roomify shops real Greek stores, keeps only what fits, and draws it into your photo.
            </p>
            <p className="label mt-5 text-muted">Try</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {EXAMPLES.map((e) => (
                <li key={e}>
                  <button type="button" onClick={() => compose(e)} className="press w-full rounded-[4px] border border-dashed border-ink/25 px-2.5 py-2 text-left text-chrome text-ink hover:border-ink hover:bg-surface">
                    {e}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {working && (
              <div className="border-b border-ink/15 px-3 py-3" aria-live="polite">
                <div className="flex items-center gap-2">
                  <span className="label text-ink">
                    Step {Math.max(1, step + 1)}/4 · {PHASES[Math.max(0, step)].label}
                  </span>
                  <span className="ml-auto flex gap-0.5" aria-hidden="true">
                    {PHASES.map((p, i) => (
                      <span key={p.id} className={`h-1 w-4 ${i < step ? 'bg-chosen' : i === step ? 'bg-ink motion-safe:animate-[breathe_1.6s_ease-in-out_infinite]' : 'bg-ink/15'}`} />
                    ))}
                  </span>
                </div>
                {s.now && (
                  <p className="mt-2 flex items-start gap-2 text-chrome text-ink">
                    <LiveDot className="mt-1.5" />
                    <span>{s.now.text}</span>
                  </p>
                )}
                <p className="label mt-2 text-muted">
                  {s.products.length + s.rejections.length} looked at · {s.rejections.length} turned down · {s.products.length} chosen
                </p>
              </div>
            )}

            {pieces.length > 0 ? (
              <ol ref={list}>
                {pieces.map((p, i) => (
                  <PieceRow
                    key={p.id}
                    n={i + 1}
                    p={p}
                    replacementMiss={s.replacementMiss?.slot === p.slot && s.replacementMiss.current_url === p.url ? s.replacementMiss : undefined}
                    currency={s.currency}
                    busy={busy || !s.offer || !!s.recorded3d}
                    selected={state.selectedProductId === p.id}
                    onSelect={() => dispatch({ type: 'selectProduct', id: state.selectedProductId === p.id ? null : p.id })}
                  />
                ))}
              </ol>
            ) : (
              !working && <p className="px-3 py-6 text-chrome text-muted">No pieces yet.</p>
            )}

            {pieces.length > 0 && (
              <div className="flex items-baseline justify-between border-b border-ink/15 px-3 py-2.5">
                <span className="label text-muted">Total</span>
                <span className={`num font-mono text-body font-medium ${over ? 'text-negative' : 'text-ink'}`}>{money(total, s.currency)}</span>
              </div>
            )}

            {/* Over budget is never a dead end. */}
            {over && (
              <div className="flex flex-wrap gap-1.5 border-b border-ink/15 px-3 py-3">
                <span className="w-full text-chrome text-ink">{money(total - s.budgetEur, s.currency)} over your budget.</span>
                <button type="button" onClick={() => void actions.fitBudget()} className="press h-8 rounded-[4px] bg-ink px-2.5 text-chrome font-medium text-surface">
                  Bring it under {money(s.budgetEur, s.currency)}
                </button>
                <button type="button" onClick={() => actions.setBudget(Math.ceil(total / 10) * 10)} className="press h-8 rounded-[4px] px-2.5 text-chrome font-medium text-ink ring-1 ring-ink/20 hover:ring-ink">
                  Raise budget to {money(Math.ceil(total / 10) * 10, s.currency)}
                </button>
              </div>
            )}

            {/* What the agent turned down, and why: its decisions, not just its picks. */}
            {s.rejections.length > 0 && (
              <div className="border-b border-ink/15">
                <button type="button" onClick={() => setTurned((t) => !t)} aria-expanded={turned} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-surface/60">
                  <span className="label text-muted">Turned down · {s.rejections.length}</span>
                  <ChevronDown size={14} strokeWidth={2} className={`ml-auto text-muted transition-transform ${turned ? 'rotate-180' : ''}`} />
                </button>
                {turned && (
                  <ul className="px-3 pb-3">
                    {s.rejections.slice(-20).map((r) => (
                      <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-dashed border-ink/10 py-1.5">
                        <span className="min-w-0 truncate text-small text-muted line-through decoration-ink/30">{r.title}</span>
                        <span className="num font-mono text-[0.6875rem] text-muted">{r.priceEur ? money(r.priceEur, s.currency) : '—'}</span>
                        <span className="col-span-2 text-small text-ink">
                          {r.reason} <span className="text-muted">· {shopName(r.retailer)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* The agent's latest word, the question it is waiting on, and one line for anything else. */}
      <footer className="border-t border-ink/15 bg-ground px-3 pt-2.5 pb-3">
        {!fresh && note && (
          <div className="mb-2 flex items-start gap-2" aria-live="polite">
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-chosen" />
            <p className="line-clamp-3 flex-1 text-chrome text-ink">{note}</p>
            <button type="button" onClick={() => setLog(true)} className="press inline-flex h-7 shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-small font-medium text-muted hover:bg-raised hover:text-ink" aria-label={`Open the full log, ${lines.length} lines`}>
              <ScrollText size={13} strokeWidth={2} /> Log
            </button>
          </div>
        )}
        {s.status === 'asking' && s.ask && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {s.ask.suggestion ? (
              <button type="button" onClick={() => void actions.answer(Math.round(s.ask!.suggestion!))} className="press num h-8 rounded-[4px] bg-ink px-2.5 font-mono text-chrome text-surface">
                {Math.round(s.ask.suggestion)} {s.ask.unit} looks right
              </button>
            ) : null}
            {s.offer && (
              <button type="button" onClick={() => void actions.talk("Skip, I don't know the size", {}, 'ask')} className="press h-8 rounded-[4px] px-2.5 text-chrome font-medium text-ink ring-1 ring-ink/20 hover:ring-ink">
                Skip, design without it
              </button>
            )}
          </div>
        )}
        <BlockError block="start" className="mb-2" />
        <BlockError block="feed" className="mb-2" />
        <BlockError block="ask" className="mb-2" />
        <BlockError block="swap" className="mb-2" />
        <Composer key={s.id} />
      </footer>

      {log && (
        <div className="absolute inset-0 z-10 flex flex-col bg-ground" role="dialog" aria-label="Log">
          <header className="flex items-center justify-between border-b border-ink/15 px-3 py-2">
            <span className="label text-ink">Log · {lines.length}</span>
            <button type="button" onClick={() => setLog(false)} aria-label="Close the log" className="press grid size-8 place-items-center rounded-[4px] hover:bg-raised">
              <X size={15} strokeWidth={2} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-3">
            <Thread />
          </div>
        </div>
      )}
    </aside>
  )
}
