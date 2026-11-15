import { ArrowLeft, ExternalLink, Maximize2, Minimize2, Minus, Pause, Play, Plus, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Model3DOut } from '../../api/wire'
import { modelOf, objectModelOf, roomShellOf, surroundOf } from '../../lib/depth'
import { money } from '../../lib/format'
import { enter, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { createScene, type Piece, type PieceState, type Scene3D, type ViewName } from '../../lib/scene3d'
import { useStore } from '../../state/store'
import type { Session } from '../../types'
import { LiveDot } from '../common/LiveDot'

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'photo', label: 'Photo' }, { id: 'front', label: 'Front' },
  { id: 'left', label: 'Left' }, { id: 'right', label: 'Right' },
  { id: 'back', label: 'Back' }, { id: 'top', label: 'Top' },
]
const control = 'press grid size-9 shrink-0 place-items-center rounded-control bg-surface text-ink hover:bg-raised'
const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** The room's imagined surroundings, when they come within a minute: the room never waits longer. */
async function imagined(shell: Parameters<typeof surroundOf>[0]) {
  const made = await Promise.race([surroundOf(shell), new Promise<null>((r) => setTimeout(() => r(null), 60_000))])
  if (!made) return null
  const [wide, behind] = await Promise.all([
    loadImage(made.wide_url).catch(() => null),
    made.behind_url ? loadImage(made.behind_url).catch(() => null) : Promise.resolve(null),
  ])
  return wide ? { wide, behind, widen: made.widen } : null
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timeout = setTimeout(() => { img.src = ''; reject(new Error("The room picture took too long to load. Try again.")) }, 25_000)
    const finish = () => { clearTimeout(timeout); img.onload = null; img.onerror = null }
    img.crossOrigin = 'anonymous'
    img.onload = () => { finish(); resolve(img) }
    img.onerror = () => { finish(); reject(new Error("Couldn't load the room's picture. Try again.")) }
    img.src = src
  })
}

