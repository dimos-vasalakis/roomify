import { Rotate3d, RotateCcw, Ruler, Undo2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { canOpen3D, canView3D, prepare3D } from '../../lib/depth'
import { PHASES, isWorking, phaseOf, statusText } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { LiveDot } from '../common/LiveDot'

/** One line under the room: the step the agent is on, or the room's name once it is done, and the room's tools. */
export function Caption() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const line = useRef<HTMLDivElement>(null)
  const open3d = useRef<HTMLButtonElement>(null)
  const was3d = useRef(state.view3d)
  useEffect(() => {
    const closed = was3d.current && !state.view3d
    was3d.current = state.view3d
    if (!closed) return
    // Restore from the surviving control, after the expanded viewer restores its background.
    const frame = requestAnimationFrame(() => open3d.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [state.view3d])
  const phase = phaseOf(s)
  const index = phase ? PHASES.findIndex((p) => p.id === phase) : -1
  const done = s.status === 'done' && !!s.afterSrc
  // A failed room has its own "Back to the last room" on the photo.
  const canUndo = !!s.past?.length && !isWorking(s) && s.status !== 'new' && s.status !== 'failed'

  // The room's depth and every piece's 3D model are made as soon as the room is drawn, so the
  // 3D view has them ready (a model takes a minute or two the first time).
  const in3d = done && canView3D(s)
  // The 3D button is always there; it opens whenever the room has a photo and isn't mid-run.
  const canOpen = canOpen3D(s)
  const why3d = !s.beforeSrc ? 'Add a photo of the room first' : isWorking(s) ? 'Roomify is still working on this room' : !canOpen ? 'The 3D room needs the live back end' : undefined
  // Lengths are drawn on the photo whenever the agent isn't busy with it.
  const canMeasure = !!s.beforeSrc && !isWorking(s) && !state.view3d && !s.recorded3d
  const ready3d = in3d ? JSON.stringify([s.id, s.afterSrc, s.recorded3d, s.products.map((p) => [p.id, p.box, p.thumb?.src])]) : ''
  useEffect(() => {
    if (ready3d) prepare3D(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per set of pieces
  }, [ready3d])

  // The step line rolls up when the step changes.
  const key = phase ? `${phase}:${s.now?.text ?? ''}` : `${s.status}:${s.id}`
  useGSAP(
    () => {
      if (reducedMotion()) return
      gsap.fromTo('[data-line]', { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.28, ease: 'power3.out', clearProps: 'all' })
    },
    { scope: line, dependencies: [key] },
  )

  let title: string
  let detail: string | null = null
  if (phase) {
    title = PHASES[index].label
  } else if (s.status === 'new') {
    title = s.beforeSrc ? 'Now tell Roomify what you need' : 'Start with a photo of the room'
  } else {
    title = s.name
    detail = statusText(s)
  }

  return (
    <div className="mx-auto flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-y border-ink/15 py-1.5 lg:max-w-[calc((100dvh-10rem)*1.5)]">
      <div ref={line} className="flex min-h-9 min-w-0 flex-1 basis-full items-center gap-3 overflow-hidden sm:basis-auto" aria-live="polite">
        {phase && (
          <span className="flex shrink-0 items-center gap-1" aria-label={`Step ${index + 1} of 4`}>
            {PHASES.map((p, i) => (
              <span
                key={p.id}
                className={`h-1 w-5 rounded-full transition-colors duration-300 ${i < index ? 'bg-chosen' : i === index ? 'bg-ink motion-safe:animate-[breathe_1.6s_ease-in-out_infinite]' : 'bg-control'}`}
              />
            ))}
          </span>
        )}
        <p data-line className="flex min-w-0 items-baseline gap-2 text-body">
          {s.status === 'asking' && <LiveDot className="mb-0.5 self-center" />}
          <span className="shrink-0 font-semibold text-ink">{title}</span>
          {detail && <span className="label truncate text-muted">{detail}</span>}
          {phase && <span className="num shrink-0 text-muted">· {index + 1} of 4</span>}
        </p>
        {s.wallCm && !phase && (
          <span className="label shrink-0 border-l border-ink/15 pl-3 text-muted max-sm:hidden">Wall {s.wallCm} cm</span>
        )}
      </div>

      {canMeasure && (
        <button
          type="button"
          aria-pressed={state.measuring}
          onClick={() => dispatch({ type: 'measuring', on: !state.measuring })}
          title="Draw a length you know on the photo: a wall, or the space a piece must fit"
          className={`press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-chrome font-medium ${state.measuring ? 'bg-ink text-surface' : 'text-ink hover:bg-raised'}`}
        >
          <Ruler size={15} strokeWidth={2} /> Measure{s.measures?.length ? <span className="num font-mono text-small opacity-70">{s.measures.length}</span> : null}
        </button>
      )}
      {canUndo && !done && (
        <UndoButton onClick={() => actions.undo()} />
      )}
      {done && (
        <div className="flex shrink-0 items-center gap-1.5">
          {canUndo && <UndoButton onClick={() => actions.undo()} />}
          <button
            type="button"
            onClick={() => dispatch({ type: 'replayReveal' })}
            aria-label="Replay the reveal"
            title="Replay the reveal"
            className="press grid size-9 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
          >
            <RotateCcw size={16} strokeWidth={2} />
          </button>
        </div>
      )}
      <button
        type="button"
        ref={open3d}
        data-open-room3d
        aria-pressed={state.view3d}
        disabled={!canOpen && !state.view3d}
        title={why3d}
        onClick={() => dispatch({ type: 'view3d', on: !state.view3d })}
        className={`press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control px-3.5 text-chrome font-medium disabled:cursor-not-allowed disabled:opacity-45 ${state.view3d ? 'bg-secondary text-ink' : 'bg-primary text-surface'}`}
      >
        <Rotate3d size={15} strokeWidth={2} />
        {state.view3d ? 'Back to the photo' : 'Look around in 3D'}
      </button>
    </div>
  )
}

/** Back to the room before the last message (Ctrl Z). */
function UndoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Undo the last change (Ctrl Z)"
      className="press inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-chrome font-medium text-ink hover:bg-raised"
    >
      <Undo2 size={15} strokeWidth={2} /> Undo
    </button>
  )
}
