import { money } from '../../lib/format'
import type { Product } from '../../types'

type Props = { product: Product; selected: boolean; dimmed: boolean; onSelect: () => void }

/** A chosen product on the room: a blue dot with a white ring, and its price on a white plate. */
export function PriceDot({ product, selected, dimmed, onSelect }: Props) {
  const cx = product.box.x + product.box.w / 2
  const cy = product.box.y + product.box.h / 2
  const labelLeft = cx > 0.8

  return (
    <button
      type="button"
      data-dot
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      aria-label={`${product.title}, ${money(product.priceEur)}`}
      aria-pressed={selected}
      className={`group absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 transition-opacity duration-200 ${labelLeft ? 'flex-row-reverse' : ''} ${dimmed ? 'opacity-40 hover:opacity-100' : ''}`}
      style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}
    >
      <span
        className={`grid size-5 place-items-center rounded-full bg-surface transition-transform duration-200 ease-out group-hover:scale-110 ${selected ? 'scale-110' : ''}`}
      >
        <span className={`rounded-full bg-chosen transition-all duration-200 ${selected ? 'size-3' : 'size-2.5'}`} />
      </span>
      <span
        className={`num rounded-[5px] px-1.5 py-0.5 text-small font-semibold whitespace-nowrap transition-colors duration-150 ${selected ? 'bg-ink text-surface' : 'bg-surface text-ink'}`}
      >
        {money(product.priceEur)}
      </span>
    </button>
  )
}