/** An orbitable room with real product meshes; generated details remain an approximation. */
export function Room3D({ s }: { s: Session }) {
  const { dispatch } = useStore()
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const pins = useRef(new Map<string, HTMLElement>())
  const view = useRef<Scene3D | null>(null)
  const [stage, setStage] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [angle, setAngle] = useState<ViewName | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [pieces, setPieces] = useState<Record<string, PieceState>>({})
  const [made, setMade] = useState<Record<string, Model3DOut>>({})
  const [expanded, setExpanded] = useState(() => matchMedia('(max-width: 639px)').matches)
  const [rotating, setRotating] = useState(false)
  const [guessed, setGuessed] = useState(false)
  const placed = s.products.filter((p) => p.placed !== false)
  const key = JSON.stringify(placed.map((p) => [p.id, p.box, p.thumb?.src, p.widthCm, p.depthCm, p.heightCm]))

  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!expanded) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const outside: { element: HTMLElement; inert: boolean }[] = []
    const layer = root.current?.closest('main')
    const previousZ = layer?.style.zIndex ?? ''
    // The board's stacking context must also sit above the sheet's title strip.
    if (layer) layer.style.zIndex = '50'
    let node: HTMLElement | null = root.current
    while (node?.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue
        outside.push({ element: sibling, inert: sibling.inert })
        sibling.inert = true
      }
      node = node.parentElement
      if (node === document.body) break
    }
    return () => {
      document.body.style.overflow = overflow
      outside.forEach(({ element, inert }) => { element.inert = inert })
      if (layer) layer.style.zIndex = previousZ
    }
  }, [expanded])

  useEffect(() => {
    if (stage !== 'ready') return
    const frame = requestAnimationFrame(() => {
      if (focused) view.current?.focus(focused)
      else { view.current?.view('front'); setAngle('front') }
    })
    return () => cancelAnimationFrame(frame)
    // ResizeObserver updates the lens before fitting the room to its new viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  useEffect(() => {
    let alive = true
    let built: Scene3D | null = null
    setStage('loading')
    setPieces({})
    setMade({})
    setRotating(false)
    setFocused(null)
    // Attach failure handlers immediately. The shell can take much longer than a model failure.
    const list: Piece[] = placed.map((p) => ({
      id: p.id, slot: p.slot, title: p.title, box: p.box,
      widthCm: p.widthCm, depthCm: p.depthCm, heightCm: p.heightCm ?? null,
      photo: p.thumb?.src ?? null,
      model: p.thumb?.src ? modelOf(p, s).then((m) => {
        if (alive) setMade((all) => ({ ...all, [p.id]: m }))
        return m.glb_url
      }, () => null) : null,
    }))
    ;(async () => {
      try {
        const shell = await roomShellOf(s)
        const [photo, depth, render, around] = await Promise.all([
          loadImage(shell.photo), loadImage(shell.depth),
          s.afterSrc ? loadImage(s.afterSrc).catch(() => null) : Promise.resolve(null),
          imagined(shell),
        ])
        if (alive) setGuessed(!!around)
        if (!alive || !canvas.current) return
        shell.objects.forEach((obj, i) => list.push({
          id: `room-${i}`, slot: obj.name, title: obj.name, box: obj.box,
          widthCm: null, depthCm: null, heightCm: null, photo: null,
          model: objectModelOf(obj, s).then((m) => m.glb_url, () => null),
          existing: true, onTop: obj.on_top,
        }))
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
        if (!alive || !canvas.current) return
        built = createScene(canvas.current, {
          photo, depth, geometry: shell.geometry, render, surround: around, pieces: list,
          ground: cssColor('--color-scrim'), paper: cssColor('--color-ground'), accent: cssColor('--color-chosen-bright'),
          onPins: (raw) => {
            // Keep numbered callouts apart, matching the schedule beside the room.
            const pts = raw.map((p) => ({ ...p }))
            for (let i = 0; i < pts.length; i++)
              for (let j = 0; j < i; j++) {
                if (!pts[i].visible || !pts[j].visible) continue
                if (Math.abs(pts[i].x - pts[j].x) < 30 && Math.abs(pts[i].y - pts[j].y) < 30) pts[i].y = pts[j].y - 32
              }
            for (const p of pts) {
              const el = pins.current.get(p.id)
              if (el) {
                el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
                el.style.visibility = p.visible ? 'visible' : 'hidden'
              }
            }
          },
          onPiece: (id, state) => { if (alive) setPieces((all) => ({ ...all, [id]: state })) },
          onPick: (id) => { if (alive) pick(id) },
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
    return () => { alive = false; built?.dispose(); view.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when the scene inputs change
  }, [s.beforeSrc, s.afterSrc, s.recorded3d, key, attempt])

  useGSAP(() => {
    if (stage !== 'ready' || !view.current) return
    const tl = gsap.timeline()
    tl.to('[data-preview]', { autoAlpha: 0, duration: reducedMotion() ? 0.16 : 0.65 })
      .add(() => { view.current?.view('front'); setAngle('front') }, reducedMotion() ? 0 : 0.3)
    const chrome = root.current?.querySelectorAll('[data-chrome]')
    if (chrome) tl.add(enter(chrome, { y: 6 })!, 0)
    return () => { tl.kill() }
  }, { scope: root, dependencies: [stage], revertOnUpdate: true })

  function touched(keepAngle = false) {
    view.current?.setAuto(false)
    setRotating(false)
    if (!keepAngle) setAngle(null)
  }
  function go(id: ViewName) { touched(true); setFocused(null); setAngle(id); view.current?.view(id) }
  function pick(id: string) { touched(); setFocused(id); view.current?.focus(id) }
  const close = () => dispatch({ type: 'view3d', on: false })
  const pending = placed.filter((p) => !pieces[p.id] || pieces[p.id] === 'modelling')
  const cards = placed.filter((p) => pieces[p.id] === 'card')
  const piece = placed.find((p) => p.id === focused)
  const pieceModel = piece ? made[piece.id] : undefined
  const ready = placed.filter((p) => pieces[p.id] === 'ready').length

  return (
    <div ref={root} data-room3d className={`${expanded ? 'fixed inset-0 z-50' : 'absolute inset-0 z-30'} isolate overflow-hidden bg-scrim`} role={expanded ? 'dialog' : 'region'} aria-modal={expanded || undefined} aria-label={`Your ${s.name.toLowerCase()} in 3D`}
      onKeyDown={(e) => {
        if (!expanded || e.key !== 'Tab') return
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button, a[href], canvas[tabindex]') ?? [])].filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
        const first = controls[0]
        const last = controls.at(-1)
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }}>
      <canvas ref={canvas} tabIndex={0} aria-label="3D room. Arrow keys turn, plus and minus zoom, Home resets. Drag to orbit; pinch or scroll to zoom."
        className={`absolute inset-0 size-full cursor-grab touch-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-surface active:cursor-grabbing ${stage === 'ready' ? '' : 'invisible'}`}
        onDoubleClick={() => go('front')} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const turns: Record<string, [number, number]> = { ArrowLeft: [-0.25, 0], ArrowRight: [0.25, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] }
          if (turns[e.key]) { e.preventDefault(); touched(); view.current?.orbit(...turns[e.key]) }
          if (['+', '=', '-', '_'].includes(e.key)) { e.preventDefault(); touched(true); view.current?.zoom(e.key === '-' || e.key === '_' ? 1.2 : 1 / 1.2) }
          if (e.key === 'Home') { e.preventDefault(); go('front') }
        }} />
      {(s.afterSrc ?? s.beforeSrc) && stage !== 'failed' && <img data-preview src={s.afterSrc ?? s.beforeSrc} alt="" className={`pointer-events-none absolute inset-0 size-full object-cover ${stage === 'loading' ? 'opacity-50' : ''}`} draggable={false} />}

      {stage === 'ready' && placed.map((p, i) => (
        <span key={p.id} ref={(el) => void (el ? pins.current.set(p.id, el) : pins.current.delete(p.id))} className="pointer-events-none absolute top-0 left-0 will-change-transform" style={{ visibility: 'hidden' }}>
          <button type="button" data-pin3d onClick={(e) => { e.stopPropagation(); pick(p.id) }}
            className={`group pointer-events-auto flex min-h-11 min-w-11 -translate-x-3.5 -translate-y-full items-center transition-opacity duration-200 ${focused && focused !== p.id ? 'opacity-40' : ''}`}
            aria-label={`${String(i + 1).padStart(2, '0')}, ${p.slot}, ${money(p.priceEur, p.currency ?? s.currency)}: inspect in 3D`}>
            <span className={`label grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] ${focused === p.id ? 'border-surface bg-ink text-surface' : 'border-ink bg-surface text-ink'} ${pieces[p.id] === 'modelling' ? 'motion-safe:animate-[breathe_1.6s_ease-in-out_infinite]' : ''}`}>{String(i + 1).padStart(2, '0')}</span>
            <span className={`flex items-center transition-opacity duration-150 ${focused === p.id ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'} max-sm:hidden`}>
              <span className="h-px w-3 bg-surface" />
              <span className="num rounded-control bg-surface px-2 py-1 text-small font-semibold whitespace-nowrap text-ink">{p.slot} · {money(p.priceEur, p.currency ?? s.currency)}</span>
            </span>
          </button>
        </span>
      ))}

      <div className="absolute top-3 right-3 z-10 flex gap-1.5">
        <button type="button" onClick={() => setExpanded((on) => !on)} aria-label={expanded ? 'Exit full screen' : 'Expand 3D view'} className={control}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button ref={closeButton} type="button" onClick={close} aria-label="Close the 3D view (Esc)" className={control}><X size={16} /></button>
      </div>

      {stage === 'loading' && <div className="absolute inset-x-3 bottom-3 rounded-card bg-surface p-3 text-chrome text-ink" role="status"><p className="flex items-center gap-2 font-semibold"><LiveDot /> Building your room in 3D…</p><p className="mt-1 text-small text-muted">Preparing the room, imagining what the photo didn't show, and modelling its pieces. The first time can take a few minutes; after that it opens faster.</p></div>}
      {stage === 'failed' && <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-3 text-chrome text-ink"><p role="alert">{error}</p><button type="button" onClick={() => setAttempt((n) => n + 1)} className="press inline-flex min-h-9 items-center gap-1.5 rounded-control bg-primary px-3 text-surface"><RotateCcw size={14} /> Try again</button></div>}

      {stage === 'ready' && <>
        <div data-chrome className="pointer-events-none absolute top-3 left-3 max-w-[50%] rounded-control bg-surface px-3 py-2 text-small text-ink max-sm:py-1.5">
          <p className="text-chrome font-semibold">{s.recorded3d ? 'Recorded 3D demo' : 'Your room in 3D'}</p>
          <p className="mt-0.5 max-sm:hidden">Drag to orbit · scroll to zoom</p>
          <p className="mt-0.5 text-muted max-sm:hidden">{guessed ? "Approximate reconstruction from photos. What the photo didn't show is imagined." : 'Approximate reconstruction from photos.'}</p>
        </div>
        <div data-chrome className={`absolute top-14 right-3 flex flex-col gap-1.5 sm:top-16 ${expanded ? '' : 'max-sm:hidden'}`}>
          <button type="button" className={control} aria-label="Zoom in" onClick={() => { touched(true); view.current?.zoom(1 / 1.2) }}><Plus size={16} /></button>
          <button type="button" className={control} aria-label="Zoom out" onClick={() => { touched(true); view.current?.zoom(1.2) }}><Minus size={16} /></button>
          <button type="button" className={control} aria-label={rotating ? 'Pause rotation' : 'Rotate the room'} aria-pressed={rotating} onClick={() => { const on = !rotating; setRotating(on); setAngle(null); view.current?.setAuto(on) }}>{rotating ? <Pause size={15} /> : <Play size={15} />}</button>
        </div>
        <div data-chrome className="absolute inset-x-3 bottom-3 flex flex-col gap-2">
          {piece ? <div className="w-full rounded-card bg-surface p-3 text-ink sm:max-w-sm" aria-live="polite">
            <div className="flex items-start gap-3">
              {piece.thumb && <img src={piece.thumb.src} alt={piece.title} className="size-14 shrink-0 rounded-control bg-ground object-contain" />}
              <div className="min-w-0 flex-1"><p className="line-clamp-2 text-chrome font-semibold">{piece.title}</p><p className="num mt-1 text-chrome">{money(piece.priceEur, piece.currency ?? s.currency)} · {piece.retailer}</p>
                <p className="num mt-0.5 text-small text-muted">{[['W', piece.widthCm], ['D', piece.depthCm], ['H', piece.heightCm]].filter(([, v]) => v).map(([label, v]) => `${label} ${v} cm`).join(' · ') || 'Dimensions not listed'}</p></div>
            </div>
            <p className="mt-2 text-small text-muted max-sm:line-clamp-2">{pieces[piece.id] === 'modelling' ? "Making the model from the shop's photos…" : pieces[piece.id] === 'card' ? 'Shown as a flat photo: the 3D model was unavailable.' : pieceModel && pieceModel.views > 1 ? `Reconstructed from ${pieceModel.views} shop photos. Shape and unseen details are approximate.` : 'Reconstructed from one shop photo. Unseen sides are approximate.'}</p>
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => go('front')} className="press inline-flex min-h-9 items-center gap-1.5 rounded-control bg-raised px-3 text-small font-semibold"><ArrowLeft size={14} /> Whole room</button><a href={piece.url} target="_blank" rel="noreferrer" className="press inline-flex min-h-9 items-center gap-1.5 rounded-control bg-primary px-3 text-small font-semibold text-surface">Open at {piece.retailer} <ExternalLink size={13} /></a></div>
          </div> : <>
            <p role="status" className={`w-fit max-w-full rounded-control bg-surface px-3 py-1.5 text-small text-ink ${expanded ? '' : 'max-sm:sr-only'}`}>{pending.length ? <span className="flex items-center gap-2"><LiveDot /> {ready} of {placed.length} pieces ready · modelling {pending.map((p) => p.slot.toLowerCase()).join(', ')}…</span> : cards.length ? `Shown flat: ${cards.map((p) => p.slot.toLowerCase()).join(', ')} (3D model unavailable)` : `${ready} of ${placed.length} pieces in 3D${s.recorded3d ? ' · prices at recording' : ''}`}</p>
            <div role="group" aria-label="Inspect a piece" className="flex gap-1.5 overflow-x-auto">{placed.map((p) => <button key={p.id} type="button" onClick={() => pick(p.id)} className="press num min-h-9 shrink-0 rounded-control bg-surface px-3 text-small font-semibold text-ink hover:bg-raised">{p.slot} · {money(p.priceEur, p.currency ?? s.currency)}</button>)}</div>
          </>}
          <div role="group" aria-label="Camera angle" className="flex w-full gap-0.5 rounded-control bg-surface p-0.5 sm:ml-auto sm:w-auto sm:gap-1 sm:p-1">
            {VIEWS.map((v) => <button key={v.id} type="button" aria-pressed={angle === v.id} onClick={() => go(v.id)} className={`press min-h-9 flex-1 rounded-control px-2 text-small font-medium transition-colors duration-150 sm:px-3 sm:text-chrome ${angle === v.id ? 'bg-ink text-surface' : 'text-ink hover:bg-raised'}`}>{v.label}</button>)}
          </div>
        </div>
      </>}
    </div>
  )
}
