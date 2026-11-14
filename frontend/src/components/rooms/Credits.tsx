import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type Credit = { file: string; credit: string; page: string }

/** Credits for the openly licensed sample photos. Required by their licences. */
export function Credits() {
  const [open, setOpen] = useState(false)
  const [credits, setCredits] = useState<Credit[]>([])
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (!open || credits.length) return
    fetch('/samples/credits.json')
      .then((r) => r.json())
      .then(setCredits)
      .catch(() => setCredits([]))
  }, [open, credits.length])

  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-small text-muted underline underline-offset-2 hover:text-ink">
        Photo credits
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-0 text-ink shadow-[0_12px_32px_rgb(0_0_0/0.12)] backdrop:bg-scrim/40"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-body font-medium">Sample photo credits</h2>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="press grid size-9 place-items-center rounded-control hover:bg-raised">
            <X size={16} />
          </button>
        </div>
        <p className="px-5 pt-1 text-chrome text-muted">These rooms are other people's photos, used as placeholders. They are not Roomify renders.</p>
        <ul className="flex flex-col gap-3 px-5 py-4 text-chrome">
          {credits.map((c) => (
            <li key={c.file}>
              <a href={c.page} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-muted">
                {c.credit}
              </a>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  )
}
