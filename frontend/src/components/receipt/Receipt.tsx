import { useEffect, useState } from 'react'
import { clock } from '../../lib/format'
import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'
import { LiveDot } from '../common/LiveDot'
import { AskCard } from './AskCard'
import { ReceiptLines } from './ReceiptLines'
import { StartForm } from './StartForm'
import { Totals } from './Totals'

function NowLine({ text, since }: { text: string; since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex items-start gap-2.5 rounded-card bg-raised px-3 py-2.5" aria-live="polite">
      <LiveDot className="mt-2" />
      <p className="min-w-0 flex-1 text-chrome leading-5 font-medium text-ink">{text}</p>
      <span className="num text-chrome text-muted">{clock(now - since)}</span>
    </div>
  )
}

/** The agent's work, printed like a till receipt as it shops. */
export function Receipt() {
  const { active: s } = useStore()

  return (
    <aside id="shopping-list" aria-label="Receipt" className="relative min-h-[28rem] scroll-mt-4 rounded-panel border border-border bg-surface xl:min-h-0">
      <div className="flex flex-col xl:absolute xl:inset-0">
        <header className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="text-body font-medium">{s.status === 'new' ? 'Your brief' : 'Your shopping list'}</h2>
          {s.status !== 'new' && s.products.length > 0 && (
            <p className="num text-chrome text-muted">
              {s.products.length} {s.products.length === 1 ? 'piece' : 'pieces'}
            </p>
          )}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
          {s.status === 'new' && <StartForm />}
          {s.status !== 'new' && s.prompt && <details className="text-chrome text-muted"><summary className="cursor-pointer hover:text-ink">Design brief</summary><p className="mt-2 leading-6">{s.prompt}</p></details>}
          {s.status === 'asking' && <AskCard />}
          {s.direction && s.status !== 'new' && s.status !== 'done' && <p className="text-body leading-6 text-ink">{s.direction}</p>}
          {!s.offer && s.now && (s.status === 'shopping' || s.status === 'drawing') && <NowLine text={s.now.text} since={s.now.startedAt} />}
          {s.offer && !s.products.length && (s.status === 'shopping' || s.status === 'drawing') && <div className="flex flex-col gap-4" aria-label="Finding your pieces">
            {[0, 1, 2].map((i) => <div key={i} className="flex gap-3" aria-hidden="true"><span className="block h-product w-product shrink-0 rounded-control bg-raised" /><span className="flex flex-1 flex-col gap-2 py-2"><span className="h-4 w-3/4 rounded-control bg-raised" /><span className="h-3 w-1/2 rounded-control bg-raised" /></span></div>)}
            <p className="text-chrome text-muted">Your pieces will appear here as the design comes together.</p>
          </div>}
          <BlockError block="feed" />
          {s.status !== 'new' && <ReceiptLines />}
        </div>

        <Totals />
      </div>
    </aside>
  )
}
