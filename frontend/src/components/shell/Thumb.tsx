import { pictureOf } from '../../lib/session'
import type { Session } from '../../types'

/** The state of a room as one small mark on its thumbnail. */
export function StateDot({ s }: { s: Session }) {
  if (s.status === 'shopping' || s.status === 'drawing')
    return <span className="size-2 rounded-full bg-ink ring-2 ring-surface motion-safe:animate-[breathe_1.6s_ease-in-out_infinite]" />
  if (s.status === 'asking') return <span className="size-2 rounded-full bg-chosen ring-2 ring-surface" />
  if (s.status === 'failed') return <span className="size-2 rounded-full bg-negative ring-2 ring-surface" />
  return null
}

export function Thumb({ s, className = '' }: { s: Session; className?: string }) {
  const src = pictureOf(s)
  return (
    <span className={`relative block aspect-[3/2] overflow-hidden rounded-[6px] bg-raised ${className}`}>
      {src && <img src={src} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />}
      <span className="absolute top-1 right-1 flex">
        <StateDot s={s} />
      </span>
    </span>
  )
}
