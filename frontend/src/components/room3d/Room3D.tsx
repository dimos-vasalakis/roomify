import { RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { canView3D, depthOf } from '../../lib/depth'
import { money } from '../../lib/format'
import { DUR, EASE_IN_OUT, STAGGER, enter, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { FRONT, createRoomView, loadImage, type Anchor, type RoomView, type View } from '../../lib/room3d'
import { useStore } from '../../state/store'
import type { Session } from '../../types'
import { LiveDot } from '../common/LiveDot'

const ANGLES: { id: string; label: string; view: View }[] = [
  { id: 'front', label: 'Front', view: FRONT },
  { id: 'left', label: 'Left', view: { yaw: -20, pitch: 5, zoom: 0.9 } },
  { id: 'right', label: 'Right', view: { yaw: 20, pitch: 5, zoom: 0.9 } },
  { id: 'above', label: 'Above', view: { yaw: 0, pitch: 18, zoom: 1.05 } },
]
/** Where the intro swings to: enough angle to show the room is really 3D. */
const SWING: View = { yaw: 15, pitch: 6, zoom: 0.9 }
const RESUME_MS = 5000

function rgb(name: string, fallback: number): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : fallback
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** The finished room in 3D, built from the render and its depth map. Drag to look around. */
export function Room3D({ s }: { s: Session }) {
  const { dispatch } = useStore()
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pins = useRef(new Map<string, HTMLElement>())
  const view = useRef<RoomView | null>(null)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [stage, setStage] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [angle, setAngle] = useState<string | null>(null)
  const src = s.afterSrc
  const placed = s.products.filter((p) => p.placed !== false)
  const anchorKey = JSON.stringify(placed.map((p): Anchor => ({ id: p.id, box: p.box })))

  // Build the room once the render and its depth map are in.
  useEffect(() => {
    if (!canView3D(src)) return
    let alive = true
    let built: RoomView | null = null
    ;(async () => {
      try {
        const [color, depth] = await Promise.all([loadImage(src), depthOf(src).then(loadImage)])
        if (!alive || !canvas.current) return
        built = createRoomView(canvas.current, color, depth, JSON.parse(anchorKey) as Anchor[], {
          accent: rgb('--color-chosen-bright', 0x8cc5a8),
          ground: rgb('--color-scrim', 0x171717),
        })
        built.onFrame((pts) => {
          for (const p of pts) {
            const el = pins.current.get(p.id)
            if (!el) continue
            el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
            el.style.visibility = p.visible ? 'visible' : 'hidden'
          }
        })
        view.current = built
        setStage('ready')
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error && err.message ? err.message : "Couldn't build the room in 3D.")
        setStage('failed')
      }
    })()
    return () => {
      alive = false
      clearTimeout(idle.current)
      built?.dispose()
      view.current = null
    }
  }, [src, anchorKey, attempt])

  // The intro: the render as you know it, a scan line reads its depth near to far, then the camera swings round.
  useGSAP(
    () => {
      const rv = view.current
      if (stage !== 'ready' || !rv) return
      if (reducedMotion()) {
        rv.setFront(-1)
        rv.jump(SWING)
        enter('[data-chrome], [data-pin3d]')
        return
      }
      rv.jump(FRONT)
      const scan = { front: 1.08 }
      const cam = { ...FRONT }
      rv.setFront(scan.front)
      const tl = gsap.timeline({ onComplete: () => view.current?.setAuto(true) })
      tl.to(scan, { front: -0.1, duration: 1.8, ease: 'power1.inOut', onUpdate: () => rv.setFront(scan.front) })
        .to(cam, { ...SWING, duration: 2.2, ease: EASE_IN_OUT, onUpdate: () => rv.jump(cam) }, 1.1)
        .fromTo('[data-pin3d]', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.32, ease: 'back.out(2)', stagger: STAGGER, clearProps: 'all' }, 2.1)
        .fromTo('[data-chrome]', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: DUR.base, stagger: STAGGER, clearProps: 'all' }, 1.6)
      // Interrupted (closed, a new render): land on the finished state, so nothing stays hidden.
      return () => tl.progress(1).kill()
    },
    { scope: root, dependencies: [stage] },
  )

  /** Someone is steering: stop the sway, and pick it up again after a quiet moment. */
  function touched(keepAngle = false) {
    view.current?.setAuto(false)
    if (!keepAngle) setAngle(null)
    clearTimeout(idle.current)
    if (!reducedMotion()) idle.current = setTimeout(() => view.current?.setAuto(true), RESUME_MS)
  }

  // The wheel zooms; it needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      touched()
      view.current?.zoomBy(Math.exp(e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const go = (a: (typeof ANGLES)[number]) => {
    touched(true)
    setAngle(a.id)
    view.current?.aim(a.view)
  }

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    touched()
  }
  const onMove = (e: React.PointerEvent) => {
    const before = pointers.current.get(e.pointerId)
    if (!before) return
    const rv = view.current
    const all = [...pointers.current.values()]
    if (all.length === 2) {
      const other = all.find((p) => p !== before)!
      const was = Math.hypot(before.x - other.x, before.y - other.y)
      const is = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      if (was > 0 && is > 0) rv?.zoomBy(was / is)
    } else {
      rv?.nudge(-(e.clientX - before.x) * 0.22, (e.clientY - before.y) * 0.15)
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    touched()
  }
  const onKey = (e: React.KeyboardEvent) => {
    const rv = view.current
    if (!rv) return
    if (e.key === 'ArrowLeft') rv.nudge(-6, 0)
    else if (e.key === 'ArrowRight') rv.nudge(6, 0)
    else if (e.key === 'ArrowUp') rv.nudge(0, 4)
    else if (e.key === 'ArrowDown') rv.nudge(0, -4)
    else if (e.key === '+' || e.key === '=') rv.zoomBy(0.9)
    else if (e.key === '-') rv.zoomBy(1.1)
    else return
    e.preventDefault()
    touched()
  }

  const close = () => dispatch({ type: 'view3d', on: false })
  const name = s.name.toLowerCase()

  return (
    <div ref={root} className="absolute inset-0 z-30 overflow-hidden bg-scrim" role="region" aria-label={`Your ${name} in 3D`}>
      {stage !== 'ready' && src && (
        <img src={src} alt="" className="absolute inset-0 size-full object-cover opacity-40" draggable={false} />
      )}

      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label={`The furnished ${name} in 3D. Drag or use the arrow keys to look around.`}
        className={`absolute inset-0 size-full cursor-grab touch-none outline-none focus-visible:outline-2 focus-visible:outline-surface active:cursor-grabbing ${stage === 'ready' ? '' : 'invisible'}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => go(ANGLES[0])}
        onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Price pins, kept on their pieces as the camera moves. The outer span is moved every frame. */}
      {stage === 'ready' &&
        placed.map((p) => (
          <span
            key={p.id}
            ref={(el) => void (el ? pins.current.set(p.id, el) : pins.current.delete(p.id))}
            className="pointer-events-none absolute top-0 left-0 will-change-transform"
            style={{ visibility: 'hidden' }}
          >
            <a
              data-pin3d
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="pointer-events-auto flex -translate-x-2 -translate-y-1/2 items-center gap-1.5"
              aria-label={`${p.slot}, ${money(p.priceEur, p.currency ?? s.currency)}, at ${p.retailer}`}
            >
              <span className="size-4 shrink-0 rounded-full bg-chosen ring-[3px] ring-surface" />
              <span className="num rounded-[6px] bg-surface px-1.5 py-0.5 text-small font-semibold whitespace-nowrap text-ink max-sm:hidden">
                {p.slot} · {money(p.priceEur, p.currency ?? s.currency)}
              </span>
            </a>
          </span>
        ))}

      {stage === 'loading' && (
        <>
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[10%] motion-safe:animate-[scan_1.6s_linear_infinite]">
            <span className="block h-full bg-surface/10" />
            <span className="block h-px bg-chosen-bright" />
          </span>
          <p className="absolute bottom-4 left-3 flex items-center gap-2 rounded-[5px] bg-surface px-2.5 py-1.5 text-chrome font-medium text-ink" aria-live="polite">
            <LiveDot /> Reading the depth of your room…
          </p>
        </>
      )}

      {stage === 'failed' && (
        <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-4 py-3 sm:right-auto sm:max-w-md">
          <p role="alert" className="flex min-w-0 items-center gap-2 text-chrome font-semibold text-ink">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-negative" />
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setStage('loading')
              setAttempt((n) => n + 1)
            }}
            className="press inline-flex h-9 items-center gap-1.5 rounded-control bg-primary px-3 text-chrome font-medium text-surface"
          >
            <RotateCcw size={14} strokeWidth={2} /> Try again
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={close}
        aria-label="Close the 3D view (Esc)"
        className="press absolute top-3 right-3 z-10 grid size-9 place-items-center rounded-control bg-surface text-ink hover:bg-raised"
      >
        <X size={16} strokeWidth={1.75} />
      </button>

      {stage === 'ready' && (
        <>
          <div data-chrome className="pointer-events-none absolute top-3 left-3 rounded-[5px] bg-surface px-2.5 py-1.5 max-sm:hidden">
            <p className="text-chrome font-semibold text-ink">3D view · drag to look around</p>
            <p className="text-small text-muted">Built from your preview's depth. Soft patches behind the pieces are filled in, not photographed.</p>
          </div>
          <div data-chrome role="group" aria-label="Camera angle" className="absolute inset-x-3 bottom-3 flex justify-center gap-1 sm:inset-x-auto sm:right-3">
            <div className="flex gap-1 rounded-control bg-surface p-1">
              {ANGLES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={angle === a.id}
                  onClick={() => go(a)}
                  className={`press h-8 rounded-[6px] px-3 text-chrome font-medium transition-colors duration-150 ${angle === a.id ? 'bg-ink text-surface' : 'text-ink hover:bg-raised'}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
