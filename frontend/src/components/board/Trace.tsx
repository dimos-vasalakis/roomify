import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EASE_OUT, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { isWorking } from '../../lib/session'
import { stamp, useTrace, type TraceEntry, type TraceKind } from '../../lib/trace'
import type { Session } from '../../types'

gsap.registerPlugin(ScrambleTextPlugin)

/** The axis always shows at least this much time, so the first seconds don't look crowded. */
const MIN_SPAN = 15_000
/** How long the finished trace stays up before it folds away. */
const HOLD = 1800

const TICK: Record<TraceKind, string> = {
  step: 'h-2 bg-surface/60',
  pick: 'h-4 bg-chosen-bright',
  reject: 'h-3 bg-surface/30',
  render: 'h-5 bg-surface',
  done: 'h-5 bg-chosen-bright',
}
const VERB: Record<TraceKind, string> = {
  step: 'text-surface',
  pick: 'text-chosen-bright',
  reject: 'text-on-ink-muted line-through decoration-1',
  render: 'text-surface',
  done: 'text-chosen-bright',
}

function Counter({ label, value }: { label: string; value: number }) {
  const n = useRef<HTMLSpanElement>(null)
  useGSAP(
    () => {
      if (!value || reducedMotion()) return
      gsap.fromTo(n.current, { yPercent: 70, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.35, ease: EASE_OUT })
    },
    { dependencies: [value] },
  )
  return (
    <span className="flex flex-col items-end leading-none">
      <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-on-ink-muted uppercase">{label}</span>
      <span className="mt-1 overflow-hidden">
        <span ref={n} className="num block text-title font-semibold text-surface">
          {String(value).padStart(2, '0')}
        </span>
      </span>
    </span>
  )
}

