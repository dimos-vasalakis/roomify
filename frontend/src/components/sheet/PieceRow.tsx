import { ArrowUpRight, CopyPlus, Move, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Crop } from '../common/Crop'
import { money, shopName } from '../../lib/format'
import { useActions } from '../../state/actions'
import type { Product } from '../../types'

const PLACES = ['Against the wall', 'Further left', 'Further right', 'Turned to face the room']

const cm = (v: number | null | undefined) => (v ? `${Math.round(v)}` : '—')

/** One line of the schedule: the piece's number on the drawing, what it is, and what you can do with it. */
export function PieceRow({ n, p, currency, selected, busy, onSelect }: {
  n: number
  p: Product
  currency?: string
  selected: boolean
  busy: boolean
  onSelect: () => void
}) {
  const actions = useActions()
  const row = useRef<HTMLLIElement>(null)
  const [moving, setMoving] = useState(false)
  // Picked on the room: its line comes into view here.
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  const [where, setWhere] = useState('')
  const sized = p.widthCm || p.depthCm || p.heightCm
  const move = (to: string) => {
    if (!to.trim()) return
    setMoving(false)
    setWhere('')
    void actions.press('arrange', p, to.trim())
  }

  return (
    <li ref={row} className={`group relative border-b border-ink/10 transition-colors duration-150 ${selected ? 'bg-surface' : 'hover:bg-surface/60'}`}>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="grid w-full grid-cols-[1.75rem_3.25rem_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-3 text-left">
        <span className={`label mt-0.5 grid size-6 place-items-center rounded-full border ${selected ? 'border-ink bg-ink text-surface' : 'border-ink/40 text-ink'}`}>{String(n).padStart(2, '0')}</span>
        <span className="relative block aspect-square overflow-hidden rounded-[4px] bg-surface ring-1 ring-ink/10">
          {p.thumb?.box ? (
            <Crop src={p.thumb.src} box={p.thumb.box} alt="" className="absolute inset-0 size-full" />
          ) : p.thumb?.src ? (
            <img src={p.thumb.src} alt="" className="absolute inset-0 size-full object-contain p-0.5 mix-blend-multiply" draggable={false} />
          ) : null}
        </span>
        <span className="min-w-0">
          <span className="label block text-muted">{p.slot}</span>
          <span className="mt-0.5 line-clamp-2 block text-chrome font-semibold text-ink">{p.title}</span>
          <span className="mt-1 block truncate font-mono text-[0.6875rem] text-muted">
            {shopName(p.retailer)}
            {sized ? ` · ${cm(p.widthCm)}×${cm(p.depthCm)}×${cm(p.heightCm)} cm` : ''}
          </span>
          {/* The sum against the wall or the space measured for it, from the shop's own size. */}
          {p.fit?.length ? (
            <span className={`mt-1 flex items-start gap-1.5 text-small ${p.fitOk === false ? 'text-negative' : 'text-ink'}`}>
              <span aria-hidden="true" className={`mt-[0.4rem] size-1.5 shrink-0 rounded-full ${p.fitOk === false ? 'bg-negative' : 'bg-chosen'}`} />
              <span className="min-w-0">{p.fit.at(-1)}</span>
            </span>
          ) : null}
        </span>
        <span className="num mt-3.5 font-mono text-chrome font-medium text-ink">{money(p.priceEur, p.currency ?? currency)}</span>
      </button>
      <a href={p.url} target="_blank" rel="noreferrer" className="absolute top-[3.4rem] right-3 inline-flex items-center gap-0.5 text-small font-medium text-muted underline decoration-ink/20 underline-offset-4 hover:text-ink hover:decoration-ink">
        Shop <ArrowUpRight size={12} strokeWidth={2} />
      </a>

      <div className={`flex flex-wrap items-center gap-1 px-3 pb-3 pl-[3.25rem] ${selected || moving ? '' : 'max-lg:flex lg:hidden lg:group-hover:flex lg:group-focus-within:flex'}`}>
        <Act icon={<Move size={13} strokeWidth={2} />} label="Move" on={moving} disabled={busy} onClick={() => setMoving((m) => !m)} />
        <Act icon={<CopyPlus size={13} strokeWidth={2} />} label="Another like it" disabled={busy} onClick={() => void actions.press('add', p)} />
        <Act icon={<Trash2 size={13} strokeWidth={2} />} label="Remove" disabled={busy} onClick={() => void actions.press('drop', p)} />
      </div>

      {moving && (
        <div className="px-3 pb-3 pl-[3.25rem]">
          <div className="flex flex-wrap gap-1">
            {PLACES.map((place) => (
              <button key={place} type="button" disabled={busy} onClick={() => move(place.toLowerCase())} className="press h-7 rounded-[4px] bg-surface px-2 text-small text-ink ring-1 ring-ink/15 hover:ring-ink disabled:opacity-40">
                {place}
              </button>
            ))}
          </div>
          <form
            className="mt-1.5 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              move(where)
            }}
          >
            <input
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              placeholder={`Where should the ${p.slot.toLowerCase()} go?`}
              aria-label={`Where should the ${p.slot.toLowerCase()} go?`}
              className="h-8 min-w-0 flex-1 rounded-[4px] bg-surface px-2 text-small text-ink ring-1 ring-ink/15 placeholder:text-muted focus:ring-ink focus:outline-none"
            />
            <button type="submit" disabled={busy || !where.trim()} className="press h-8 rounded-[4px] bg-ink px-3 text-small font-medium text-surface disabled:opacity-40">
              Move
            </button>
          </form>
        </div>
      )}
    </li>
  )
}

function Act({ icon, label, on = false, disabled, onClick }: { icon: React.ReactNode; label: string; on?: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on || undefined}
      className={`press inline-flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-small font-medium transition-colors disabled:opacity-40 ${on ? 'bg-ink text-surface' : 'bg-surface text-ink ring-1 ring-ink/15 hover:ring-ink'}`}
    >
      {icon}
      {label}
    </button>
  )
}
