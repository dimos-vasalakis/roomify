import { RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { DUR, STAGGER, enter, useGSAP } from '../../lib/motion'
import { pictureOf } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'
import { LiveDot } from '../common/LiveDot'
import { VoiceCaption } from '../talk/VoiceCaption'
import { WalkInLayer } from '../walkin/WalkInLayer'
import { WalkInPlayer } from '../walkin/WalkInPlayer'
import { WalkInStrip } from '../walkin/WalkInStrip'
import { Composer } from '../talk/Composer'
import { Reveal } from './Reveal'
import { CompareHandle } from './CompareHandle'
import { DimensionLine } from './DimensionLine'
import { PhotoDrop } from './PhotoDrop'
import { PriceDot } from './PriceDot'
import { ProductCard } from './ProductCard'
import { DesignProgress } from './DesignProgress'
import { RefineRoom } from './RefineRoom'

/** The room: the user's photo or the render, with everything the agent chose on it. */
export function Stage() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const room = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(0.5)
  const picture = pictureOf(s)
  const done = s.status === 'done'
  const selected = s.products.find((p) => p.id === state.selectedProductId) ?? null
  const playing = s.walkIns.find((w) => w.id === state.playingWalkInId) ?? null
  const revealing = done && !!s.afterSrc && state.reveal?.id === s.id
  // Dots need a render to sit on; an offer without one shows the receipt only.
  const showDots = done && !!s.afterSrc && !state.compare && !state.walkMode && !playing

  useGSAP(
    () => {
      if (revealing) return
      enter('[data-picture]', { duration: DUR.base })
      if (room.current?.querySelector('[data-dot]')) enter('[data-dot]', { scale: 0.6, stagger: STAGGER, delay: 0.08 })
    },
    { scope: room, dependencies: [s.id, s.status] },
  )

  return (
    <div className="flex flex-col gap-gap">
    <div className="overflow-hidden rounded-panel border border-border bg-surface">
      <div
        ref={room}
        className="relative aspect-[3/2] overflow-hidden bg-raised select-none"
        onClick={() => state.selectedProductId && dispatch({ type: 'selectProduct', id: null })}
      >
        {s.status === 'new' && !picture && s.loaded !== false && <PhotoDrop onFile={actions.setPhoto} />}
        {s.status === 'new' && picture && <label className="press absolute top-3 right-3 z-10 inline-flex h-row cursor-pointer items-center rounded-control bg-surface px-3 text-chrome font-medium text-ink hover:bg-raised">Change photo<input type="file" accept="image/*" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void actions.setPhoto(file) }} /></label>}

        {s.status === 'new' && picture && <div className="absolute inset-x-4 bottom-4 z-10"><BlockError block="photo" /></div>}

        {s.loaded === false && (
          <div className="absolute inset-0 grid place-items-center">
            {state.errors.room?.sessionId === s.id ? (
              <div className="rounded-card bg-surface px-4 py-3">
                <BlockError block="room" />
              </div>
            ) : (
              <span className="sr-only">Loading the room</span>
            )}
          </div>
        )}

        {picture && (
          <img
            data-picture
            key={picture}
            src={state.compare && s.afterSrc ? s.beforeSrc : picture}
            alt={s.afterSrc ? `A furnished preview of your ${s.name.toLowerCase()}` : `Your photo of the ${s.name.toLowerCase()}`}
            className="absolute inset-0 size-full object-cover"
            draggable={false}
          />
        )}

        {revealing && s.afterSrc && <Reveal before={s.beforeSrc} after={s.afterSrc} revealKey={state.reveal!.key} />}

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
          s.products.filter((p) => p.placed !== false).map((p) => (
            <PriceDot
              key={p.id}
              product={p}
              selected={p.id === state.selectedProductId}
              dimmed={!!selected && p.id !== selected.id}
              onSelect={() => dispatch({ type: 'selectProduct', id: p.id === state.selectedProductId ? null : p.id })}
            />
          ))}

        {showDots && selected && !revealing && <ProductCard product={selected} picture={picture} />}

        {showDots && <VoiceCaption />}

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
              <p className="text-small text-muted">Your photo and brief are saved for another try.</p>
            </div>
            <button type="button" onClick={() => s.offer ? void actions.startRun(s.prompt, s.budgetEur, s.city, s.wallCm) : void actions.reloadRoom(s.id)} className="press inline-flex h-row items-center gap-1.5 rounded-control bg-primary px-3 text-chrome font-medium text-surface">
              <RotateCcw size={14} strokeWidth={2} /> Try again
            </button>
          </div>
        )}
      </div>

      {s.offer && (s.status === 'shopping' || s.status === 'drawing') && <DesignProgress />}
      {done && s.afterSrc && <p className="border-t border-rule px-4 py-3 text-small text-muted">Room preview · Find the exact products and listing photos in your shopping list.</p>}
      {s.status !== 'new' && <DimensionLine cm={s.wallCm} />}
      <WalkInStrip />
    </div>
    {done && (s.offer ? <RefineRoom /> : <Composer />)}
    </div>
  )
}
