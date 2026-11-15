import { money } from '../../lib/format'
import type { Product } from '../../types'

type Props = { product: Product; selected: boolean; dimmed: boolean; onSelect: () => void }

/**
 * A chosen product on the room: the dot sits exactly on the item, its price beside it.
 * The outer anchor holds the position; only the inner button animates, so motion never moves the spot.
 */
export function PriceDot({ product, selected, dimmed, onSelect }: Props) {
  const cx = product.box.x + product.box.w / 2
  const cy = product.box.y + product.box.h / 2
  const labelLeft = cx > 0.78

  return (
    <div className="absolute size-0 max-sm:hidden" style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}>
      <button
        type="button"
        data-dot
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        aria-label={`${product.title}, ${money(product.priceEur, product.currency)}`}
        aria-pressed={selected}
        className={`group absolute -top-3 flex items-center gap-1.5 transition-opacity duration-200 ${labelLeft ? '-right-3 origin-[calc(100%-0.75rem)_0.75rem] flex-row-reverse' : '-left-3 origin-[0.75rem_0.75rem]'} ${dimmed ? 'opacity-40 hover:opacity-100' : ''}`}
      >
        <span
          className={`grid size-6 place-items-center rounded-full bg-surface transition-transform duration-200 ease-out group-hover:scale-110 ${selected ? 'scale-110' : ''}`}
        >
          <span className={`rounded-full bg-chosen transition-all duration-200 ${selected ? 'size-3.5' : 'size-3'}`} />
        </span>
        <span
          className={`num rounded-[6px] px-2 py-0.5 text-small font-semibold whitespace-nowrap transition-colors duration-150 ${selected ? 'bg-ink text-surface' : 'bg-surface text-ink'}`}
        >
          {money(product.priceEur, product.currency)}
        </span>
      </button>
    </div>
  )
}
