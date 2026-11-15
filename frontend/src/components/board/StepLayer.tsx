import { useRef } from 'react'
import { money, shopName } from '../../lib/format'
import { enter, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { phaseOf } from '../../lib/session'
import type { Session } from '../../types'

/**
 * The agent's work, drawn on the photo: a scan while it reads the room, the wall it measured,
 * each piece it chose printed as a tag, the last one it turned down struck through, and a band
 * while it draws. Tags float in a stack: positions only appear once a render gives real boxes.
 */
export function StepLayer({ s }: { s: Session }) {
  const root = useRef<HTMLDivElement>(null)
  const phase = phaseOf(s)
  const lastRejection = s.rejections.at(-1)
  const cur = s.currency

  // A new piece rises in.
  useGSAP(
    () => {
      const tags = root.current?.querySelectorAll('[data-tag]')
      if (tags?.length) enter(tags[tags.length - 1], { y: 8 })
    },
    { scope: root, dependencies: [s.products.length] },
  )

  // A turned-down piece prints, gets struck through, then fades away.
  useGSAP(
    () => {
      if (!lastRejection) return
      const el = '[data-rejected]'
      if (reducedMotion()) {
        gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.16 })
        gsap.set('[data-strike]', { scaleX: 1 })
        return
      }
      gsap
        .timeline()
        .fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.24, ease: 'power3.out' })
        .fromTo('[data-strike]', { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: 'power2.inOut' }, '+=0.35')
        .to(el, { opacity: 0.0, duration: 0.5, ease: 'power1.in' }, '+=1.8')
    },
    { scope: root, dependencies: [lastRejection?.id], revertOnUpdate: true },
  )

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {/* Corner ticks frame the photo while the agent works on it. */}
      {phase && (
        <>
          <span className="absolute top-4 left-4 size-4 border-t-2 border-l-2 border-surface" />
          <span className="absolute top-4 right-4 size-4 border-t-2 border-r-2 border-surface" />
          <span className="absolute bottom-4 left-4 size-4 border-b-2 border-l-2 border-surface" />
          <span className="absolute right-4 bottom-4 size-4 border-r-2 border-b-2 border-surface" />
        </>
      )}

      {phase === 'planning' && (
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-[10%] motion-safe:animate-[scan_2.4s_var(--ease-in-out)_infinite]">
            <div className="h-full bg-surface/15" />
            <div className="h-px bg-surface" />
          </div>
        </div>
      )}

      {(phase === 'rendering' || phase === 'checking') && (
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-1/4 bg-surface/20 motion-safe:animate-[sweep_2s_var(--ease-in-out)_infinite]">
            <div className="absolute inset-y-0 right-0 w-px bg-surface" />
          </div>
        </div>
      )}

      {/* The wall the agent measured, drawn like an architect's dimension line. */}
      {s.wallCm && s.status !== 'done' && s.status !== 'failed' && (
        <div className="absolute inset-x-[8%] bottom-6 flex items-center">
          <span className="h-3 w-0.5 bg-surface" />
          <span className="h-0.5 flex-1 bg-surface" />
          <span className="num mx-2 rounded-[6px] bg-surface px-2 py-0.5 text-chrome font-semibold text-ink">{s.wallCm} cm</span>
          <span className="h-0.5 flex-1 bg-surface" />
          <span className="h-3 w-0.5 bg-surface" />
        </div>
      )}

      {/* What it chose so far, and the last thing it turned down. */}
      {(s.products.length > 0 || lastRejection) && s.status !== 'done' && (
        <ul className="absolute top-8 left-8 flex max-w-[min(22rem,60%)] flex-col items-start gap-1.5">
          {s.products.map((p) => (
            <li key={p.id} data-tag className="flex items-center gap-2 rounded-[8px] bg-surface py-1.5 pr-3 pl-2 text-chrome">
              <span className="size-2 shrink-0 rounded-full bg-chosen" />
              <span className="font-semibold text-ink">{p.slot}</span>
              <span className="truncate text-muted">{shopName(p.retailer)}</span>
              <span className="num ml-auto pl-2 font-semibold text-ink">{money(p.priceEur, p.currency ?? cur)}</span>
            </li>
          ))}
          {lastRejection && (
            <li key={lastRejection.id} data-rejected className="max-w-full rounded-[8px] bg-surface/90 py-1.5 pr-3 pl-2 text-chrome">
              <span className="relative flex items-center gap-2 text-muted">
                <span className="size-2 shrink-0 rounded-full ring-1 ring-muted" />
                <span className="truncate">
                  {lastRejection.slot} · {shopName(lastRejection.retailer)}
                </span>
                <span data-strike className="absolute inset-x-0 top-1/2 h-px origin-left bg-ink" />
              </span>
              <span className="mt-0.5 block truncate pl-4 text-small text-ink">{lastRejection.reason}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
