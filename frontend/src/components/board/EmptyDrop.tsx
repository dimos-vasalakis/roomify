import { useState } from 'react'
import { HAS_SAMPLES, SAMPLES } from '../../data/loadSamples'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'
import { PhoneHandoff } from './PhoneHandoff'

/** The empty room: one frame to drop a photo into. */
export function EmptyDrop() {
  const { dispatch, active } = useStore()
  const actions = useActions()
  const [over, setOver] = useState(false)
  const sample = SAMPLES.find((s) => s.status === 'done')

  const take = (file?: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      dispatch({ type: 'setError', block: 'photo', sessionId: active.id, message: `“${file.name}” isn’t a photo. Use a JPEG, PNG or WebP.` })
      return
    }
    void actions.setPhoto(file)
  }

  return (
    <div
      className={`absolute inset-3 grid place-items-center rounded-card border-[1.5px] border-dashed transition-colors duration-200 ${over ? 'border-ink bg-surface' : 'border-control'}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        take(e.dataTransfer.files[0])
      }}
    >
      <div className="flex max-w-md flex-col items-center px-6 text-center">
        <p className="text-title font-semibold tracking-[-0.015em] text-ink">Drop a photo of your room</p>
        <p className="mt-1.5 text-body text-muted">One wide shot from the doorway works best.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <label className="press inline-flex h-11 cursor-pointer items-center rounded-control bg-primary px-5 text-body font-medium text-surface focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
            Choose a photo
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => take(e.target.files?.[0])} />
          </label>
          {HAS_SAMPLES && sample && (
            <button
              type="button"
              onClick={() => dispatch({ type: 'select', id: sample.id })}
              className="press inline-flex h-11 items-center rounded-control bg-surface px-5 text-body font-medium text-ink ring-1 ring-control hover:ring-ink"
            >
              Use a sample room
            </button>
          )}
        </div>
        <BlockError block="photo" className="mt-4 text-left" />
        <div className="mt-8 border-t border-control pt-6">
          <PhoneHandoff onPhoto={take} />
        </div>
      </div>
    </div>
  )
}
