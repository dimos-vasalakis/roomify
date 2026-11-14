import { Play } from 'lucide-react'
import { useStore } from '../../state/store'
import type { Box, Point } from '../../types'
import { Crop } from '../common/Crop'

const MOVE_NAME = { push: 'Push in', orbit: 'Orbit', rise: 'Rise' } as const

/** A 4:3 crop of the room around the spot a walk-in starts from. */
const around = (p: Point): Box => {
  const w = 0.36
  const h = w * 1.125
  return { x: Math.min(Math.max(p.x - w / 2, 0), 1 - w), y: Math.min(Math.max(p.y - h * 0.7, 0), 1 - h), w, h }
}

/** The walk-ins made so far, under the room. Hidden until there is one. */
export function WalkInStrip() {
  const { active: s, dispatch } = useStore()
  if (!s.walkIns.length || !s.afterSrc) return null
  const picture = s.afterSrc

  return (
    <section aria-label="Walk-ins" className="flex items-center gap-3 overflow-x-auto px-4 py-3">
      <h2 className="shrink-0 text-small text-muted">Walk-ins</h2>
      {s.walkIns.map((w) => (
        <button
          key={w.id}
          type="button"
          disabled={w.status !== 'ready'}
          onClick={() => dispatch({ type: 'play', id: w.id })}
          title={w.status === 'failed' ? (w.error ?? "Couldn't make this one") : `${MOVE_NAME[w.move]} · ${w.seconds} s`}
          className="group flex shrink-0 items-center gap-2.5 rounded-card py-1 pr-3 pl-1 text-left transition-colors duration-150 hover:bg-raised disabled:cursor-progress"
        >
          <span className="relative block w-16 overflow-hidden rounded-[5px]">
            <Crop src={picture} box={around(w.from)} alt="" className={w.status === 'ready' ? '' : 'opacity-40'} />
            {w.status === 'ready' && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-6 place-items-center rounded-full bg-surface text-ink transition-transform duration-200 group-hover:scale-110">
                  <Play size={11} strokeWidth={2} className="ml-0.5" fill="currentColor" />
                </span>
              </span>
            )}
          </span>
          <span>
            <span className="block text-chrome font-medium text-ink">
              {MOVE_NAME[w.move]} · {w.seconds} s
            </span>
            <span className="block text-small text-muted">
              {w.status === 'making' ? 'Making it…' : w.status === 'failed' ? "Couldn't make it" : w.createdAt}
            </span>
          </span>
        </button>
      ))}
    </section>
  )
}
