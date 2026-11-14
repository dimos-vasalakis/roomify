import { useRef } from 'react'

type Props = { value: number; onChange: (v: number) => void }

/** Drag to compare the user's photo (left) with the render (right). Arrow keys move it too. */
export function CompareHandle({ value, onChange }: Props) {
  const track = useRef<HTMLDivElement>(null)

  const fromPointer = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect()
    if (!rect) return
    onChange(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
  }

  return (
    <div ref={track} className="absolute inset-0 touch-none">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Compare your photo with the render"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          fromPointer(e.clientX)
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromPointer(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onChange(Math.max(0, value - 0.05))
          if (e.key === 'ArrowRight') onChange(Math.min(1, value + 0.05))
        }}
        className="absolute inset-y-0 -ml-5 flex w-10 cursor-ew-resize justify-center"
        style={{ left: `${value * 100}%` }}
      >
        <span className="h-full w-0.5 bg-surface" />
        <span className="absolute top-1/2 grid h-9 w-6 -translate-y-1/2 place-items-center rounded-full bg-surface">
          <span className="flex gap-0.5">
            <span className="h-3 w-px bg-ink" />
            <span className="h-3 w-px bg-ink" />
          </span>
        </span>
      </div>
      <span className="pointer-events-none absolute top-3 left-3 rounded-[5px] bg-surface px-2 py-0.5 text-small font-medium">Your photo</span>
      <span className="pointer-events-none absolute top-3 right-3 rounded-[5px] bg-surface px-2 py-0.5 text-small font-medium">Roomify</span>
    </div>
  )
}
