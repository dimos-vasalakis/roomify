import { ArrowUpRight, Repeat2, X } from 'lucide-react'
import { useRef } from 'react'
import { money, shopName, size } from '../../lib/format'
import { enter, useGSAP } from '../../lib/motion'
import { compose } from '../../lib/session'
import type { Product } from '../../types'
import { Crop } from '../common/Crop'

type Props = { product: Product; picture: string; currency?: string; onClose: () => void }

/** A chosen piece, opened from its pin: listing photo, name, shop, price, link and Swap. */
export function PinCard({ product: p, picture, currency, onClose }: Props) {
  const card = useRef<HTMLDivElement>(null)
  const cx = p.box.x + p.box.w / 2
  const cy = p.box.y + p.box.h / 2
  const left = cx > 0.55
  const dims = size(p.widthCm, p.depthCm)

  useGSAP(() => enter(card.current, { y: 6, scale: 0.98, duration: 0.2 }), { dependencies: [p.id] })

  return (
    <div
      ref={card}
      role="dialog"
      aria-label={p.title}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-30 w-[17.5rem] rounded-card bg-surface p-3 shadow-[0_8px_30px_rgb(23_23_23/0.18)]"
      style={{
        top: `clamp(0.75rem, calc(${cy * 100}% - 6rem), calc(100% - 17rem))`,
        ...(left ? { right: `calc(${(1 - cx) * 100}% + 1.25rem)` } : { left: `calc(${cx * 100}% + 1.25rem)` }),
      }}
    >
      <div className="flex items-start gap-3">
        <Crop src={p.thumb?.src ?? picture} box={p.thumb ? p.thumb.box : p.box} alt={`Listing photo of ${p.title}`} className="w-20 shrink-0 rounded-[6px] ring-1 ring-border" />
        <div className="min-w-0 flex-1">
          <p className="text-small font-medium text-muted">{p.slot}</p>
          <p className="mt-0.5 line-clamp-2 text-chrome font-semibold text-ink">{p.title}</p>
          <p className="num mt-1 text-body font-semibold text-ink">{money(p.priceEur, p.currency ?? currency)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="press -mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink">
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <p className="mt-2 text-small text-muted">
        {[shopName(p.retailer), dims, p.deliveryText].filter(Boolean).join(' · ')}
      </p>
      {p.reason && <p className="mt-2 text-chrome text-ink">{p.reason}</p>}
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <a
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="press inline-flex h-9 items-center justify-center gap-1 rounded-control bg-primary text-chrome font-medium text-surface"
        >
          View in shop <ArrowUpRight size={14} strokeWidth={2} />
        </a>
        <button
          type="button"
          onClick={() => {
            compose(`Swap the ${p.slot.toLowerCase()}: `)
            onClose()
          }}
          className="press inline-flex h-9 items-center justify-center gap-1.5 rounded-control bg-raised text-chrome font-medium text-ink hover:bg-active"
        >
          <Repeat2 size={14} strokeWidth={2} /> Swap
        </button>
      </div>
    </div>
  )
}
