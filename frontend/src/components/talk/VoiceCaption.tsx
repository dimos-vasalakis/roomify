import { useRef } from 'react'
import { enter, useGSAP } from '../../lib/motion'
import { useStore } from '../../state/store'
import { LiveDot } from '../common/LiveDot'

/** What the person is saying, in large type on the room, so it reads on a projector and in the video. */
export function VoiceCaption() {
  const { state } = useStore()
  const { listening, caption, pending, error } = state.voice
  const plate = useRef<HTMLDivElement>(null)
  const shown = listening || caption || error

  useGSAP(() => {
    if (shown) enter(plate.current, { y: 8 })
  }, { dependencies: [!!shown] })

  if (!shown) return null

  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center" aria-live="polite">
      <div ref={plate} className="max-w-[min(40rem,100%)] rounded-card bg-surface px-4 py-3 text-center">
        {error ? (
          <p className="flex items-center gap-2 text-body text-ink">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-negative" />
            {error}
          </p>
        ) : (
          <>
            <p className="flex items-center justify-center gap-2 text-small text-muted">
              {listening && <LiveDot />}
              {listening ? 'Listening' : pending ? 'Which one? Tap it on the room' : 'Changing it'}
            </p>
            <p className="mt-0.5 text-[1.375rem] leading-8 font-medium tracking-[-0.01em] text-ink">
              {caption ? `“${caption}”` : <span className="text-muted">Say what to change, like “make the lamp warmer”</span>}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
