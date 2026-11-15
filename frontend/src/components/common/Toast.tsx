import { useEffect, useRef } from 'react'
import { enter, useGSAP } from '../../lib/motion'
import { useStore } from '../../state/store'

const SHOW_MS = 6000

/** One short note at the foot of the screen, with Undo when there is a way back. */
export function Toast() {
  const { state, dispatch } = useStore()
  const toast = state.toast
  const el = useRef<HTMLDivElement>(null)

  useGSAP(() => void (toast && enter(el.current, { y: 12, duration: 0.24 })), { dependencies: [toast?.id] })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => dispatch({ type: 'toast', toast: null }), SHOW_MS)
    return () => clearTimeout(t)
  }, [toast, dispatch])

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-6 z-[60] flex justify-center">
      {toast && (
        <div ref={el} key={toast.id} className="pointer-events-auto flex max-w-md items-center gap-3 rounded-control bg-ink py-2 pr-2 pl-4 text-chrome text-surface shadow-[0_8px_30px_rgb(23_23_23/0.25)]">
          <span className="min-w-0 truncate">{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.()
                dispatch({ type: 'toast', toast: null })
              }}
              className="press h-8 shrink-0 rounded-[6px] px-2.5 font-semibold text-chosen-bright hover:bg-surface/10"
            >
              Undo
            </button>
          )}
          <button type="button" onClick={() => dispatch({ type: 'toast', toast: null })} aria-label="Dismiss" className="press grid size-8 shrink-0 place-items-center rounded-[6px] text-surface/70 hover:bg-surface/10 hover:text-surface">
            ×
          </button>
        </div>
      )}
    </div>
  )
}
