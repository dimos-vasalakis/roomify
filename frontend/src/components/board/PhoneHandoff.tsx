import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../api/client'
import { OFFERS, PHONE_CAN_REACH, PUBLIC_URL } from '../../api/config'
import { LiveDot } from '../common/LiveDot'

const POLL_MS = 1500

/** One code per page, shared by the QR code and the listener that stays on after a photo lands. */
let shared: Promise<string> | null = null
const codeFor = (fresh: boolean) => {
  if (fresh || !shared) {
    shared = api.openHandoff().then((h) => h.code)
    shared.catch(() => (shared = null))
  }
  return shared
}

type Stage = { kind: 'opening' } | { kind: 'ready'; code: string } | { kind: 'arrived' } | { kind: 'failed'; message: string }

/**
 * Scan to send a photo from the phone. The laptop opens a drop box on the server and shows its
 * link as a QR code; the phone's page posts the photo into it; this picks it up and uses it.
 * `quiet`: no QR code, only listening, so a retake on the phone still replaces the photo.
 */
export function PhoneHandoff({ onPhoto, quiet = false }: { onPhoto: (file: File) => void; quiet?: boolean }) {
  const [stage, setStage] = useState<Stage>({ kind: 'opening' })
  const [attempt, setAttempt] = useState(0)
  const renew = () => {
    setStage({ kind: 'opening' })
    setAttempt((n) => n + 1)
  }
  const latest = useRef(onPhoto)
  useEffect(() => {
    latest.current = onPhoto
  }, [onPhoto])

  useEffect(() => {
    if (!OFFERS) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    const poll = async (code: string) => {
      if (!alive) return
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(() => void poll(code), POLL_MS)
        return
      }
      try {
        const photo = await api.pickUpHandoff(code, controller.signal)
        if (!alive) return
        if (photo) {
          if (!quiet) setStage({ kind: 'arrived' })
          latest.current(new File([photo], 'phone-photo.jpg', { type: photo.type || 'image/jpeg' }))
        }
      } catch (err) {
        if (!alive) return
        // The code ran out (or the server restarted): a fresh one, without a word.
        if (err instanceof ApiError && err.status === 404) return renew()
      }
      timer = setTimeout(() => void poll(code), POLL_MS)
    }

    codeFor(attempt > 0)
      .then((code) => {
        if (!alive) return
        setStage({ kind: 'ready', code })
        timer = setTimeout(() => void poll(code), POLL_MS)
      })
      .catch((err: unknown) => {
        if (alive) setStage({ kind: 'failed', message: err instanceof Error ? err.message : "Couldn't make a code for your phone." })
      })
    return () => {
      alive = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [attempt, quiet])

  if (!OFFERS || quiet) return null
  const link = stage.kind === 'ready' ? `${PUBLIC_URL}/snap/${stage.code}` : null

  return (
    <div className="flex items-center gap-4 text-left" data-testid="phone-handoff">
      <div className="grid size-[7.5rem] shrink-0 place-items-center rounded-control bg-surface p-2 ring-1 ring-control">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" aria-label="Link for your phone" className="block">
            <QRCodeSVG value={link} size={104} level="M" marginSize={0} fgColor="#171717" bgColor="#ffffff" />
          </a>
        ) : stage.kind === 'arrived' ? (
          <LiveDot />
        ) : (
          <span className="size-full rounded-[4px] bg-raised motion-safe:animate-[breathe_1.6s_ease-in-out_infinite]" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 max-w-[15rem]">
        <p className="text-body font-semibold text-ink">{stage.kind === 'arrived' ? 'Photo from your phone' : 'Or use your phone'}</p>
        {stage.kind === 'failed' ? (
          <>
            <p role="alert" className="mt-1 text-chrome text-ink">{stage.message}</p>
            <button type="button" onClick={renew} className="press mt-2 h-8 rounded-control px-2.5 text-chrome font-medium text-ink ring-1 ring-control hover:ring-ink">
              Try again
            </button>
          </>
        ) : stage.kind === 'arrived' ? (
          <p className="mt-1 text-chrome text-muted">Putting it in the room…</p>
        ) : (
          <p className="mt-1 text-chrome text-muted">
            Scan with the camera, take the photo, and it lands here.
            {!PHONE_CAN_REACH && <span className="mt-1 block text-ink">This page runs on localhost, which a phone can&rsquo;t open. Set VITE_PUBLIC_URL to this computer&rsquo;s network address.</span>}
          </p>
        )}
      </div>
    </div>
  )
}
