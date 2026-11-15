import { Footprints, Play, Rotate3d, RotateCcw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { canView3D, depthOf } from '../../lib/depth'
import { PHASES, phaseOf, statusText } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'
import { LiveDot } from '../common/LiveDot'

/** A walk-in always starts from the middle of the near edge, looking into the room. */
const VIEW = { from: { x: 0.5, y: 0.92 }, aimDeg: 0 }

/** One line under the room: the step the agent is on, or the room's name once it is done, and the room's tools. */
export function Caption() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const line = useRef<HTMLDivElement>(null)
  const phase = phaseOf(s)
  const index = phase ? PHASES.findIndex((p) => p.id === phase) : -1
  const done = s.status === 'done' && !!s.afterSrc
  const walk = s.walkIns[0]
  const making = walk?.status === 'making'

  // The depth map is asked for as soon as the room is drawn, so the 3D view opens at once.
  const in3d = done && canView3D(s.afterSrc) ? s.afterSrc : null
  useEffect(() => {
    if (in3d) depthOf(in3d).catch(() => {})
  }, [in3d])

  // A walk-in that just finished plays at once.
  const was = useRef(walk?.status)
  useEffect(() => {
    if (was.current === 'making' && walk?.status === 'ready') dispatch({ type: 'play', id: walk.id })
    was.current = walk?.status
  }, [walk?.status, walk?.id, dispatch])

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
    <div className="mx-auto flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:max-w-[calc((100dvh-6.5rem)*1.5)]">
      <div ref={line} className="flex min-h-9 min-w-0 flex-1 items-center gap-3 overflow-hidden" aria-live="polite">
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
          {detail && <span className="truncate text-muted">{detail}</span>}
          {phase && <span className="num shrink-0 text-muted">· {index + 1} of 4</span>}
        </p>
      </div>

      {done && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => dispatch({ type: 'replayReveal' })}
            aria-label="Replay the reveal"
            title="Replay the reveal"
            className="press grid size-9 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
          >
            <RotateCcw size={16} strokeWidth={2} />
          </button>
          {in3d && (
            <button
              type="button"
              aria-pressed={state.view3d}
              onClick={() => dispatch({ type: 'view3d', on: !state.view3d })}
              className={`press inline-flex h-9 items-center gap-1.5 rounded-control px-3.5 text-chrome font-medium ${state.view3d ? 'bg-secondary text-ink' : 'bg-primary text-surface'}`}
            >
              <Rotate3d size={15} strokeWidth={2} />
              {state.view3d ? 'Back to the photo' : 'Look around in 3D'}
            </button>
          )}
          {!s.offer &&
            (walk?.status === 'ready' ? (
              <button
                type="button"
                onClick={() => dispatch({ type: 'play', id: walk.id })}
                className="press inline-flex h-9 items-center gap-1.5 rounded-control bg-primary px-3.5 text-chrome font-medium text-surface"
              >
                <Play size={14} strokeWidth={2.25} className="fill-current" /> Walk in
              </button>
            ) : (
              <button
                type="button"
                disabled={making}
                onClick={() => void actions.makeWalkIn('push', 5, VIEW)}
                className="press inline-flex h-9 items-center gap-1.5 rounded-control bg-primary px-3.5 text-chrome font-medium text-surface disabled:bg-secondary disabled:text-ink"
              >
                {making ? <LiveDot /> : <Footprints size={15} strokeWidth={2} />}
                {making ? 'Making walk-in…' : walk?.status === 'failed' ? 'Try walk-in again' : 'Walk in'}
              </button>
            ))}
        </div>
      )}
      <BlockError block="walkin" className="w-full" />
    </div>
  )
}
