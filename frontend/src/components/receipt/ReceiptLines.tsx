import { useRef } from 'react'
import { money, shopName } from '../../lib/format'
import { EASE_OUT, enter, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { slotsOf } from '../../lib/session'
import { useStore } from '../../state/store'
import { Crop } from '../common/Crop'

/** What went in the basket, one row each, and what was turned down, one short line each. */
export function ReceiptLines() {
  const { state, active: s, dispatch } = useStore()
  const list = useRef<HTMLDivElement>(null)
  const count = s.products.length + s.rejections.length
  const live = s.status === 'shopping'
  const replaying = state.reveal?.id === s.id

  // While shopping, a new line prints: it rises in, and a turned-down line's strike draws across.
  useGSAP(
    () => {
      if (!live) return
      const last = list.current?.querySelector('[data-line][data-new="true"]')
      if (!last) return
      enter(last, { y: 10 })
      if (reducedMotion()) return
      const strike = last.querySelector('[data-strike]')
      if (strike) gsap.fromTo(strike, { scaleX: 0 }, { scaleX: 1, duration: 0.42, delay: 0.12, ease: EASE_OUT })
    },
    { scope: list, dependencies: [count] },
  )

  // During the reveal the receipt prints line by line, after the room has landed.
  useGSAP(
    () => {
      const sections = list.current?.querySelectorAll('section')
      if (!replaying || !sections?.length) return
      enter(sections, { y: 8, stagger: 0.09, delay: 2.2 })
      // Safety net: if animation frames stall, show the receipt anyway.
      const t = setTimeout(() => gsap.set(sections, { clearProps: 'opacity,transform' }), 6500)
      return () => clearTimeout(t)
    },
    { scope: list, dependencies: [state.reveal?.key] },
  )

  const newest = live ? s.script?.[(s.cursor ?? 0) - 1] : undefined
  const newestId = newest?.kind === 'chosen' ? newest.product.id : newest?.kind === 'rejected' ? newest.rejection.id : null
  const picture = s.afterSrc ?? s.beforeSrc

  return (
    <div ref={list} className="flex flex-col gap-4">
      {slotsOf(s).map((slot) => {
        const chosen = s.products.filter((p) => p.slot === slot)
        const turned = s.rejections.filter((r) => r.slot === slot)
        return (
          <section key={slot} aria-label={slot}>
            <h3 className="mb-1 text-small text-muted">{slot}</h3>
            <ul className="flex flex-col gap-1">
              {chosen.map((p) => {
                const on = p.id === state.selectedProductId
                return (
                  <li key={p.id} data-line data-new={p.id === newestId}>
                    <button
                      type="button"
                      disabled={s.status !== 'done'}
                      onClick={() => dispatch({ type: 'selectProduct', id: on ? null : p.id })}
                      className={`-mx-2 grid w-[calc(100%+1rem)] grid-cols-[2.75rem_1fr_auto] items-center gap-x-3 rounded-card p-2 text-left transition-colors duration-150 enabled:hover:bg-raised ${on ? 'bg-raised' : ''}`}
                    >
                      <span className="relative block overflow-hidden rounded-[6px]">
                        {picture || p.thumb ? (
                          <Crop src={p.thumb?.src ?? picture} box={p.thumb ? p.thumb.box : p.box} alt="" className="w-11" />
                        ) : (
                          <span className="block aspect-[4/3] w-11 bg-raised" />
                        )}
                        <span aria-hidden="true" className="absolute top-1 left-1 size-2 rounded-full bg-chosen ring-2 ring-surface" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-chrome leading-5 font-medium text-ink">{p.title}</span>
                        <span className="block truncate text-small text-muted">
                          {[shopName(p.retailer), p.deliveryText].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="num text-chrome font-bold text-ink">{money(p.priceEur)}</span>
                    </button>
                  </li>
                )
              })}
              {turned.map((r) => (
                <li key={r.id} data-line data-new={r.id === newestId} className="flex gap-2 py-0.5 pl-0.5 text-small leading-5 text-muted">
                  <span aria-hidden="true" className="mt-[0.45rem] h-px w-2.5 shrink-0 bg-control" />
                  <span className="min-w-0">
                    <span className="sr-only">Turned down: </span>
                    <span className="relative">
                      {r.title}
                      <span data-strike aria-hidden="true" className="absolute top-1/2 left-0 h-px w-full origin-left bg-muted" />
                    </span>
                    {' · '}
                    <span className="text-ink/75">{r.reason}</span>
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
