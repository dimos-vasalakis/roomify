/** The one measurement the user gave, drawn under the room like an architect's dimension line. */
export function DimensionLine({ cm }: { cm: number | null }) {
  return (
    <div
      role="img"
      aria-label={cm ? `Wall width ${cm} centimetres` : 'Wall width not given yet'}
      className="flex h-8 items-center gap-2 px-4"
    >
      <span aria-hidden="true" className="relative h-3 flex-1">
        <span className="absolute top-0 left-0 h-3 w-px bg-ink" />
        <span className="absolute top-1/2 right-0 left-0 h-px bg-ink" />
      </span>
      <span className={`num text-small font-semibold ${cm ? 'text-ink' : 'text-muted'}`}>{cm ? `Wall ${cm} cm` : 'Wall width ?'}</span>
      <span aria-hidden="true" className="relative h-3 flex-1">
        <span className="absolute top-0 right-0 h-3 w-px bg-ink" />
        <span className="absolute top-1/2 right-0 left-0 h-px bg-ink" />
      </span>
    </div>
  )
}
