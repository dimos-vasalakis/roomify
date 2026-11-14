import { useRef } from 'react'
import { money, sumEur } from '../../lib/format'
import { DUR, EASE_OUT, FULL, REDUCED, STAGGER, gsap, useGSAP } from '../../lib/motion'

type Line =
  | { kind: 'chosen'; title: string; shop: string; price: number }
  | { kind: 'rejected'; title: string; shop: string; reason: string }

/** Real listings the scraper read on 14 Nov 2026. Shown as an example, never as a customer's room. */
const LINES: Line[] = [
  { kind: 'rejected', title: 'Γραφείο STAUNING 80x160 λευκό', shop: 'JYSK', reason: 'Width 160 cm, your wall is 140 cm' },
  { kind: 'chosen', title: 'Γραφείο LINDVED 48x120 λευκό', shop: 'JYSK', price: 99 },
  { kind: 'chosen', title: 'Καρέκλα γραφείου NIMTOFTE', shop: 'JYSK', price: 45 },
  { kind: 'rejected', title: 'EVEDAL φωτιστικό δαπέδου', shop: 'IKEA', reason: '€329, over what is left of the budget' },
  { kind: 'chosen', title: 'TÅGARP φωτιστικό δαπέδου', shop: 'IKEA', price: 11.59 },
]
const BUDGET = 300

/** The landing page's signature: the agent's feed printing like a till receipt. */
export function ExampleReceipt() {
  const root = useRef<HTMLDivElement>(null)
  const chosen = LINES.filter((l) => l.kind === 'chosen')
  const total = sumEur(chosen.map((l) => l.price))
  const shops = new Set(chosen.map((l) => l.shop)).size

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(FULL, () => {
        const tl = gsap.timeline({ delay: 0.3 })
        gsap.utils.toArray<HTMLElement>('[data-line]').forEach((line) => {
          tl.fromTo(line, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: DUR.base, ease: EASE_OUT, clearProps: 'opacity,transform' })
          const strike = line.querySelector('[data-strike]')
          if (strike) tl.fromTo(strike, { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: EASE_OUT }, '>-0.05')
          tl.to({}, { duration: STAGGER * 4 })
        })
        tl.fromTo('[data-total]', { opacity: 0 }, { opacity: 1, duration: DUR.base, clearProps: 'opacity' })
      })
      mm.add(REDUCED, () => {
        gsap.fromTo('[data-line], [data-total]', { opacity: 0 }, { opacity: 1, duration: DUR.fast, stagger: 0.03, clearProps: 'opacity' })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <div ref={root} className="rounded-panel border border-border bg-surface p-5 sm:p-6" aria-label="Example receipt">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-3">
        <p className="text-body font-medium">Study corner, Athens</p>
        <span className="rounded-full bg-raised px-2.5 py-0.5 text-small font-medium text-muted">Example</span>
      </div>

      <ul className="mt-1">
        {LINES.map((line) => (
          <li key={line.title} data-line className="border-b border-rule py-3 last:border-b-0">
            {line.kind === 'chosen' ? (
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-chosen" />
                <div className="min-w-0 flex-1">
                  <p className="text-body">{line.title}</p>
                  <p className="text-chrome text-muted">{line.shop} · In the basket</p>
                </div>
                <span className="num text-body font-bold">{money(line.price)}</span>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full border border-control" />
                <div className="min-w-0 flex-1">
                  <p className="relative inline text-body text-muted">
                    {line.title}
                    <span data-strike aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px origin-left bg-muted" />
                  </p>
                  <p className="text-chrome text-ink">
                    <span className="sr-only">Rejected: </span>
                    {line.reason}
                  </p>
                  <p className="text-chrome text-muted">{line.shop} · Rejected</p>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div data-total className="mt-2 flex items-baseline justify-between gap-3 border-t border-border pt-4">
        <p className="text-chrome text-muted">
          {chosen.length} in the basket · {shops} shops
        </p>
        <p className="num text-total font-bold">
          {money(total)}
          <span className="text-body font-normal text-muted"> of {money(BUDGET)}</span>
        </p>
      </div>
    </div>
  )
}
