import { ArrowUp, ArrowUpRight, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { money, shopName, size } from '../../lib/format'
import { enter, useGSAP } from '../../lib/motion'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { instructionOf } from '../../lib/match'
import { useSpeech } from '../../lib/speech'
import { BlockError } from '../common/BlockError'
import { MicButton } from '../common/MicButton'
import type { Product } from '../../types'
import { Crop } from '../common/Crop'

const IDEAS = ['Warmer', 'Cheaper', 'Smaller', 'In wood']

/** Opens beside a price dot: the product as the shop lists it, and a way to swap it. */
export function ProductCard({ product, picture }: { product: Product; picture: string }) {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const [text, setText] = useState('')
  const card = useRef<HTMLDivElement>(null)
  const cx = product.box.x + product.box.w / 2
  const cy = product.box.y + product.box.h / 2
  const onRight = cx < 0.6
  const swapping = state.swapping?.productId === product.id

  useGSAP(
    () => {
      enter(card.current, { scale: 0.96, x: onRight ? -8 : 8 })
    },
    { scope: card, dependencies: [product.id] },
  )

  const speech = useSpeech({ onFinal: (said) => send(instructionOf(said)) })

  const send = (instruction: string) => {
    const v = instruction.trim()
    if (!v || swapping) return
    void actions.swap(product.id, v)
    setText('')
  }

  const dims = size(product.widthCm, product.depthCm)

  return (
    <div
      ref={card}
      role="dialog"
      aria-label={product.title}
      onClick={(e) => e.stopPropagation()}
      className="max-sm:fixed! max-sm:inset-x-3! max-sm:top-auto! max-sm:bottom-3! max-sm:w-auto! max-sm:z-40 absolute z-20 w-80 rounded-card border border-border bg-surface shadow-[0_10px_28px_rgb(0_0_0/0.14)]"
      style={{
        top: `clamp(0.75rem, calc(${cy * 100}% - 6rem), calc(100% - 21rem))`,
        ...(onRight ? { left: `calc(${cx * 100}% + 2rem)` } : { right: `calc(${(1 - cx) * 100}% + 2rem)` }),
        transformOrigin: onRight ? 'left center' : 'right center',
      }}
    >
      <div className="flex gap-3 p-3">
        <Crop src={product.thumb?.src ?? picture} box={product.thumb ? product.thumb.box : product.box} alt="" className="w-24 shrink-0 rounded-[5px]" />
        <div className="min-w-0 flex-1">
          <p className="text-small text-muted">{product.slot}</p>
          <h3 className="mt-0.5 text-chrome leading-5 font-medium text-ink">{product.title}</h3>
          <p className="num mt-1 text-body font-bold">{money(product.priceEur, product.currency)}</p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => dispatch({ type: 'selectProduct', id: null })}
          className="press -mt-1 -mr-1 grid size-8 shrink-0 place-items-center self-start rounded-control text-muted hover:bg-raised hover:text-ink"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>

      <dl className="mx-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-rule py-2.5 text-chrome">
        <dt className="text-muted">Shop</dt>
        <dd className="text-right">
          <a href={product.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
            {shopName(product.retailer)} <ArrowUpRight size={14} strokeWidth={1.75} />
          </a>
        </dd>
        {dims && (
          <>
            <dt className="text-muted">Size</dt>
            <dd className="num text-right">{dims}</dd>
          </>
        )}
        <dt className="text-muted">Get it</dt>
        <dd className="text-right">{product.deliveryText ?? '—'}</dd>
      </dl>

      {!s.offer && <form
        className="border-t border-rule p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        {swapping ? (
          <div aria-live="polite">
            <p className="text-chrome font-medium">Looking for “{state.swapping?.instruction}”</p>
            <p className="text-small text-muted">Searching the same shops, then checking it fits</p>
            <span className="mt-2.5 block h-1 overflow-hidden rounded-full bg-raised">
              <span className="block h-full w-1/3 rounded-full bg-ink motion-safe:animate-[slide_1.1s_var(--ease-in-out)_infinite]" />
            </span>
          </div>
        ) : (
          <>
            <label htmlFor="swap" className="text-small text-muted">
              Swap it for something
            </label>
            <div className="mt-1.5 flex gap-1.5">
              <input
                id="swap"
                value={speech.listening ? speech.interim : text}
                onChange={(e) => setText(e.target.value)}
                placeholder={speech.listening ? 'Listening…' : 'warmer, cheaper, no metal'}
                autoComplete="off"
                className="h-control min-w-0 flex-1 rounded-control border border-control bg-surface px-2.5 text-chrome placeholder:text-muted focus:border-ink focus:outline-none"
              />
              <MicButton listening={speech.listening} supported={speech.supported} onStart={speech.start} onStop={speech.stop} label="Say what instead" />
              <button
                type="submit"
                aria-label="Swap"
                disabled={!text.trim()}
                className="press grid size-9 shrink-0 place-items-center rounded-control bg-primary text-surface disabled:bg-secondary disabled:text-muted"
              >
                <ArrowUp size={16} strokeWidth={2} />
              </button>
            </div>
            <BlockError block="swap" className="mt-2" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => send(idea)}
                  className="press h-7 rounded-full bg-raised px-2.5 text-small font-medium text-ink hover:bg-active"
                >
                  {idea}
                </button>
              ))}
            </div>
          </>
        )}
      </form>}
    </div>
  )
}
