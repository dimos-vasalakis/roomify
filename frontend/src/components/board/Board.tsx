import { RotateCcw, Undo2 } from 'lucide-react'
import { Suspense, lazy, useRef } from 'react'
import { DUR, enter, useGSAP } from '../../lib/motion'
import { canView3D } from '../../lib/depth'
import { pictureOf } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import type { Product } from '../../types'
import { BlockError } from '../common/BlockError'
import { PhoneHandoff } from './PhoneHandoff'
import { WalkInPlayer } from '../walkin/WalkInPlayer'
import { Caption } from './Caption'
import { Compare } from './Compare'
import { EmptyDrop } from './EmptyDrop'
import { MeasureLayer } from './MeasureLayer'
import { StepLayer } from './StepLayer'

// three.js only loads for the 3D room (fetched in the background once a room is finished).
const Room3D = lazy(() => import('../room3d/Room3D').then((m) => ({ default: m.Room3D })))

/** The room board: the photo or the render, the agent's work drawn on it, and one caption line. */
export function Board() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const frame = useRef<HTMLDivElement>(null)
  const picture = pictureOf(s)
  const done = s.status === 'done' && !!s.afterSrc
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
      <div className="relative mx-auto w-full lg:max-w-[calc((100dvh-10rem)*1.5)]">
      {/* Crop marks, as on a printed drawing sheet. */}
      <span aria-hidden="true" className="pointer-events-none absolute -inset-2 max-sm:hidden">
        <span className="absolute top-0 left-0 h-3 w-px bg-ink/50" /><span className="absolute top-0 left-0 h-px w-3 bg-ink/50" />
        <span className="absolute top-0 right-0 h-3 w-px bg-ink/50" /><span className="absolute top-0 right-0 h-px w-3 bg-ink/50" />
        <span className="absolute bottom-0 left-0 h-3 w-px bg-ink/50" /><span className="absolute bottom-0 left-0 h-px w-3 bg-ink/50" />
        <span className="absolute right-0 bottom-0 h-3 w-px bg-ink/50" /><span className="absolute right-0 bottom-0 h-px w-3 bg-ink/50" />
      </span>
      <div
        ref={frame}
        className="relative aspect-[3/2] w-full overflow-hidden rounded-[3px] bg-raised ring-1 ring-ink/20 select-none"
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
        {picture && s.loaded !== false && <MeasureLayer s={s} />}


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


        {playing && s.afterSrc && <WalkInPlayer walk={playing} src={s.afterSrc} />}

        {done && state.view3d && canView3D(s) && (
          <Suspense fallback={<div className="absolute inset-0 z-30 bg-scrim" />}>
            <Room3D key={`3d-${s.id}`} s={s} />
          </Suspense>
        )}

        {s.status === 'failed' && s.error && (
          <div className="absolute inset-x-4 bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-4 py-3 sm:right-auto sm:max-w-xl">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-chrome font-semibold text-ink">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-negative" />
                {s.error.what}
              </p>
              <p className="mt-0.5 text-small text-muted">
                {s.past?.length ? 'Nothing is lost: go back to the room as it was, or try the message again.' : 'Your photo and brief are kept for another try.'}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {!!s.past?.length && (
                <button
                  type="button"
                  onClick={() => actions.undo()}
                  className="press inline-flex h-9 items-center gap-1.5 rounded-control px-3 text-chrome font-medium text-ink ring-1 ring-control hover:ring-ink"
                >
                  <Undo2 size={14} strokeWidth={2} /> Back to the last room
                </button>
              )}
              <button
                type="button"
                onClick={() => (s.offer ? void actions.retry() : void actions.reloadRoom(s.id))}
                className="press inline-flex h-9 items-center gap-1.5 rounded-control bg-primary px-3 text-chrome font-medium text-surface"
              >
                <RotateCcw size={14} strokeWidth={2} /> Try again
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
      <Caption />
    </section>
  )
}
