import { useRef } from 'react'
import { money, shopName } from '../../lib/format'
import { enter, useGSAP } from '../../lib/motion'
import { isWorking, phaseOf } from '../../lib/session'
import type { Session } from '../../types'

/**
 * The agent's work, drawn on the photo: a scan while it reads the room, the wall it measured,
 * each piece it chose printed as a tag, and a band while it draws. What it turned down lives
 * in the live trace. Tags float in a stack: positions only appear once a render gives real boxes.
 */
export function StepLayer({ s }: { s: Session }) {
  const root = useRef<HTMLDivElement>(null)
  const phase = phaseOf(s)
  const cur = s.currency

  // A new piece rises in.
  useGSAP(
    () => {
      const tags = root.current?.querySelectorAll('[data-tag]')
      if (tags?.length) enter(tags[tags.length - 1], { y: 8 })
    },
    { scope: root, dependencies: [s.products.length] },
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
        <div className={`absolute inset-x-[8%] flex items-center ${isWorking(s) ? 'bottom-6 lg:bottom-[13.5rem]' : 'bottom-6'}`}>
          <span className="h-3 w-0.5 bg-surface" />
          <span className="h-0.5 flex-1 bg-surface" />
          <span className="num mx-2 rounded-[6px] bg-surface px-2 py-0.5 text-chrome font-semibold text-ink">{s.wallCm} cm</span>
          <span className="h-0.5 flex-1 bg-surface" />
          <span className="h-3 w-0.5 bg-surface" />
        </div>
      )}

      {/* What it chose so far, and the last thing it turned down. */}
      {s.products.length > 0 && s.status !== 'done' && (
        <ul className="absolute top-3 left-3 flex max-w-[min(22rem,70%)] flex-col items-start gap-1 sm:top-8 sm:left-8 sm:gap-1.5">
          {s.products.map((p) => (
            <li key={p.id} data-tag className="flex items-center gap-2 rounded-[8px] bg-surface py-1 pr-2.5 pl-2 text-small whitespace-nowrap sm:py-1.5 sm:pr-3 sm:text-chrome">
              <span className="size-2 shrink-0 rounded-full bg-chosen" />
              <span className="font-semibold text-ink">{p.slot}</span>
              <span className="truncate text-muted max-sm:hidden">{shopName(p.retailer)}</span>
              <span className="num ml-auto pl-2 font-semibold text-ink">{money(p.priceEur, p.currency ?? cur)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
