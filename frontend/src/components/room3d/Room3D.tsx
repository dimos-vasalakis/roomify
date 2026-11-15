import { RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { modelOf, roomDepthOf } from '../../lib/depth'
import { money } from '../../lib/format'
import { DUR, EASE_IN_OUT, STAGGER, enter, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { FRONT, createScene, type Piece, type PieceState, type Scene3D, type View } from '../../lib/scene3d'
import { useStore } from '../../state/store'
import type { Session } from '../../types'
import { LiveDot } from '../common/LiveDot'

const ANGLES: { id: string; label: string; view: View }[] = [
  { id: 'front', label: 'Front', view: FRONT },
  { id: 'left', label: 'Left', view: { yaw: -26, pitch: 8, zoom: 0.88 } },
  { id: 'right', label: 'Right', view: { yaw: 26, pitch: 8, zoom: 0.88 } },
  { id: 'above', label: 'Above', view: { yaw: 0, pitch: 40, zoom: 1 } },
]
/** Where the intro swings to: enough angle to show every piece is really in 3D. */
const SWING: View = { yaw: 18, pitch: 10, zoom: 0.92 }
const RESUME_MS = 6000

const cssColor = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Couldn't load the room's picture."))
    img.src = src
  })
}

/**
 * The finished room as a real 3D scene: your own empty room, with a 3D model of each piece made
 * from its shop photo, placed where the preview put it. Drag to walk round it.
 */
