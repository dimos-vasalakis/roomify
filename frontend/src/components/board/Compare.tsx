import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { money } from '../../lib/format'
import { EASE_IN_OUT, STAGGER, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { useStore } from '../../state/store'
import type { Product, Session } from '../../types'

type Props = { s: Session; onPin: (p: Product) => void }

const clamp = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Before and after on one frame. Left of the divider is your photo, right of it the render with
 * its pins. The divider is driven by one CSS variable, so dragging never re-renders React.
 * The first time a finished room opens it plays the reveal: scan, wipe, outlines, pins.
 */
export function Compare({ s, onPin }: Props) {
  const { state, dispatch } = useStore()
  const root = useRef<HTMLDivElement>(null)
  const split = useRef(0)
  const dragging = useRef(false)
  // The reveal in progress: a touch or a key ends it at once, so it never fights the person's hand.
  const reveal = useRef<gsap.core.Timeline | null>(null)
  const takeOver = () => {
    reveal.current?.progress(1)
    reveal.current = null
  }
  const placed = s.products.filter((p) => p.placed !== false)
  const selected = state.selectedProductId
  const revealKey = state.reveal?.id === s.id ? state.reveal.key : 0

  const setSplit = (v: number) => {
    split.current = clamp(v)
    root.current?.style.setProperty('--split', String(split.current))
    root.current?.querySelector('[role=slider]')?.setAttribute('aria-valuenow', String(Math.round(split.current * 100)))
  }

  useEffect(() => setSplit(split.current), [])

  useGSAP(
    () => {
      if (!revealKey) return
      const proxy = { v: 1 }
      const apply = () => setSplit(proxy.v)
      const finish = () => dispatch({ type: 'revealDone' })
      if (reducedMotion()) {
        setSplit(0)
        gsap.fromTo('[data-pin]', { opacity: 0 }, { opacity: 1, duration: 0.2, onComplete: finish })
        return
      }
      apply()
      const tl = gsap.timeline({ onComplete: finish })
      reveal.current = tl
      tl.set('[data-outline]', { opacity: 1, clipPath: 'inset(0 100% 0 0)' })
        .set('[data-pin]', { opacity: 0, scale: 0.4 })
        .fromTo('[data-revscan]', { yPercent: -100, opacity: 1 }, { yPercent: 1000, duration: 0.9, ease: 'power1.inOut' })
        .set('[data-revscan]', { opacity: 0 })
        .to(proxy, { v: 0, duration: 1.25, ease: EASE_IN_OUT, onUpdate: apply })
        .to('[data-outline]', { clipPath: 'inset(0 0% 0 0)', duration: 0.45, ease: 'power2.out', stagger: STAGGER }, '-=0.2')
        .to('[data-pin]', { opacity: 1, scale: 1, duration: 0.32, ease: 'back.out(2)', stagger: STAGGER }, '-=0.15')
        .to('[data-outline]', { opacity: 0, duration: 0.5 }, '+=0.9')
      // If frames stall (a hidden tab), land on the finished state.
      const safety = setTimeout(() => tl.progress(1), 6500)
      // Interrupted (unmount, or React's double run in development): land on the finished room, quietly.
      return () => {
        clearTimeout(safety)
        tl.kill()
        setSplit(0)
      }
    },
    { scope: root, dependencies: [revealKey] },
  )

  const fromPointer = (clientX: number) => {
    const r = root.current?.getBoundingClientRect()
    if (r) setSplit((clientX - r.left) / r.width)
  }

  return (
    <div
      ref={root}
      className="absolute inset-0"
      style={{ ['--split' as string]: '0' }}
      onPointerMove={(e) => dragging.current && fromPointer(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => (dragging.current = false)}
    >
      <img src={s.beforeSrc} alt={`Your photo of the ${s.name.toLowerCase()}`} className="absolute inset-0 size-full object-cover" draggable={false} />
      <img
        src={s.afterSrc!}
        alt={`A furnished preview of your ${s.name.toLowerCase()}`}
        className="absolute inset-0 size-full object-cover"
        style={{ clipPath: 'inset(0 0 0 calc(var(--split) * 100%))' }}
        draggable={false}
      />

      <span data-revscan className="pointer-events-none absolute inset-x-0 top-0 h-[10%] opacity-0">
        <span className="block h-full bg-surface/15" />
        <span className="block h-px bg-surface" />
      </span>

      <span className="label pointer-events-none absolute top-4 left-4 rounded-[3px] bg-surface/90 px-1.5 py-0.5 text-ink" style={{ opacity: 'clamp(0, calc((var(--split) - 0.1) * 12), 1)' }}>
        Before
      </span>
      <span className="label pointer-events-none absolute top-4 right-4 rounded-[3px] bg-surface/90 px-1.5 py-0.5 text-ink" style={{ opacity: 'clamp(0, calc((0.9 - var(--split)) * 12), 1)' }}>
        After
      </span>

      {/* Pins live on the after side only. */}
      <div className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 calc(var(--split) * 100%))' }}>
        {placed.map((p) => (
          <span
            key={`o-${p.id}`}
            data-outline
            aria-hidden="true"
            className="pointer-events-none absolute border-[1.5px] border-dashed border-surface opacity-0"
            style={{ left: `${p.box.x * 100}%`, top: `${p.box.y * 100}%`, width: `${p.box.w * 100}%`, height: `${p.box.h * 100}%` }}
          />
        ))}
        {placed.map((p, i) => {
          const on = p.id === selected
          const dim = !!selected && !on
          const at = dotAt(p)
          const flip = at.x > 0.62
          return (
            <button
              key={p.id}
              type="button"
              data-pin
              onClick={(e) => {
                e.stopPropagation()
                onPin(p)
              }}
              aria-label={`${String(i + 1).padStart(2, '0')}, ${p.slot}, ${money(p.priceEur, p.currency ?? s.currency)}`}
              aria-pressed={on}
              className={`group absolute flex -translate-y-1/2 items-center transition-opacity duration-200 ${flip ? '-translate-x-[calc(100%-0.875rem)] flex-row-reverse' : '-translate-x-3.5'} ${dim ? 'opacity-45' : ''}`}
              style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
            >
              {/* A drawing's callout: the piece's number in a circle, its name on a leader line. */}
              <span className={`label grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] shadow-[0_1px_6px_rgb(23_23_23/0.25)] transition-transform duration-200 ease-[var(--ease-out)] group-hover:scale-110 ${on ? 'scale-110 border-surface bg-ink text-surface' : 'border-ink bg-surface text-ink'}`}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className={`flex items-center ${flip ? 'flex-row-reverse' : ''} ${on ? '' : 'max-sm:hidden opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'} transition-opacity duration-150`}>
                <span className="h-[1.5px] w-4 bg-surface shadow-[0_0_2px_rgb(23_23_23/0.5)]" />
                <span className="num rounded-[3px] bg-ink px-1.5 py-0.5 font-mono text-[0.6875rem] whitespace-nowrap text-surface">
                  {p.slot} · {money(p.priceEur, p.currency ?? s.currency)}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* The divider. */}
      <span className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-surface" style={{ left: 'calc(var(--split) * 100%)' }} />
      <button
        type="button"
        role="slider"
        aria-label="Before and after"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        aria-valuetext="Percent of your photo showing"
        onPointerDown={(e) => {
          takeOver()
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          takeOver()
          const step = e.shiftKey ? 0.25 : 0.05
          if (e.key === 'ArrowRight') setSplit(split.current + step)
          else if (e.key === 'ArrowLeft') setSplit(split.current - step)
          else if (e.key === 'Home') setSplit(0)
          else if (e.key === 'End') setSplit(1)
          else return
          e.preventDefault()
        }}
        className="absolute top-1/2 z-20 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none place-items-center rounded-full bg-surface text-ink shadow-[0_2px_10px_rgb(23_23_23/0.2)]"
        style={{ left: 'clamp(1.5rem, calc(var(--split) * 100%), calc(100% - 1.5rem))' }}
      >
        <span className="flex items-center">
          <ChevronLeft size={14} strokeWidth={2.5} />
          <ChevronRight size={14} strokeWidth={2.5} />
        </span>
      </button>
    </div>
  )
}

/** The dot sits on the piece: the point the checker named on its body, or, failing that, high
 * in its box, where a chair's seat or a table's top is, never the empty floor between legs. */
function dotAt(p: Product) {
  return p.anchor ?? { x: p.box.x + p.box.w / 2, y: p.box.y + p.box.h * 0.3 }
}
