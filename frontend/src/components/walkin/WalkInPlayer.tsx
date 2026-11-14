import { RotateCcw, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { EASE_OUT, enter, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { useStore } from '../../state/store'
import type { WalkIn } from '../../types'

const MOVE_NAME = { push: 'Push in', orbit: 'Orbit', rise: 'Rise' } as const

/** Plays a walk-in on the stage. Samples have no video yet, so the camera move is simulated on the photo. */
export function WalkInPlayer({ walk, src }: { walk: WalkIn; src: string }) {
  const { dispatch } = useStore()
  const root = useRef<HTMLDivElement>(null)
  const [run, setRun] = useState(0)

  // Look a quarter of the frame ahead of where the camera stands.
  const rad = (walk.aimDeg * Math.PI) / 180
  const tx = Math.min(0.9, Math.max(0.1, walk.from.x + Math.sin(rad) * 0.25))
  const ty = Math.min(0.9, Math.max(0.1, walk.from.y - Math.cos(rad) * 0.25))

  useGSAP(
    () => {
      const img = '[data-frame]'
      const bar = '[data-progress]'
      const el = root.current!
      if (walk.videoUrl) {
        enter(el)
        return
      }
      if (reducedMotion()) {
        enter(el)
        gsap.set(bar, { scaleX: 1 })
        return
      }
      {
        const tl = gsap.timeline()
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: EASE_OUT })
        gsap.set(img, { transformOrigin: `${tx * 100}% ${ty * 100}%` })
        if (walk.move === 'push') tl.fromTo(img, { scale: 1.02 }, { scale: 1.75, duration: walk.seconds, ease: 'sine.inOut' }, 0)
        if (walk.move === 'orbit')
          tl.fromTo(img, { scale: 1.4, xPercent: 5, rotation: -1 }, { scale: 1.45, xPercent: -5, rotation: 1, duration: walk.seconds, ease: 'sine.inOut' }, 0)
        if (walk.move === 'rise') tl.fromTo(img, { scale: 1.35, yPercent: 6 }, { scale: 1.3, yPercent: -6, duration: walk.seconds, ease: 'sine.inOut' }, 0)
        tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: walk.seconds, ease: 'none' }, 0)
      }
    },
    { scope: root, dependencies: [run, walk.id], revertOnUpdate: true },
  )

  return (
    <div ref={root} className="absolute inset-0 z-30 overflow-hidden bg-scrim" role="region" aria-label="Walk-in preview">
      {walk.videoUrl ? (
        <video
          key={run}
          src={walk.videoUrl}
          poster={walk.posterUrl ?? undefined}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 size-full object-cover"
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            const bar = root.current?.querySelector<HTMLElement>('[data-progress]')
            if (bar && v.duration) bar.style.transform = `scaleX(${v.currentTime / v.duration})`
          }}
        />
      ) : (
        <img data-frame src={src} alt="Walk-in preview of the furnished room" className="absolute inset-0 size-full object-cover will-change-transform" draggable={false} />
      )}
      <div className="absolute top-3 right-3 flex gap-1.5">
        <button
          type="button"
          onClick={() => setRun((n) => n + 1)}
          aria-label="Play again"
          className="press grid size-9 place-items-center rounded-control bg-surface text-ink hover:bg-raised"
        >
          <RotateCcw size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'play', id: null })}
          aria-label="Close walk-in (Esc)"
          className="press grid size-9 place-items-center rounded-control bg-surface text-ink hover:bg-raised"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
      <div className="absolute bottom-4 left-3 rounded-[5px] bg-surface px-2.5 py-1.5">
        <p className="text-chrome font-medium">
          Walk-in preview · {MOVE_NAME[walk.move]} · {walk.seconds} s
        </p>
        {!walk.videoUrl && <p className="text-small text-muted">Sample: the camera move is simulated on the photo</p>}
      </div>
      <span data-progress className="absolute inset-x-0 bottom-0 h-1 origin-left bg-surface" />
    </div>
  )
}
