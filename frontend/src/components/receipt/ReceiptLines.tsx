import { ArrowUpRight } from 'lucide-react'
import { useRef } from 'react'
import { money, shopName, size } from '../../lib/format'
import { enter, useGSAP } from '../../lib/motion'
import { useStore } from '../../state/store'
import { Crop } from '../common/Crop'

/** Listing photos and shop links lead; the search history stays available below. */
export function ReceiptLines() {
  const { state, active: s, dispatch } = useStore()
  const list = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    if (state.reveal?.id === s.id) enter('[data-line]', { y: 8, stagger: 0.07 })
  }, { scope: list, dependencies: [state.reveal?.key] })

  return (
    <div ref={list} className="flex flex-col gap-5">
      {s.products.map((p) => (
        <section key={p.id} data-line className="border-b border-rule pb-4 last:border-b-0" aria-label={p.slot}>
          <div className="flex items-start gap-3">
            <a href={p.url} target="_blank" rel="noreferrer" aria-label={`View ${p.title} at ${shopName(p.retailer)}`} className="block w-product shrink-0 overflow-hidden rounded-control bg-surface">
              <Crop src={p.thumb?.src ?? s.afterSrc ?? s.beforeSrc} box={p.thumb ? p.thumb.box : p.box} alt={p.title} className="w-full" />
            </a>
            <div className="min-w-0 flex-1">
              <p className="text-small text-muted">{p.slot}</p>
              <a href={p.url} target="_blank" rel="noreferrer" className="mt-1 block text-chrome leading-5 font-medium text-ink underline-offset-4 hover:underline">{p.title}</a>
              <p className="num mt-1 text-body font-bold text-ink">{money(p.priceEur)}</p>
            </div>
          </div>
          {p.reason && <p className="mt-2 text-chrome leading-5 text-muted">{p.reason}</p>}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-small">
            <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex min-h-control items-center gap-1 font-medium text-ink underline underline-offset-4">View at {shopName(p.retailer)} <ArrowUpRight size={14} strokeWidth={1.75} /></a>
            {p.placed !== false && s.afterSrc && <button type="button" onClick={() => dispatch({ type: 'selectProduct', id: state.selectedProductId === p.id ? null : p.id })} className="press min-h-control text-muted underline-offset-4 hover:text-ink hover:underline max-sm:hidden">See in room</button>}
          </div>
          {(size(p.widthCm, p.depthCm) || p.deliveryText) && <p className="text-small leading-5 text-muted">{[size(p.widthCm, p.depthCm), p.deliveryText].filter(Boolean).join(' · ')}</p>}
        </section>
      ))}
      {s.rejections.length > 0 && <details className="text-small text-muted">
        <summary className="cursor-pointer py-2 hover:text-ink">{s.rejections.length} options passed over</summary>
        <ul className="mt-2 flex flex-col gap-3">
          {s.rejections.map((r) => <li key={r.id}><span className="line-through">{r.title}</span><p className="mt-0.5 text-ink">{r.reason}</p></li>)}
        </ul>
      </details>}
    </div>
  )
}