export function Room3D({ s }: { s: Session }) {
  const { dispatch } = useStore()
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pins = useRef(new Map<string, HTMLElement>())
  const view = useRef<Scene3D | null>(null)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [stage, setStage] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [angle, setAngle] = useState<string | null>(null)
  const [pieces, setPieces] = useState<Record<string, PieceState>>({})
  const placed = s.products.filter((p) => p.placed !== false)
  const key = JSON.stringify(placed.map((p) => [p.id, p.box, p.thumb?.src]))

  useEffect(() => {
    let alive = true
    let built: Scene3D | null = null
    ;(async () => {
      try {
        const [photo, depth, render] = await Promise.all([
          loadImage(s.beforeSrc),
          roomDepthOf(s.beforeSrc).then(loadImage),
          s.afterSrc ? loadImage(s.afterSrc).catch(() => null) : Promise.resolve(null),
        ])
        if (!alive || !canvas.current) return
        const list: Piece[] = placed.map((p) => ({
          id: p.id,
          slot: p.slot,
          title: p.title,
          box: p.box,
          widthCm: p.widthCm,
          depthCm: p.depthCm,
          heightCm: p.heightCm ?? null,
          model: p.thumb?.src ? modelOf(p.thumb.src) : null,
        }))
        built = createScene(canvas.current, {
          photo,
          depth,
          render,
          pieces: list,
          ground: cssColor('--color-scrim', '#171717'),
          accent: cssColor('--color-chosen-bright', '#8cc5a8'),
          onPins: (pts) => {
            for (const p of pts) {
              const el = pins.current.get(p.id)
              if (!el) continue
              el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
              el.style.visibility = p.visible ? 'visible' : 'hidden'
            }
          },
          onPiece: (id, state) => alive && setPieces((all) => ({ ...all, [id]: state })),
          onUserMove: () => touched(),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the room or its pieces change
  }, [s.beforeSrc, s.afterSrc, key, attempt])

  // The intro: the preview as you know it dissolves into the 3D room, then the camera swings round.
  useGSAP(
    () => {
      const sv = view.current
      if (stage !== 'ready' || !sv) return
      if (reducedMotion()) {
        gsap.set('[data-preview]', { autoAlpha: 0 })
        enter('[data-chrome], [data-pin3d]')
        return
      }
      const tl = gsap.timeline({ onComplete: () => view.current?.setAuto(true) })
      tl.to('[data-preview]', { autoAlpha: 0, duration: 1.1, ease: 'power2.inOut' }, 0.35)
        .add(() => view.current?.aim(SWING), 1.2)
        .fromTo('[data-pin3d]', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.32, ease: 'back.out(2)', stagger: STAGGER, clearProps: 'all' }, 1.6)
        .fromTo('[data-chrome]', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: DUR.base, stagger: STAGGER, ease: EASE_IN_OUT, clearProps: 'all' }, 1.3)
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

  const go = (a: (typeof ANGLES)[number]) => {
    touched(true)
    setAngle(a.id)
    view.current?.aim(a.view)
  }

  const close = () => dispatch({ type: 'view3d', on: false })
  const name = s.name.toLowerCase()
  const modelling = placed.filter((p) => pieces[p.id] === 'modelling')
  const cards = placed.filter((p) => pieces[p.id] === 'card')

  return (
    <div ref={root} className="absolute inset-0 z-30 overflow-hidden bg-scrim" role="region" aria-label={`Your ${name} in 3D`}>
      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label={`The furnished ${name} in 3D. Drag to walk round it, scroll to come closer.`}
        className={`absolute inset-0 size-full cursor-grab touch-none outline-none focus-visible:outline-2 focus-visible:outline-surface active:cursor-grabbing ${stage === 'ready' ? '' : 'invisible'}`}
        onDoubleClick={() => go(ANGLES[0])}
        onClick={(e) => e.stopPropagation()}
      />

      {/* The preview the person just saw, over the scene until it dissolves into it. */}
      {(s.afterSrc ?? s.beforeSrc) && stage !== 'failed' && (
        <img data-preview src={s.afterSrc ?? s.beforeSrc} alt="" className={`pointer-events-none absolute inset-0 size-full object-cover ${stage === 'loading' ? 'opacity-50' : ''}`} draggable={false} />
      )}

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
              className="pointer-events-auto flex -translate-x-2 -translate-y-full items-center gap-1.5 pb-1"
              aria-label={`${p.slot}, ${money(p.priceEur, p.currency ?? s.currency)}, at ${p.retailer}`}
            >
              <span className={`size-4 shrink-0 rounded-full ring-[3px] ring-surface ${pieces[p.id] === 'modelling' ? 'bg-surface/60 motion-safe:animate-[breathe_1.6s_ease-in-out_infinite]' : 'bg-chosen'}`} />
              <span className="num rounded-[6px] bg-surface px-1.5 py-0.5 text-small font-semibold whitespace-nowrap text-ink max-sm:hidden">
                {p.slot} · {money(p.priceEur, p.currency ?? s.currency)}
              </span>
            </a>
          </span>
        ))}

      {stage === 'loading' && (
        <p className="absolute bottom-4 left-3 flex items-center gap-2 rounded-[5px] bg-surface px-2.5 py-1.5 text-chrome font-medium text-ink" aria-live="polite">
          <LiveDot /> Building your room in 3D…
        </p>
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
          <div data-chrome className="pointer-events-none absolute top-3 left-3 max-w-[22rem] rounded-[5px] bg-surface px-2.5 py-1.5 max-sm:hidden">
            <p className="text-chrome font-semibold text-ink">3D view · drag to walk round, scroll to come closer</p>
            <p className="text-small text-muted">Your own room, with a 3D model of each piece made from its shop photo, at its listed size.</p>
          </div>
          {(modelling.length > 0 || cards.length > 0) && (
            <p data-chrome className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-[5px] bg-surface px-2.5 py-1.5 text-chrome text-ink sm:max-w-[55%]" aria-live="polite">
              {modelling.length > 0 ? (
                <>
                  <LiveDot /> Modelling {modelling.map((p) => p.slot.toLowerCase()).join(', ')} in 3D…
                </>
              ) : (
                <>Shown flat: {cards.map((p) => p.slot.toLowerCase()).join(', ')} (no 3D model could be made)</>
              )}
            </p>
          )}
          <div data-chrome role="group" aria-label="Camera angle" className="absolute top-3 left-3 flex gap-1 sm:top-auto sm:right-3 sm:bottom-3 sm:left-auto">
            <div className="flex gap-0.5 rounded-control bg-surface p-0.5 sm:gap-1 sm:p-1">
              {ANGLES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={angle === a.id}
                  onClick={() => go(a)}
                  className={`press h-7 rounded-[6px] px-2 text-small font-medium transition-colors duration-150 sm:h-8 sm:px-3 sm:text-chrome ${angle === a.id ? 'bg-ink text-surface' : 'text-ink hover:bg-raised'}`}
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