function Line({ e, age }: { e: TraceEntry; age: number }) {
  const verb = useRef<HTMLSpanElement>(null)
  useGSAP(
    () => {
      if (age !== 0 || reducedMotion()) return
      gsap.to(verb.current, { duration: 0.6, scrambleText: { text: e.verb.toUpperCase(), chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', speed: 0.6, revealDelay: 0.1 } })
    },
    { dependencies: [e.id] },
  )
  return (
    <li className="flex h-5 items-baseline gap-3 text-chrome transition-opacity duration-500" style={{ opacity: [1, 0.62, 0.36][age] ?? 0.2 }}>
      <span className="num w-12 shrink-0 text-on-ink-muted">{stamp(e.t)}</span>
      <span ref={verb} className={`w-16 shrink-0 text-small font-semibold tracking-[0.12em] uppercase ${VERB[e.kind]}`}>
        {e.verb.toUpperCase()}
      </span>
      <span className="truncate text-surface">{e.text}</span>
    </li>
  )
}

/**
 * The agent, live: a running clock, its current action, what it has looked at, turned down
 * and chosen, every action as a tick on a time axis that flows left as the run goes on,
 * and the last three actions as a log that rolls upward. Folds away when the run ends.
 */
export function Trace({ s, inline = false }: { s: Session; inline?: boolean }) {
  const { entries, t0, t1, picked, rejected, looked } = useTrace(s)
  const working = isWorking(s)
  const [shown, setShown] = useState(working)
  const root = useRef<HTMLDivElement>(null)
  const axis = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  const log = useRef<HTMLOListElement>(null)
  const last = entries.at(-1)

  // Up as soon as work starts; folds away a moment after it ends.
  useEffect(() => {
    if (working) return setShown(true)
    if (!shown) return
    // A failure folds away at once, so the error on the room stays clear.
    const t = setTimeout(() => {
      const el = root.current
      if (!el || reducedMotion()) return setShown(false)
      gsap.to(el, { yPercent: inline ? 0 : 110, opacity: 0, duration: 0.45, ease: 'power3.in', onComplete: () => setShown(false) })
    }, s.status === 'failed' ? 0 : HOLD)
    return () => clearTimeout(t)
  }, [working, shown, inline, s.status])

  useGSAP(
    () => {
      if (!shown || !root.current) return
      if (reducedMotion()) return void gsap.fromTo(root.current, { opacity: 0 }, { opacity: 1, duration: 0.2 })
      gsap.fromTo(root.current, { yPercent: inline ? 0 : 110, y: inline ? 12 : 0, opacity: 0 }, { yPercent: 0, y: 0, opacity: 1, duration: 0.6, ease: 'expo.out' })
    },
    { dependencies: [shown] },
  )

  // Every frame: the clock, and each tick's place on an axis that ends at "now".
  useLayoutEffect(() => {
    if (!shown || t0 == null) return
    const tick = () => {
      const now = (t1 ?? Date.now()) - t0
      if (clock.current) clock.current.textContent = stamp(now)
      const el = axis.current
      if (!el) return
      const w = el.clientWidth
      const span = Math.max(MIN_SPAN, now)
      el.querySelectorAll<HTMLElement>('[data-t]').forEach((n) => {
        n.style.transform = `translateX(${(Number(n.dataset.t) / span) * w}px)`
      })
    }
    tick()
    gsap.ticker.add(tick)
    return () => gsap.ticker.remove(tick)
  }, [shown, t0, t1])

  // A new action: its tick grows from the axis, and the log rolls up one line.
  useGSAP(
    () => {
      if (!entries.length || reducedMotion()) return
      const ticks = axis.current?.querySelectorAll('[data-bar]')
      const bar = ticks?.[ticks.length - 1]
      if (bar) gsap.fromTo(bar, { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease: 'back.out(3)' })
      gsap.fromTo(log.current, { y: 20 }, { y: 0, duration: 0.4, ease: EASE_OUT })
    },
    { dependencies: [entries.length] },
  )

  if (!shown) return null
  const lines = entries.slice(-3)

  return (
    <div
      ref={root}
      role="status"
      aria-label="What the agent is doing"
      className={`${inline ? 'relative' : 'absolute inset-x-3 bottom-3 z-20'} overflow-hidden rounded-card bg-ink px-4 pt-3 pb-3 text-surface`}
    >
      <div className="flex items-center gap-4">
        <span className="flex shrink-0 items-center gap-2">
          <span className={`size-2 rounded-full ${working ? 'bg-chosen-bright motion-safe:animate-[breathe_1.2s_ease-in-out_infinite]' : 'bg-surface/50'}`} />
          <span className="text-[0.625rem] font-semibold tracking-[0.16em] text-on-ink-muted uppercase">{working ? 'Live' : last?.verb === 'Stop' ? 'Stopped' : 'Done'}</span>
        </span>
        <span ref={clock} className="num w-[4.5rem] shrink-0 text-title font-semibold tracking-[-0.01em]">
          0:00.0
        </span>
        <span className="min-w-0 flex-1 truncate text-body text-surface max-sm:hidden">{working ? (s.now?.text ?? 'Thinking') : last?.text}</span>
        <span className="ml-auto flex shrink-0 gap-4">
          <span className="max-sm:hidden">
            <Counter label="Looked at" value={looked} />
          </span>
          <Counter label="Turned down" value={rejected} />
          <Counter label="Chosen" value={picked} />
        </span>
      </div>

      {/* The time axis: actions flow left as time passes; "now" is the right edge. */}
      <div className="relative mt-3 mr-3 h-6">
        <span className="absolute inset-x-0 bottom-0 h-px bg-surface/25" />
        {[0.25, 0.5, 0.75].map((f) => (
          <span key={f} className="absolute bottom-0 h-1 w-px bg-surface/25" style={{ left: `${f * 100}%` }} />
        ))}
        <div ref={axis} className="absolute inset-0">
          {entries.map((e) => (
            <span key={e.id} data-t={e.t} className="absolute bottom-0 left-0 flex w-0 justify-center" title={`${stamp(e.t)} ${e.verb}: ${e.text}`}>
              <span data-bar className={`block w-0.5 shrink-0 origin-bottom rounded-full ${TICK[e.kind]}`} />
            </span>
          ))}
        </div>
        <span className="absolute right-[-0.75rem] bottom-0 flex h-full w-3 flex-col items-center">
          <span className={`size-1.5 rounded-full ${working ? 'bg-chosen-bright' : 'bg-surface/60'}`} />
          <span className="w-px flex-1 bg-surface/60" />
        </span>
      </div>

      <div className="mt-2.5 h-[4.25rem] overflow-hidden" aria-live="off">
        <ol ref={log} className="flex h-full flex-col justify-end gap-1">
          {lines.map((e, i) => (
            <Line key={e.id} e={e} age={lines.length - 1 - i} />
          ))}
        </ol>
      </div>
    </div>
  )
}
