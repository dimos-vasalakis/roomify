import { RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { DUR, STAGGER, enter, useGSAP } from '../../lib/motion'
import { pictureOf } from '../../lib/session'
import { useStore } from '../../state/store'
import { LiveDot } from '../common/LiveDot'
import { Shelf } from '../shelf/Shelf'
import { WalkInLayer } from '../walkin/WalkInLayer'
import { WalkInPlayer } from '../walkin/WalkInPlayer'
import { CompareHandle } from './CompareHandle'
import { DimensionLine } from './DimensionLine'
import { PhotoDrop } from './PhotoDrop'
import { PriceDot } from './PriceDot'
import { ProductCard } from './ProductCard'

/** The room: the user's photo or the render, with everything the agent chose on it. */
export function Stage() {
  const { state, active: s, dispatch } = useStore()
  const room = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(0.5)
  const picture = pictureOf(s)
  const done = s.status === 'done'
  const selected = s.products.find((p) => p.id === state.selectedProductId) ?? null
  const playing = s.walkIns.find((w) => w.id === state.playingWalkInId) ?? null
  const showDots = done && !state.compare && !state.walkMode && !playing

  useGSAP(
    () => {
      enter('[data-picture]', { duration: DUR.base })
      if (room.current?.querySelector('[data-dot]')) enter('[data-dot]', { scale: 0.6, stagger: STAGGER, delay: 0.08 })
    },
    { scope: room, dependencies: [s.id, s.status] },
  )

  return (
    <div className="overflow-hidden rounded-panel border border-border bg-surface">
      <div
        ref={room}
        className="relative aspect-[3/2] overflow-hidden bg-raised select-none"
        onClick={() => state.selectedProductId && dispatch({ type: 'selectProduct', id: null })}
      >
        {s.status === 'new' && !picture && <PhotoDrop onPhoto={(url) => dispatch({ type: 'setPhoto', url })} />}

        {picture && (
          <img
            data-picture
            key={picture}
            src={state.compare && s.afterSrc ? s.beforeSrc : picture}
            alt={done ? `Your ${s.name.toLowerCase()} with the products Roomify chose` : `Your photo of the ${s.name.toLowerCase()}`}
            className="absolute inset-0 size-full object-cover"
            draggable={false}
          />
        )}

        {state.compare && s.afterSrc && (
          <>
            <img
              src={s.afterSrc}
              alt=""
              className="absolute inset-0 size-full object-cover"
              style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}
              draggable={false}
            />
            <CompareHandle value={split} onChange={setSplit} />
          </>
        )}

        {showDots &&
          s.products.map((p) => (
            <PriceDot
              key={p.id}
              product={p}
              selected={p.id === state.selectedProductId}
              dimmed={!!selected && p.id !== selected.id}
              onSelect={() => dispatch({ type: 'selectProduct', id: p.id === state.selectedProductId ? null : p.id })}
            />
          ))}

        {showDots && selected && <ProductCard product={selected} picture={picture} />}

        {state.walkMode && done && <WalkInLayer />}

        {playing && s.afterSrc && <WalkInPlayer walk={playing} src={s.afterSrc} />}

        {(s.status === 'shopping' || s.status === 'drawing') && s.now && (
          <div className="absolute top-3 left-3 flex max-w-[80%] items-center gap-2 rounded-[5px] bg-surface px-2.5 py-1 text-chrome">
            <LiveDot />
            <span className="truncate font-medium">{s.status === 'drawing' ? 'Drawing your room' : 'Shopping for your room'}</span>
          </div>
        )}

        {s.status === 'drawing' && (
          <span className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-surface/60">
            <span className="block h-full w-1/4 bg-ink motion-safe:animate-[slide_1.4s_var(--ease-in-out)_infinite]" />
          </span>
        )}

        {s.status === 'asking' && (
          <p className="absolute top-3 left-3 rounded-[5px] bg-surface px-2.5 py-1 text-chrome font-medium">Waiting for your answer</p>
        )}

        {s.status === 'failed' && s.error && (
          <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-4 py-3 sm:inset-x-auto sm:left-4 sm:max-w-md">
            <div>
              <p className="flex items-center gap-2 text-chrome font-medium">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-negative" />
                {s.error.what}
              </p>
              <p className="text-small text-muted">Your basket is safe. Last good: {s.error.lastGood}</p>
            </div>
            <button type="button" className="press inline-flex h-control items-center gap-1.5 rounded-control bg-primary px-3 text-chrome font-medium text-surface">
              <RotateCcw size={14} strokeWidth={2} /> Try again
            </button>
          </div>
        )}
      </div>

      {s.status !== 'new' && <DimensionLine cm={s.wallCm} />}
      <Shelf />
    </div>
  )
}
