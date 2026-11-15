import { RotateCcw } from 'lucide-react'
import { useRef } from 'react'
import { DUR, enter, useGSAP } from '../../lib/motion'
import { canView3D } from '../../lib/depth'
import { pictureOf } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import type { Product } from '../../types'
import { BlockError } from '../common/BlockError'
import { Room3D } from '../room3d/Room3D'
import { PhoneHandoff } from './PhoneHandoff'
import { WalkInPlayer } from '../walkin/WalkInPlayer'
import { Caption } from './Caption'
import { Compare } from './Compare'
import { EmptyDrop } from './EmptyDrop'
import { PinCard } from './PinCard'
import { StepLayer } from './StepLayer'

/** The room board: the photo or the render, the agent's work drawn on it, and one caption line. */
export function Board() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const frame = useRef<HTMLDivElement>(null)
  const picture = pictureOf(s)
  const done = s.status === 'done' && !!s.afterSrc
  const selected = done ? (s.products.find((p) => p.id === state.selectedProductId) ?? null) : null
  const playing = s.walkIns.find((w) => w.id === state.playingWalkInId) ?? null

  useGSAP(() => void enter(frame.current?.querySelector('[data-picture]') ?? null, { duration: DUR.base }), { scope: frame, dependencies: [s.id] })

  const onPin = (p: Product) => {
    // A sentence said without naming a piece waits for a tap on the room.
    if (state.voice.pending && !s.offer) {
      dispatch({ type: 'setVoice', voice: { pending: null } })
      dispatch({ type: 'selectProduct', id: p.id })
      void actions.swap(p.id, state.voice.pending)
      return
    }
    dispatch({ type: 'selectProduct', id: p.id === state.selectedProductId ? null : p.id })
  }

  return (
    <section aria-label="Your room" className="flex min-w-0 flex-col gap-3">
      <div
        ref={frame}
        className="relative mx-auto aspect-[3/2] w-full overflow-hidden rounded-board bg-raised select-none lg:max-w-[calc((100dvh-6.5rem)*1.5)]"
        onClick={() => state.selectedProductId && dispatch({ type: 'selectProduct', id: null })}
      >
        {s.loaded === false ? (
          <div className="absolute inset-0 grid place-items-center">
            {state.errors.room?.sessionId === s.id ? (
              <div className="rounded-card bg-surface px-4 py-3">
                <BlockError block="room" />
              </div>
            ) : (
              <span className="sr-only">Loading the room</span>
            )}
          </div>
        ) : !picture ? (
          <EmptyDrop />
        ) : done ? (
          <div data-picture className="absolute inset-0">
            <Compare key={s.id} s={s} onPin={onPin} />
          </div>
        ) : (
          <img
            data-picture
            key={picture}
            src={picture}
            alt={s.afterSrc ? `A furnished preview of your ${s.name.toLowerCase()}` : `Your photo of the ${s.name.toLowerCase()}`}
            className={`absolute inset-0 size-full object-cover transition-[filter] duration-500 ${s.status === 'asking' ? 'brightness-[0.85]' : ''}`}
            draggable={false}
          />
        )}

        {picture && !done && <StepLayer s={s} />}


        {s.status === 'new' && picture && (
          <label className="press absolute top-4 right-4 z-10 inline-flex h-9 cursor-pointer items-center rounded-control bg-surface px-3 text-chrome font-medium text-ink hover:bg-raised focus-within:outline-2 focus-within:outline-ink">
            Change photo
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void actions.setPhoto(file)
              }}
            />
          </label>
        )}

        {/* A retake on the phone replaces the photo until the brief is sent. */}
        {s.status === 'new' && picture && <PhoneHandoff quiet onPhoto={(file) => void actions.setPhoto(file)} />}

        {s.status === 'new' && picture && state.errors.photo?.sessionId === s.id && (
          <div className="absolute inset-x-4 bottom-4 z-20 rounded-card bg-surface px-4 py-3 sm:right-auto sm:max-w-md">
            <BlockError block="photo" />
          </div>
        )}

        {selected && <PinCard product={selected} picture={picture} currency={s.currency} onClose={() => dispatch({ type: 'selectProduct', id: null })} />}

        {playing && s.afterSrc && <WalkInPlayer walk={playing} src={s.afterSrc} />}

        {done && state.view3d && canView3D(s.afterSrc) && <Room3D key={`3d-${s.id}`} s={s} />}

        {s.status === 'failed' && s.error && (
          <div className="absolute inset-x-4 bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-4 py-3 sm:right-auto sm:max-w-md">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-chrome font-semibold text-ink">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-negative" />
                {s.error.what}
              </p>
              <p className="mt-0.5 text-small text-muted">Your photo and brief are kept for another try.</p>
            </div>
            <button
              type="button"
              onClick={() => (s.offer ? void actions.retry() : void actions.reloadRoom(s.id))}
              className="press inline-flex h-9 items-center gap-1.5 rounded-control bg-primary px-3 text-chrome font-medium text-surface"
            >
              <RotateCcw size={14} strokeWidth={2} /> Try again
            </button>
          </div>
        )}
      </div>
      <Caption />
    </section>
  )
}
