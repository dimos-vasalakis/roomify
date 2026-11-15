import type { Product } from '../../types'

/**
 * A checked piece's real width, drawn along the bottom of where it stands in the room. Only for
 * pieces whose shop page gave the size and passed the fit check: nothing here is a guess.
 */
export function TapeMeasure({ product }: { product: Product }) {
  if (!product.fit?.length || !product.widthCm) return null
  const { x, y, w, h } = product.box
  return (
    <div
      role="img"
      aria-label={`${product.title}: ${product.widthCm} centimetres wide`}
      className="pointer-events-none absolute flex items-center gap-1 max-sm:hidden"
      style={{ left: `${x * 100}%`, top: `calc(${(y + h) * 100}% + 4px)`, width: `${w * 100}%` }}
    >
      <span aria-hidden="true" className="relative h-2.5 flex-1">
        <span className="absolute top-0 left-0 h-2.5 w-px bg-surface" />
        <span className="absolute top-1/2 right-0 left-0 h-px bg-surface" />
      </span>
      <span className="num rounded-[4px] bg-surface px-1.5 text-small font-semibold text-ink">{product.widthCm} cm</span>
      <span aria-hidden="true" className="relative h-2.5 flex-1">
        <span className="absolute top-0 right-0 h-2.5 w-px bg-surface" />
        <span className="absolute top-1/2 right-0 left-0 h-px bg-surface" />
      </span>
    </div>
  )
}
