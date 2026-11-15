import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../state/store'
import type { Measure, Session } from '../../types'

type Pt = { x: number; y: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Dimension lines on the room photo, drawn by the person: two clicks on the ends of something
 * they know the length of, then its size and what it is. A line called a wall sets the wall; one
 * named after a piece ("desk") is that piece's widest allowed size when the agent shops.
 */
export function MeasureLayer({ s }: { s: Session }) {
  const { state, dispatch } = useStore()
  const on = state.measuring
  const layer = useRef<HTMLDivElement>(null)
  const [a, setA] = useState<Pt | null>(null)
  const [b, setB] = useState<Pt | null>(null)
  const [hover, setHover] = useState<Pt | null>(null)
  const measures = s.measures ?? []

  const reset = () => {
    setA(null)
    setB(null)
    setHover(null)
  }
  useEffect(reset, [on, s.id])
  useEffect(() => {
    if (!on) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (a) reset()
      else dispatch({ type: 'measuring', on: false })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [on, a, dispatch])

  if (!on && (!measures.length || s.status !== 'new')) return null

  const at = (e: React.PointerEvent): Pt => {
    const r = layer.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }
  }
  const save = (cm: number, label: string) => {
    if (!a || !b) return
    const next: Measure = { id: crypto.randomUUID(), a, b, cm, label }
    const wall = WALL.test(label.trim()) ? { wallCm: cm } : {}
    dispatch({ type: 'patchRoom', id: s.id, patch: { measures: [...measures, next].slice(-12), ...wall } })
    reset()
  }
  const remove = (id: string) => dispatch({ type: 'patchRoom', id: s.id, patch: { measures: measures.filter((m) => m.id !== id) } })
  const end = b ?? hover
  // Belt and braces: a clipped frame that got scrolled anyway is put back.
  const unscroll = () => {
    const frame = layer.current?.parentElement
    if (frame && (frame.scrollTop || frame.scrollLeft)) frame.scrollTo(0, 0)
  }

  return (
    <div
      ref={layer}
      className={`absolute inset-0 z-[25] ${on ? (b ? '' : 'cursor-crosshair') : 'pointer-events-none'}`}
      onClick={(e) => e.stopPropagation()}
      onFocus={unscroll}
      onBlur={unscroll}
      onPointerMove={(e) => on && a && !b && setHover(at(e))}
      onPointerDown={(e) => {
        if (!on || b || (e.target as HTMLElement).closest('[data-keep]')) return
        if (!a) setA(at(e))
        else setB(at(e))
      }}
    >
      {on && <div aria-hidden="true" className="absolute inset-0 bg-ink/25" />}

      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
        {measures.map((m) => (
          <Dimension key={m.id} a={m.a} b={m.b} />
        ))}
        {a && end && <Dimension a={a} b={end} live />}
        {a && !end && <circle cx={`${a.x * 100}%`} cy={`${a.y * 100}%`} r="5" className="fill-surface stroke-ink" strokeWidth="1.5" />}
      </svg>

      {measures.map((m) => (
        <span
          key={m.id}
          data-keep
          className="num absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-[3px] bg-ink py-0.5 pr-1 pl-1.5 font-mono text-[0.6875rem] whitespace-nowrap text-surface"
          style={{ left: `${((m.a.x + m.b.x) / 2) * 100}%`, top: `${((m.a.y + m.b.y) / 2) * 100}%` }}
        >
          {m.label} · {m.cm} cm
          {on && (
            <button type="button" onClick={() => remove(m.id)} aria-label={`Remove the ${m.label} measurement`} className="grid size-4 place-items-center rounded-[2px] hover:bg-surface/20">
              <X size={11} strokeWidth={2.25} />
            </button>
          )}
        </span>
      ))}

      {on && (
        <div data-keep className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-[4px] bg-surface px-3 py-2 sm:right-auto">
          <p className="text-chrome text-ink">
            {!a ? 'Click one end of something you know the length of.' : !b ? 'Now click the other end.' : 'How long is it, and what is it?'}
          </p>
          <button type="button" onClick={() => dispatch({ type: 'measuring', on: false })} className="press ml-auto h-7 shrink-0 rounded-[4px] bg-ink px-2.5 text-small font-medium text-surface">
            Done
          </button>
        </div>
      )}

      {on && a && b && <Ask a={a} b={b} slots={s.products.map((p) => p.slot)} onSave={save} onCancel={reset} />}
    </div>
  )
}

/** An architect's dimension line: a thin line between two end ticks, readable on any photo. */
function Dimension({ a, b, live = false }: { a: Pt; b: Pt; live?: boolean }) {
  const p = (v: Pt) => ({ x: `${v.x * 100}%`, y: `${v.y * 100}%` })
  const [pa, pb] = [p(a), p(b)]
  return (
    <g>
      <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="stroke-ink/60" strokeWidth="4" strokeLinecap="round" />
      <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="stroke-surface" strokeWidth="1.75" strokeDasharray={live ? '5 4' : undefined} />
      {[pa, pb].map((v, i) => (
        <circle key={i} cx={v.x} cy={v.y} r="4" className="fill-surface stroke-ink" strokeWidth="1.5" />
      ))}
    </g>
  )
}

const SUGGESTIONS = ['Wall', 'Window', 'Door']
/** Just a wall ("Back wall"), never a piece named after one ("Space for the wall art"). Same rule as the back end. */
const WALL = /^(?:(?:the|back|side|left|right|front|main|long|short|far|this|my|whole|window|bed)\s+)*(?:wall|τοίχος)$/i

function Ask({ a, b, slots, onSave, onCancel }: { a: Pt; b: Pt; slots: string[]; onSave: (cm: number, label: string) => void; onCancel: () => void }) {
  const [cm, setCm] = useState('')
  const first = useRef<HTMLInputElement>(null)
  // Focus without scrolling: the picture's frame clips, and a scroll there would shift the room.
  useEffect(() => first.current?.focus({ preventScroll: true }), [])
  const [label, setLabel] = useState('')
  const value = Number(cm.replace(',', '.'))
  const ok = Number.isFinite(value) && value >= 5 && value <= 3000 && label.trim().length > 0
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const chips = [...new Set([...SUGGESTIONS, ...slots.map((x) => `Space for the ${x.toLowerCase().replace(/\s+\d+$/, '')}`)])].slice(0, 6)
  // On a phone the picture is too small to hold the form: it rises from the foot of the screen.
  const narrow = window.matchMedia('(max-width: 639px)').matches
  const form = (
    <form
      data-keep
      className={`rounded-[4px] bg-surface p-2.5 shadow-[0_4px_24px_rgb(23_23_23/0.25)] ring-1 ring-ink/20 ${narrow ? 'fixed inset-x-3 bottom-3 z-50' : 'absolute w-[min(19rem,calc(100%-1.5rem))]'}`}
      style={narrow ? undefined : { left: `clamp(0.75rem, calc(${mid.x * 100}% - 9.5rem), calc(100% - min(19rem, 100% - 1.5rem) - 0.75rem))`, top: mid.y > 0.55 ? undefined : `calc(${mid.y * 100}% + 1rem)`, bottom: mid.y > 0.55 ? `calc(${(1 - mid.y) * 100}% + 1rem)` : undefined }}
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onSave(Math.round(value), label.trim().slice(0, 60))
      }}
    >
      <div className="flex gap-1.5">
        <label className="flex h-8 w-24 shrink-0 items-center rounded-[4px] px-2 ring-1 ring-ink/20 focus-within:ring-ink">
          <input ref={first} inputMode="decimal" value={cm} onChange={(e) => setCm(e.target.value)} aria-label="Length in centimetres" placeholder="140" className="num w-full min-w-0 bg-transparent font-mono text-chrome text-ink placeholder:text-muted focus:outline-none" />
          <span className="text-small text-muted">cm</span>
        </label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="What it is" placeholder="What is it?" maxLength={60} className="h-8 min-w-0 flex-1 rounded-[4px] px-2 text-chrome text-ink ring-1 ring-ink/20 placeholder:text-muted focus:ring-ink focus:outline-none" />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {chips.map((c) => (
          <button key={c} type="button" onClick={() => setLabel(c)} className={`press h-6 rounded-[3px] px-1.5 text-small ${label === c ? 'bg-ink text-surface' : 'bg-raised text-ink hover:bg-active'}`}>
            {c}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-small text-muted">A wall sets the wall. “Space for the desk” keeps every desk the agent picks within it.</p>
      <div className="mt-2 flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="press h-8 rounded-[4px] px-2.5 text-chrome font-medium text-ink hover:bg-raised">
          Redraw
        </button>
        <button type="submit" disabled={!ok} className="press h-8 rounded-[4px] bg-ink px-3 text-chrome font-medium text-surface disabled:opacity-40">
          Add measurement
        </button>
      </div>
    </form>
  )
  return narrow ? createPortal(form, document.body) : form
}
