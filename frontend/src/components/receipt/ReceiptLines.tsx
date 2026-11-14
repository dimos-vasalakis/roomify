import { useRef } from 'react'
import { money, shopName, size } from '../../lib/format'
import { DUR, EASE_OUT, enter, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { slotsOf } from '../../lib/session'
import { useStore } from '../../state/store'

/** One section per thing the room needs: what went in the basket, and what was turned down and why. */
export function ReceiptLines() {
  const { state, active: s, dispatch } = useStore()
  const list = useRef<HTMLDivElement>(null)
  const count = s.products.length + s.rejections.length
  const live = s.status === 'shopping'

  // A new line prints: it rises in, and a rejected line's strike draws left to right.
  useGSAP(
    () => {
      if (!live) return
      const last = list.current?.querySelector('[data-line][data-new="true"]')
      if (!last) return
      enter(last, { y: 10 })
      if (reducedMotion()) return
      const strike = last.querySelector('[data-strike]')
      if (strike) gsap.fromTo(strike, { scaleX: 0 }, { scaleX: 1, duration: 0.42, delay: 0.12, ease: EASE_OUT })
      const reason = last.querySelector('[data-reason]')
      if (reason) gsap.fromTo(reason, { opacity: 0 }, { opacity: 1, duration: DUR.base, delay: 0.3, clearProps: 'opacity' })
    },
    { scope: list, dependencies: [count] },
  )

  const newest = live
    ? s.script?.[(s.cursor ?? 0) - 1]
    : undefined
  const newestId = newest?.kind === 'chosen' ? newest.product.id : newest?.kind === 'rejected' ? newest.rejection.id : null

  return (
    <div ref={list} className="flex flex-col gap-5">
      {slotsOf(s).map((slot) => {
        const chosen = s.products.filter((p) => p.slot === slot)
        const turned = s.rejections.filter((r) => r.slot === slot)
        return (
          <section key={slot} aria-label={slot}>
            <h3 className="mb-1.5 text-small text-muted">{slot}</h3>
            <ul className="flex flex-col gap-2.5">
              {chosen.map((p) => {
                const on = p.id === state.selectedProductId
                const dims = size(p.widthCm, p.depthCm)
                return (
                  <li key={p.id} data-line data-new={p.id === newestId}>
                    <button
                      type="button"
                      disabled={s.status !== 'done'}
                      onClick={() => dispatch({ type: 'selectProduct', id: on ? null : p.id })}
                      className={`-mx-2 grid w-[calc(100%+1rem)] grid-cols-[0.5rem_1fr_auto] items-baseline gap-x-2.5 rounded-control px-2 py-1 text-left transition-colors duration-150 enabled:hover:bg-raised ${on ? 'bg-raised' : ''}`}
                    >
                      <span aria-hidden="true" className="size-2 translate-y-[-1px] rounded-full bg-chosen" />
                      <span className="min-w-0 text-body leading-6 font-medium text-ink">{p.title}</span>
                      <span className="num text-body font-bold text-ink">{money(p.priceEur)}</span>
                      <span />
                      <span className="col-span-2 text-chrome text-muted">
                        {[shopName(p.retailer), dims, p.deliveryText].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                )
              })}
              {turned.map((r) => (
                <li key={r.id} data-line data-new={r.id === newestId} className="grid grid-cols-[0.5rem_1fr_auto] items-baseline gap-x-2.5">
                  <span aria-hidden="true" className="size-2 translate-y-[-1px] rounded-full border border-control" />
                  <span className="relative min-w-0 text-chrome text-muted">
                    <span className="sr-only">Rejected: </span>
                    {r.title}
                    <span className="text-muted"> · {shopName(r.retailer)}</span>
                    <span data-strike aria-hidden="true" className="absolute top-1/2 left-0 h-px w-full origin-left bg-muted" />
                  </span>
                  <span className="num relative text-chrome text-muted">
                    {r.priceEur === null ? 'No price' : money(r.priceEur)}
                  </span>
                  <span />
                  <span data-reason className="col-span-2 mt-0.5 text-chrome text-ink">
                    {r.reason}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
