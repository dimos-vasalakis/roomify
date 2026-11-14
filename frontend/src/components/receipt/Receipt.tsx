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
  const looked = s.products.length + s.rejections.length

  return (
    <aside aria-label="Receipt" className="relative min-h-[28rem] rounded-panel border border-border bg-surface xl:min-h-0">
      <div className="flex flex-col xl:absolute xl:inset-0">
        <header className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="text-body font-medium">{s.status === 'new' ? 'Your brief' : 'Receipt'}</h2>
          {looked > 0 && (
            <p className="num text-chrome text-muted">
              {looked} looked at · {s.rejections.length} turned down
            </p>
          )}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
          {s.status === 'new' && <StartForm />}
          {s.status !== 'new' && s.prompt && <p className="text-chrome text-muted">“{s.prompt}”</p>}
          {s.status === 'asking' && <AskCard />}
          {s.now && (s.status === 'shopping' || s.status === 'drawing') && <NowLine text={s.now.text} since={s.now.startedAt} />}
          <BlockError block="feed" />
          <ReceiptLines />
        </div>

        <Totals />
      </div>
    </aside>
  )
}
