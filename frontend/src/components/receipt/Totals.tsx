import { useEffect, useRef, useState } from 'react'
import { money, signedMoney } from '../../lib/format'
import { EASE_OUT, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { shopsOf, totalOf } from '../../lib/session'
import { useStore } from '../../state/store'

/** The answer to the screen's question: the total against the budget. */
export function Totals() {
  const { state, active: s } = useStore()
  const root = useRef<HTMLDivElement>(null)
  const total = totalOf(s)
  const left = Math.round((s.budgetEur - total) * 100) / 100
  const ratio = Math.min(1, total / s.budgetEur)
  const shops = shopsOf(s)
  const [shown, setShown] = useState(total)
  // The count-up only shows while it is really running; otherwise the true total is on screen.
  const [tweening, setTweening] = useState(false)
  const counter = useRef({ v: total })
  const [delta, setDelta] = useState<{ eur: number } | null>(null)

  // Show the change from a swap next to the total for five seconds.
  useEffect(() => {
    const d = state.lastDelta
    if (!d || d.sessionId !== s.id) return
    setDelta({ eur: d.eur })
    const t = setTimeout(() => setDelta(null), 5000)
    return () => clearTimeout(t)
  }, [state.lastDelta, s.id])

  useGSAP(
    () => {
      // A hidden tab gets no animation frames, so a tween would never finish there.
      if (reducedMotion() || document.hidden) {
        gsap.set(counter.current, { v: total })
        gsap.set('[data-fill]', { scaleX: ratio })
        return
      }
      const replaying = state.reveal?.id === s.id
      if (replaying) {
        gsap.set(counter.current, { v: 0 })
        setShown(0)
        setTweening(true)
      }
      if (replaying) gsap.fromTo('[data-fill]', { scaleX: 0 }, { scaleX: ratio, duration: 1, delay: 2.4, ease: EASE_OUT })
      gsap.to(counter.current, {
        delay: replaying ? 2.4 : 0,
        v: total,
        duration: 0.6,
        ease: EASE_OUT,
        onStart: () => setTweening(true),
        onUpdate: () => setShown(Math.round(counter.current.v * 100) / 100),
        onComplete: () => setTweening(false),
        onInterrupt: () => setTweening(false),
      })
      if (!replaying) {
        // Safety net: never leave a half-counted total on screen.
        const t = setTimeout(() => setTweening(false), 1200)
        return () => clearTimeout(t)
      }
      if (!replaying) gsap.to('[data-fill]', { scaleX: ratio, duration: 0.6, ease: EASE_OUT })
      if (replaying) {
        // Safety net: if animation frames stall, land on the true total anyway.
        const fill = root.current?.querySelector('[data-fill]')
        const t = setTimeout(() => {
          setTweening(false)
          if (fill) gsap.set(fill, { scaleX: ratio })
        }, 6500)
        return () => clearTimeout(t)
      }
    },
    { scope: root, dependencies: [total, ratio, s.id, state.reveal?.key] },
  )

  if (s.status === 'new') return null

  return (
    <div ref={root} className="border-t border-rule px-5 pt-4 pb-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-chrome text-muted">In the basket</p>
        {delta && <p className="num text-chrome font-medium text-ink">{signedMoney(delta.eur)} after your swap</p>}
      </div>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className="num text-total font-bold tracking-[-0.02em] text-ink">{money(tweening ? shown : total)}</span>
        <span className="num text-body text-muted">of {money(s.budgetEur)}</span>
      </p>
      <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${Math.round(ratio * 100)}% of the budget used`}>
        <span data-fill className="block h-full origin-left rounded-full bg-chosen" style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <p className="num mt-2.5 flex justify-between text-chrome text-muted">
        <span>
          {s.products.length} {s.products.length === 1 ? 'item' : 'items'} · {shops} {shops === 1 ? 'shop' : 'shops'}
        </span>
        <span className={left < 0 ? 'font-medium text-negative' : 'text-ink'}>{left < 0 ? `${money(-left)} over` : `${money(left)} left`}</span>
      </p>
    </div>
  )
}
