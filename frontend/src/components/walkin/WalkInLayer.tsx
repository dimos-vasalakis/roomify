import { useRef, useState } from 'react'
import { useStore } from '../../state/store'
import type { Point } from '../../types'
import { Viewpoint } from './Viewpoint'
import { WalkInComposer } from './WalkInComposer'

const angle = (from: Point, to: Point, rect: DOMRect) => {
  const dx = (to.x - from.x) * rect.width
  const dy = (to.y - from.y) * rect.height
  if (Math.hypot(dx, dy) < 10) return null
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

/** Walk mode: click where to stand, drag to aim, then choose the camera move. */
export function WalkInLayer() {
  const { state, active, dispatch } = useStore()
  const box = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Point | null>(null)
  const [drag, setDrag] = useState<{ from: Point; aimDeg: number } | null>(null)

  const toPoint = (e: React.PointerEvent): Point | null => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  const placed = drag ?? state.draft

  return (
    <div
      ref={box}
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-composer]')) return
        const p = toPoint(e)
        if (!p) return
        e.currentTarget.setPointerCapture(e.pointerId)
        dispatch({ type: 'setDraft', draft: null })
        setDrag({ from: p, aimDeg: 0 })
      }}
      onPointerMove={(e) => {
        const p = toPoint(e)
        if (!p) return
        if (drag && box.current) {
          const a = angle(drag.from, p, box.current.getBoundingClientRect())
          if (a !== null) setDrag({ ...drag, aimDeg: a })
        } else setHover(p)
      }}
      onPointerUp={() => {
        if (drag) dispatch({ type: 'setDraft', draft: drag })
        setDrag(null)
      }}
      onPointerLeave={() => setHover(null)}
    >
      {active.walkIns.map((w) => (
        <Viewpoint key={w.id} at={w.from} aimDeg={w.aimDeg} small />
      ))}

      {!placed && (
        <p className="pointer-events-none absolute top-3 left-3 rounded-[5px] bg-surface px-2.5 py-1 text-chrome font-medium">
          Click where you want to stand. Drag to look.
        </p>
      )}

      {hover && !placed && <Viewpoint at={hover} aimDeg={0} ghost />}
      {placed && <Viewpoint at={placed.from} aimDeg={placed.aimDeg} />}
      {state.draft && !drag && <WalkInComposer at={state.draft.from} />}
    </div>
  )
}
