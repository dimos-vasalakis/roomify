import { ArrowLeft, ExternalLink, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Model3DOut } from '../../api/wire'
import { modelOf, objectModelOf, roomShellOf } from '../../lib/depth'
import { money } from '../../lib/format'
import { DUR, EASE_IN_OUT, STAGGER, enter, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { createScene, type Piece, type PieceState, type Scene3D, type ViewName } from '../../lib/scene3d'
import { useStore } from '../../state/store'
import type { Session } from '../../types'
import { LiveDot } from '../common/LiveDot'

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'photo', label: 'Photo' },
  { id: 'front', label: 'Front' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'back', label: 'Back' },
  { id: 'top', label: 'Top' },
]
const RESUME_MS = 7000

const cssColor = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/** A promise whose failure is handled where it is used, and must never surface as unhandled if the scene stops first. */
function quiet<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {})
  return p
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Couldn't load the room's picture."))
    img.src = src
  })
}

/** "the front, back and left": the sides of the product the shop photographed. */
function sidesText(sides: string[]) {
  const names = [...new Set(sides.map((s) => s.replace('-', ' ')))]
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? ''
}

/**
 * The finished room as a real 3D scene to walk all the way round: your room's floor and walls
 * with your photo on them, and a 3D model of each piece made from the shop's own photos of it.
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
  const [angle, setAngle] = useState<ViewName | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [pieces, setPieces] = useState<Record<string, PieceState>>({})
  const [made, setMade] = useState<Record<string, Model3DOut>>({})
  const placed = s.products.filter((p) => p.placed !== false)
  const key = JSON.stringify(placed.map((p) => [p.id, p.box, p.thumb?.src]))

  useEffect(() => {
    let alive = true
    let built: Scene3D | null = null
    ;(async () => {
      try {
        const shell = await roomShellOf(s)
        const [photo, depth, render] = await Promise.all([
          loadImage(shell.photo),
          loadImage(shell.depth),
          s.afterSrc ? loadImage(s.afterSrc).catch(() => null) : Promise.resolve(null),
        ])
        if (!alive || !canvas.current) return
        const list: Piece[] = placed.map((p) => {
          const model = p.thumb?.src ? modelOf(p) : null
          model?.then((m) => alive && setMade((all) => ({ ...all, [p.id]: m }))).catch(() => {})
          return {
            id: p.id,
            slot: p.slot,
            title: p.title,
            box: p.box,
            widthCm: p.widthCm,
            depthCm: p.depthCm,
            heightCm: p.heightCm ?? null,
            photo: p.thumb?.src ?? null,
            model: model ? quiet(model.then((m) => m.glb_url)) : null,
          }
        })
        // What already stands in the room is modelled too, from its cut-out of the picture.
        shell.objects.forEach((obj, i) =>
          list.push({
            id: `room-${i}`,
            slot: obj.name,
            title: obj.name,
            box: obj.box,
            widthCm: null,
            depthCm: null,
            heightCm: null,
            photo: null,
            model: quiet(objectModelOf(obj).then((m) => m.glb_url)),
            existing: true,
            onTop: obj.on_top,
          }),
        )
        // Painting the room from the photo takes a moment: let "Building" show first.
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
        if (!alive || !canvas.current) return
        built = createScene(canvas.current, {
          photo,
          depth,
          geometry: shell.geometry,
          render,
          pieces: list,
          ground: cssColor('--color-scrim', '#171717'),
          paper: cssColor('--color-ground', '#f4f3f1'),
          accent: cssColor('--color-chosen-bright', '#8cc5a8'),
          onPins: (raw) => {
            // Two callouts never sit on each other (a lamp on a desk): the later one steps up.
            const pts = raw.map((p) => ({ ...p }))
            for (let i = 0; i < pts.length; i++)
              for (let j = 0; j < i; j++) {
                if (!pts[i].visible || !pts[j].visible) continue
                if (Math.abs(pts[i].x - pts[j].x) < 30 && Math.abs(pts[i].y - pts[j].y) < 30) pts[i].y = pts[j].y - 32
              }
            for (const p of pts) {
              const el = pins.current.get(p.id)
              if (!el) continue
              el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
              el.style.visibility = p.visible ? 'visible' : 'hidden'
            }
          },
          onPiece: (id, state) => alive && setPieces((all) => ({ ...all, [id]: state })),
          onPick: (id) => alive && pick(id),
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

  // The intro: the preview as you know it dissolves into the 3D room, then the camera rises out
  // of it to show the whole room, and slowly turns round it.
  useGSAP(
    () => {
      if (stage !== 'ready' || !view.current) return
      if (reducedMotion()) {
        gsap.set('[data-preview]', { autoAlpha: 0 })
        view.current.view('front')
        setAngle('front')
        enter('[data-chrome], [data-pin3d]')
        return
      }
      const tl = gsap.timeline({ onComplete: () => view.current?.setAuto(true) })
      tl.to('[data-preview]', { autoAlpha: 0, duration: 1.1, ease: 'power2.inOut' }, 0.35)
        .add(() => {
          view.current?.view('front')
          setAngle('front')
        }, 1.3)
        .fromTo('[data-chrome]', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: DUR.base, stagger: STAGGER, ease: EASE_IN_OUT, clearProps: 'all' }, 1.3)
        .fromTo('[data-pin3d]', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.32, ease: 'back.out(2)', stagger: STAGGER, clearProps: 'all' }, 2.6)
        .add(() => {}, 2.9)
      return () => tl.progress(1).kill()
    },
    { scope: root, dependencies: [stage] },
  )

  /** Someone is steering: stop the slow turn, and pick it up again after a quiet moment. */
  function touched(keepAngle = false) {
    view.current?.setAuto(false)
    if (!keepAngle) setAngle(null)
    clearTimeout(idle.current)
    if (!reducedMotion()) idle.current = setTimeout(() => view.current?.setAuto(true), RESUME_MS)
  }

  function go(id: ViewName) {
    touched(true)
    setFocused(null)
    setAngle(id)
    view.current?.view(id)
  }

  function pick(id: string) {
    touched(true)
    setAngle(null)
    setFocused(id)
    view.current?.focus(id)
  }

  const close = () => dispatch({ type: 'view3d', on: false })
  const name = s.name.toLowerCase()
  const modelling = placed.filter((p) => pieces[p.id] === 'modelling')
  const cards = placed.filter((p) => pieces[p.id] === 'card')
  const piece = placed.find((p) => p.id === focused)
  const pieceModel = piece ? made[piece.id] : undefined

  return (
    <div ref={root} className="absolute inset-0 z-30 overflow-hidden bg-scrim" role="region" aria-label={`Your ${name} in 3D`}>
      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label={`The furnished ${name} in 3D. Drag to turn round it, scroll to come closer, click a piece to see it from every side.`}
        className={`absolute inset-0 size-full cursor-grab touch-none outline-none focus-visible:outline-2 focus-visible:outline-surface active:cursor-grabbing ${stage === 'ready' ? '' : 'invisible'}`}
        onDoubleClick={() => go('front')}
        onClick={(e) => e.stopPropagation()}
      />

      {/* The preview the person just saw, over the scene until it dissolves into it. */}
      {(s.afterSrc ?? s.beforeSrc) && stage !== 'failed' && (
        <img data-preview src={s.afterSrc ?? s.beforeSrc} alt="" className={`pointer-events-none absolute inset-0 size-full object-cover ${stage === 'loading' ? 'opacity-50' : ''}`} draggable={false} />
      )}

      {/* Numbered callouts, the same numbers as the schedule, kept on their pieces as the camera
          moves (the outer span is moved every frame). The name shows on hover, focus or when picked. */}
      {stage === 'ready' &&
        placed.map((p, i) => {
          const on = focused === p.id
          return (
            <span
              key={p.id}
              ref={(el) => void (el ? pins.current.set(p.id, el) : pins.current.delete(p.id))}
              className="pointer-events-none absolute top-0 left-0 will-change-transform"
              style={{ visibility: 'hidden' }}
            >
              <button
                type="button"
                data-pin3d
                onClick={(e) => {
                  e.stopPropagation()
                  pick(p.id)
                }}
                className={`group pointer-events-auto flex -translate-x-3.5 -translate-y-full items-center pb-1 transition-opacity duration-200 ${focused && !on ? 'opacity-40' : ''}`}
                aria-label={`${String(i + 1).padStart(2, '0')}, ${p.slot}, ${money(p.priceEur, p.currency ?? s.currency)}: see it from every side`}
              >
                <span
                  className={`label grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] shadow-[0_1px_6px_rgb(0_0_0/0.35)] ${on ? 'border-surface bg-ink text-surface' : pieces[p.id] === 'modelling' ? 'border-surface/60 bg-surface/70 text-ink motion-safe:animate-[breathe_1.6s_ease-in-out_infinite]' : 'border-ink bg-surface text-ink'}`}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className={`flex items-center transition-opacity duration-150 ${on ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'} max-sm:hidden`}>
                  <span className="h-[1.5px] w-3 bg-surface" />
                  <span className="num rounded-[3px] bg-surface px-1.5 py-0.5 font-mono text-[0.6875rem] whitespace-nowrap text-ink">
                    {p.slot} · {money(p.priceEur, p.currency ?? s.currency)}
                  </span>
                </span>
              </button>
            </span>
          )
        })}

      {stage === 'loading' && (
        <p className="absolute bottom-4 left-3 flex items-center gap-2 rounded-[5px] bg-surface px-2.5 py-1.5 text-chrome font-medium text-ink" aria-live="polite">
          <LiveDot /> Building your room in 3D… the first time takes about a minute
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
          <div data-chrome className="pointer-events-none absolute top-3 left-3 max-w-[24rem] rounded-[5px] bg-surface px-2.5 py-1.5 max-sm:hidden">
            <p className="text-chrome font-semibold text-ink">3D view · drag to turn round, scroll to come closer</p>
            <p className="text-small text-muted">Click a piece to see it from every side. Each is a 3D model made from the shop's own photos, at its listed size.</p>
          </div>

          {piece ? (
            <div data-chrome className="absolute bottom-3 left-3 w-[min(22rem,calc(100%-1.5rem))] rounded-card bg-surface p-3 max-sm:bottom-2 max-sm:left-2 max-sm:w-[calc(100%-1rem)] max-sm:p-2" aria-live="polite">
              <p className="num text-small font-medium text-muted">
                {piece.slot}
                <span className="sm:hidden"> · {money(piece.priceEur, piece.currency ?? s.currency)}</span>
              </p>
              <p className="mt-0.5 line-clamp-2 text-chrome font-semibold text-ink max-sm:hidden">{piece.title}</p>
              <p className="num mt-1 text-chrome text-ink max-sm:hidden">
                {money(piece.priceEur, piece.currency ?? s.currency)} · {piece.retailer}
                {piece.widthCm && piece.depthCm && piece.heightCm ? ` · ${piece.widthCm} × ${piece.depthCm} × ${piece.heightCm} cm` : ''}
              </p>
              <p className="mt-1.5 text-small text-muted max-sm:hidden">
                {pieces[piece.id] === 'modelling'
                  ? "Making its 3D model from the shop's photos…"
                  : pieces[piece.id] === 'card'
                    ? 'No 3D model could be made: shown as the preview drew it.'
                    : pieceModel && pieceModel.views > 1
                      ? `Modelled from ${pieceModel.views} shop photos: the ${sidesText(pieceModel.sides)}.`
                      : "Modelled from the shop's main photo; the sides it doesn't show are the model's best guess."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 max-sm:mt-1.5">
                <button
                  type="button"
                  onClick={() => go('front')}
                  className="press inline-flex h-8 items-center gap-1.5 rounded-control bg-raised px-2.5 text-small font-medium text-ink hover:bg-ground"
                >
                  <ArrowLeft size={14} strokeWidth={2} /> Whole room
                </button>
                <a
                  href={piece.url}
                  target="_blank"
                  rel="noreferrer"
                  className="press inline-flex h-8 items-center gap-1.5 rounded-control bg-primary px-2.5 text-small font-medium text-surface"
                >
                  Open at {piece.retailer} <ExternalLink size={13} strokeWidth={2} />
                </a>
              </div>
            </div>
          ) : (
            (modelling.length > 0 || cards.length > 0) && (
              <p data-chrome className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-[5px] bg-surface px-2.5 py-1.5 text-chrome text-ink max-sm:bottom-14 sm:max-w-[45%]" aria-live="polite">
                {modelling.length > 0 ? (
                  <>
                    <LiveDot /> Modelling {modelling.map((p) => p.slot.toLowerCase()).join(', ')} from the shop's photos…
                  </>
                ) : (
                  <>Shown flat: {cards.map((p) => p.slot.toLowerCase()).join(', ')} (no 3D model could be made)</>
                )}
              </p>
            )
          )}

          <div
            data-chrome
            role="group"
            aria-label="Camera angle"
            className={`absolute right-3 bottom-3 flex gap-1 max-sm:left-3 ${piece ? 'max-sm:hidden' : ''}`}
          >
            <div className="flex w-full gap-0.5 rounded-control bg-surface p-0.5 sm:gap-1 sm:p-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={angle === v.id}
                  onClick={() => go(v.id)}
                  className={`press h-8 flex-1 rounded-[6px] px-2 text-small font-medium transition-colors duration-150 sm:px-3 sm:text-chrome ${angle === v.id ? 'bg-ink text-surface' : 'text-ink hover:bg-raised'}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
