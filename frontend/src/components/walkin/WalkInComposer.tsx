import { useRef, useState } from 'react'
import { enter, useGSAP } from '../../lib/motion'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'
import type { Point, WalkMove } from '../../types'
import { Segmented } from './Segmented'

const MOVES: { value: WalkMove; label: string; hint: string }[] = [
  { value: 'push', label: 'Push in', hint: 'Walk forward the way you are looking' },
  { value: 'orbit', label: 'Orbit', hint: 'Circle slowly around what you are looking at' },
  { value: 'rise', label: 'Rise', hint: 'Lift the camera up as if standing up' },
]

/** The small card that turns a viewpoint into a walk-in. Opens beside the viewpoint. */
export function WalkInComposer({ at }: { at: Point }) {
  const { dispatch } = useStore()
  const actions = useActions()
  const [busy, setBusy] = useState(false)
  const [move, setMove] = useState<WalkMove>('push')
  const [seconds, setSeconds] = useState<5 | 8>(5)
  const card = useRef<HTMLDivElement>(null)
  // Dock in the corner opposite the camera, so the card never hides where you stand or look.
  const left = at.x > 0.5
  const top = at.y > 0.5

  useGSAP(
    () => {
      enter(card.current, { scale: 0.96, y: top ? -6 : 6 })
    },
    { scope: card },
  )

  return (
    <div
      ref={card}
      data-composer
      role="dialog"
      aria-label="Walk in from here"
      onPointerDown={(e) => e.stopPropagation()}
      className="max-sm:fixed! max-sm:inset-x-3! max-sm:top-auto! max-sm:bottom-3! max-sm:w-auto! max-sm:z-40 absolute z-20 w-72 cursor-default rounded-card border border-border bg-surface p-4 shadow-[0_10px_28px_rgb(0_0_0/0.14)]"
      style={{
        ...(left ? { left: '0.75rem' } : { right: '0.75rem' }),
        ...(top ? { top: '0.75rem' } : { bottom: '0.75rem' }),
        transformOrigin: `${left ? 'left' : 'right'} ${top ? 'top' : 'bottom'}`,
      }}
    >
      <h3 className="text-body font-medium">Walk in from here</h3>
      <p className="mt-1 text-chrome text-muted">A short camera move through your room, made from the render.</p>
      <div className="mt-4 flex flex-col gap-3">
        <Segmented label="Camera move" value={move} options={MOVES} onChange={setMove} />
        <Segmented
          label="Length"
          value={seconds}
          options={[
            { value: 5, label: '5 s' },
            { value: 8, label: '8 s' },
          ]}
          onChange={setSeconds}
        />
      </div>
      <BlockError block="walkin" className="mt-4" />
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'setDraft', draft: null })}
          className="press h-control rounded-control px-3 text-chrome font-medium text-ink hover:bg-raised"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void actions.makeWalkIn(move, seconds).finally(() => setBusy(false))
          }}
          className="press h-control rounded-control bg-primary px-4 text-chrome font-medium text-surface hover:bg-ink/85"
        >
          {busy ? 'Sending…' : 'Make walk-in'}
        </button>
      </div>
    </div>
  )
}
