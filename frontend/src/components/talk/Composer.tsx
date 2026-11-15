import { ArrowUp, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { money } from '../../lib/format'
import { instructionOf, productNamed } from '../../lib/match'
import { useMicBars } from '../../lib/micLevel'
import { useSpeech } from '../../lib/speech'
import { isWorking } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'

const BARS = 32
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** "€300", "300 euros", "300€" in a sentence. */
const budgetIn = (text: string) => {
  const m = text.match(/€\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(?:€|eur\b|euros?\b)/i)
  const n = m ? Number((m[1] ?? m[2]).replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')) : NaN
  return Number.isFinite(n) && n >= 20 ? Math.round(n) : null
}

/**
 * Speak or type. Hold the mic (or Space) to talk: a live waveform of the real microphone level
 * and the words as they are heard. The sentence goes to the agent when you let go.
 */
export function Composer() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const [text, setText] = useState('')
  const [budget, setBudget] = useState(String(s.budgetEur))
  const [editBudget, setEditBudget] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = !!state.swapping || isWorking(s)
  const fresh = s.status === 'new'

  const send = (sentence: string) => {
    const said = sentence.trim()
    if (!said || busy) return
    setHint(null)
    if (fresh) {
      if (!s.beforeSrc) return setHint('Add a photo of the room first.')
      lastSent.current = said
      const b = budgetIn(said) ?? Number(budget)
      void actions.startRun(instructionOf(said), b >= 20 ? b : 500, s.city, s.wallCm)
      return
    }
    if (s.status === 'asking') {
      const n = Number(said.replace(/[^\d.]/g, ''))
      if (/^\D*\d+(\.\d+)?\s*(cm|m)?\D*$/i.test(said) && n >= 40) return void actions.answer(Math.round(n))
      if (s.offer) return void actions.talk(said, {}, 'ask')
      return setHint('Say or type the width in cm, like “160”.')
    }
    if (s.offer) return void actions.talk(said)
    const product = productNamed(said, s.products)
    if (product) {
      dispatch({ type: 'selectProduct', id: product.id })
      void actions.swap(product.id, instructionOf(said))
    } else {
      dispatch({ type: 'selectProduct', id: null })
      dispatch({ type: 'setVoice', voice: { pending: instructionOf(said) } })
    }
  }

  // A first message that never reached the agent comes back to the input, ready to send again.
  const lastSent = useRef('')
  const startError = state.errors.start?.sessionId === s.id ? state.errors.start.message : null
  useEffect(() => {
    if (startError && fresh && lastSent.current) setText((t) => t || lastSent.current)
  }, [startError, fresh])

  const speech = useSpeech({ onFinal: send })
  const bars = useMicBars(speech.listening, BARS)

  // A pin's Swap writes into the composer.
  useEffect(() => {
    const take = (e: Event) => {
      setText((e as CustomEvent<string>).detail)
      requestAnimationFrame(() => {
        const el = input.current
        el?.focus()
        el?.setSelectionRange(el.value.length, el.value.length)
      })
    }
    window.addEventListener('roomify:compose', take)
    return () => window.removeEventListener('roomify:compose', take)
  }, [])

  // Hold Space to talk.
  const held = useRef(false)
  const { start, stop } = speech
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e.target) || busy || state.playingWalkInId) return
      e.preventDefault()
      held.current = true
      start()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !held.current) return
      e.preventDefault()
      held.current = false
      stop()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [start, stop, busy, state.playingWalkInId])

  const placeholder = busy
    ? 'Roomify is working…'
    : fresh
      ? 'A desk and a chair for long days, €400'
      : s.status === 'asking'
        ? 'Width in cm, like 160'
        : s.offer
          ? 'Change anything, like “a lighter chair”'
          : 'Swap a piece, like “a warmer lamp”'
  const pending = state.voice.pending
  const note = hint ?? speech.error ?? (pending ? `Which piece? Tap it on the room for “${pending}”.` : null)

  return (
    <div className="flex flex-col gap-2">
      {note && (
        <p role="status" className="flex items-start gap-2 text-chrome text-ink">
          <span aria-hidden="true" className={`mt-[0.45rem] size-1.5 shrink-0 rounded-full ${pending && !hint && !speech.error ? 'bg-chosen' : 'bg-negative'}`} />
          {note}
        </p>
      )}

      <form
        className={`flex flex-col rounded-board border bg-surface transition-colors duration-200 focus-within:border-ink ${speech.listening ? 'border-ink' : 'border-control'}`}
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
          setText('')
        }}
      >
        <label htmlFor="say" className="sr-only">
          Tell Roomify what you need
        </label>
        <div className="relative">
          <textarea
            id="say"
            ref={input}
            rows={2}
            autoComplete="off"
            value={speech.listening ? speech.interim : text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            disabled={busy}
            placeholder={speech.listening ? '' : placeholder}
            className={`block w-full resize-none bg-transparent px-4 pt-3 text-body leading-6 placeholder:text-muted focus:outline-none disabled:cursor-not-allowed ${speech.listening ? 'text-ink' : ''}`}
          />
          {speech.listening && !speech.interim && <span className="pointer-events-none absolute top-3 left-4 text-body text-muted">Listening…</span>}
        </div>

        <div className="flex items-center gap-2 px-2 pb-2">
          {speech.listening ? (
            <span className="flex h-10 flex-1 items-center gap-[3px] px-2" aria-hidden="true">
              {Array.from({ length: BARS }, (_, i) => (
                <span key={i} ref={(el) => void (bars.current[i] = el)} className="h-6 w-[3px] origin-center scale-y-[0.08] rounded-full bg-ink" />
              ))}
            </span>
          ) : fresh ? (
            <span className="flex flex-1 items-center pl-2">
              {editBudget ? (
                <span className="flex h-9 items-center rounded-control bg-raised pr-1 pl-3">
                  <span className="text-chrome text-muted">€</span>
                  <input
                    autoFocus
                    aria-label="Budget in euros"
                    inputMode="numeric"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    onBlur={() => setEditBudget(false)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), setEditBudget(false))}
                    className="num h-full w-16 bg-transparent px-1 text-chrome font-semibold focus:outline-none"
                  />
                </span>
              ) : (
                <button type="button" onClick={() => setEditBudget(true)} className="press num h-9 rounded-control bg-raised px-3 text-chrome text-ink hover:bg-active">
                  Budget <span className="font-semibold">{money(Number(budgetIn(text) ?? budget) || 0)}</span>
                </button>
              )}
            </span>
          ) : (
            <span className="flex-1 pl-2 text-small text-muted"><span className="max-lg:hidden">{speech.supported ? 'Hold Space to talk' : ''}</span></span>
          )}

          {speech.supported && (
            <button
              type="button"
              disabled={busy && !speech.listening}
              onClick={() => (speech.listening ? stop() : start())}
              aria-label={speech.listening ? 'Stop and send' : 'Talk to Roomify'}
              aria-pressed={speech.listening}
              className={`press grid size-10 shrink-0 place-items-center rounded-full transition-colors duration-200 disabled:opacity-40 ${speech.listening ? 'bg-ink text-surface' : 'bg-raised text-ink hover:bg-active'}`}
            >
              {speech.listening ? <Square size={14} strokeWidth={2.5} className="fill-current" /> : <Mic size={18} strokeWidth={2} />}
            </button>
          )}
          <button
            type="submit"
            aria-label="Send"
            disabled={!text.trim() || busy || speech.listening}
            className="press grid size-10 shrink-0 place-items-center rounded-full bg-primary text-surface disabled:bg-secondary disabled:text-muted"
          >
            <ArrowUp size={18} strokeWidth={2.25} />
          </button>
        </div>
      </form>
    </div>
  )
}
