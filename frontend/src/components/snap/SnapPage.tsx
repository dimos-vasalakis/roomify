import { Camera, Check, Image as ImageIcon, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../api/client'
import { OFFERS } from '../../api/config'
import { enter, useGSAP } from '../../lib/motion'
import { toRoomPhoto } from '../../lib/photo'
import { LiveDot } from '../common/LiveDot'
import { Mark } from '../shell/Mark'

type Stage = 'pick' | 'sending' | 'sent' | 'failed'

/** The phone's page behind the QR code: take one photo of the room and send it to the laptop. */
export function SnapPage({ code }: { code: string }) {
  const [stage, setStage] = useState<Stage>('pick')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const last = useRef<File | null>(null)
  const root = useRef<HTMLElement>(null)

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  useGSAP(() => void enter('[data-stage]', { y: 8 }), { scope: root, dependencies: [stage] })

  const send = async (file: File | null | undefined) => {
    if (!file) return
    last.current = file
    setError('')
    setStage('sending')
    try {
      // The same 3:2 crop the laptop makes, so a phone photo of 5 MB travels as about 300 kB.
      const photo = await toRoomPhoto(file)
      setPreview(URL.createObjectURL(photo))
      await api.sendHandoff(code, photo)
      setStage('sent')
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "The photo didn't send. Try again.")
      setStage('failed')
    }
  }

  const picker = (capture: boolean, primary: boolean, label: string) => (
    <label
      className={`press flex h-14 w-full cursor-pointer items-center justify-center gap-2.5 rounded-control text-body font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink ${primary ? 'bg-primary text-surface' : 'bg-surface text-ink ring-1 ring-control'}`}
    >
      {capture ? <Camera size={20} strokeWidth={2} /> : <ImageIcon size={20} strokeWidth={2} />}
      {label}
      <input
        type="file"
        accept="image/*"
        {...(capture ? { capture: 'environment' as const } : {})}
        className="sr-only"
        onChange={(e) => {
          void send(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </label>
  )

  return (
    <main ref={root} className="mx-auto flex min-h-dvh max-w-md flex-col bg-ground px-5 pt-5 pb-8 text-ink">
      <header className="flex items-center justify-between">
        <Mark />
        <span className="text-small text-muted">Photo for your laptop</span>
      </header>

      {!OFFERS ? (
        <p data-stage role="alert" className="mt-16 text-body">This copy of Roomify has no server, so it can&rsquo;t take photos from a phone.</p>
      ) : stage === 'sent' ? (
        <section data-stage className="mt-10 flex flex-1 flex-col">
          {preview && <img src={preview} alt="The photo you sent" className="aspect-[3/2] w-full rounded-card object-cover" />}
          <p className="mt-6 flex items-center gap-2 text-title font-semibold tracking-[-0.015em]">
            <span className="grid size-6 place-items-center rounded-full bg-chosen text-surface"><Check size={14} strokeWidth={3} /></span>
            Sent. It&rsquo;s on your laptop now.
          </p>
          <p className="mt-2 text-body text-muted">Tell Roomify what you need there. You can put the phone down.</p>
          <div className="mt-auto pt-8">{picker(true, false, 'Take a different photo')}</div>
        </section>
      ) : (
        <section data-stage className="mt-10 flex flex-1 flex-col">
          <h1 className="text-[1.75rem] leading-[2.125rem] font-semibold tracking-[-0.02em]">Photograph the room</h1>
          <p className="mt-2 text-body text-muted">Hold the phone sideways and take one wide shot from the doorway, with the empty wall in view.</p>

          <div className="mt-8 grid aspect-[3/2] w-full place-items-center overflow-hidden rounded-card border-[1.5px] border-dashed border-control">
            {stage === 'sending' && preview ? (
              <img src={preview} alt="" className="size-full object-cover opacity-60" />
            ) : stage === 'sending' ? (
              <LiveDot />
            ) : (
              <span className="text-chrome text-muted">3 : 2, landscape</span>
            )}
          </div>

          {stage === 'sending' && (
            <p className="mt-4 flex items-center gap-2 text-body" aria-live="polite">
              <LiveDot /> Sending to your laptop…
            </p>
          )}
          {stage === 'failed' && (
            <div className="mt-4 flex items-start justify-between gap-3">
              <p role="alert" className="flex gap-2 text-body">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-negative" />
                {error}
              </p>
              <button type="button" onClick={() => void send(last.current)} className="press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-control px-3 text-chrome font-medium ring-1 ring-control">
                <RotateCcw size={14} strokeWidth={2} /> Try again
              </button>
            </div>
          )}

          <div className={`mt-auto flex flex-col gap-2.5 pt-8 ${stage === 'sending' ? 'pointer-events-none opacity-40' : ''}`}>
            {picker(true, true, 'Take a photo')}
            {picker(false, false, 'Choose from your photos')}
          </div>
        </section>
      )}
    </main>
  )
}
