import { ArrowUp, LoaderCircle, Mic, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../../api/config'
import { money } from '../../lib/format'
import { instructionOf, productNamed, widthIn } from '../../lib/match'
import { useMicBars } from '../../lib/micLevel'
import { useSpeech } from '../../lib/speech'
import { isWorking } from '../../lib/session'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'

const BARS = 32
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** What was typed in each room and not sent yet: switching rooms never throws a sentence away. */
const drafts = new Map<string, string>()

/** "€300", "300 euros", "300€" in a sentence. */
const budgetIn = (text: string) => {
  const m = text.match(/€\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(?:€|eur\b|euros?\b)/i)
  const n = m ? Number((m[1] ?? m[2]).replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')) : NaN
  return Number.isFinite(n) && n >= 20 ? Math.round(n) : null
}

/**
 * Speak or type. Tap the mic and talk: a live waveform of the real microphone level and the
 * words as they are heard; it sends by itself when you stop talking. Or hold Space and let go.
 */
export function Composer() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const [text, setRawText] = useState(() => drafts.get(s.id) ?? '')
  const room = s.id
  const setText = useCallback(
    (next: string | ((t: string) => string)) =>
      setRawText((t) => {
        const value = typeof next === 'function' ? next(t) : next
        drafts.set(room, value)
        return value
      }),
    [room],
  )
  const [budget, setBudget] = useState(String(s.budgetEur))
  const [editBudget, setEditBudget] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const working = isWorking(s)
  const busy = !!state.swapping || working
  const fresh = s.status === 'new'
  // Two quick presses of Enter (or Enter and a click) must not send the same message twice.
  const sending = useRef<string | null>(null)

  /** True when the sentence went to the agent (or became a pending swap); false keeps it in the box. */
  const send = (sentence: string): boolean => {
    const said = sentence.trim()
    if (!said) return false
    if (sending.current === said) return false
    if (busy) {
      setHint('Roomify is still working on the last message. Wait for it, or press Stop.')
      return false
    }
    sending.current = said
    setTimeout(() => (sending.current = null), 800)
    setHint(null)
    if (fresh) {
      if (!s.beforeSrc) {
        setHint('Add a photo of the room first.')
        return false
      }
      lastSent.current = said
      const b = budgetIn(said) ?? Number(budget)
      void actions.startRun(instructionOf(said), b >= 20 ? b : 500, s.city, s.wallCm)
      return true
    }
    if (s.status === 'asking') {
      const cm = widthIn(said)
      if (cm) return void actions.answer(cm), true
      if (s.offer) return void actions.talk(said, {}, 'ask'), true
      setHint('Say or type the width, like “160 cm” or “1.6 m”.')
      return false
    }
    if (s.offer) return void actions.talk(said), true
    const product = productNamed(said, s.products)
    if (product) {
      dispatch({ type: 'selectProduct', id: product.id })
      void actions.swap(product.id, instructionOf(said))
    } else {
      dispatch({ type: 'selectProduct', id: null })
      dispatch({ type: 'setVoice', voice: { pending: instructionOf(said) } })
    }
    return true
  }

  // A first message that never reached the agent comes back to the input, ready to send again.
  const lastSent = useRef('')
  const startError = state.errors.start?.sessionId === s.id ? state.errors.start.message : null
  useEffect(() => {
    if (startError && fresh && lastSent.current) setText((t) => t || lastSent.current)
  }, [startError, fresh, setText])
  // Once the room has moved on (an answer, a failure), the same words may be sent again.
  const swapError = state.errors.swap?.sessionId === s.id ? state.errors.swap.message : null
  useEffect(() => {
    sending.current = null
  }, [s.status, startError, swapError, s.chat?.length])

  // A spoken sentence that can't go yet stays in the box instead of vanishing.
  const speech = useSpeech({ onFinal: (said) => void (send(said) || setText(said)) })
  const bars = useMicBars(speech.listening, BARS, speech.level)

  // A pin's Swap writes into the composer.
  useEffect(() => {
    const take = (e: Event) => {
      const incoming = (e as CustomEvent<string>).detail
      // A pin's "Swap the desk: " goes in front of what was already typed, never over it.
      setText((t) => (t.trim() && /:\s$/.test(incoming) && !t.startsWith(incoming) ? incoming + t.trim() : incoming))
      requestAnimationFrame(() => {
        const el = input.current
        el?.focus()
        el?.setSelectionRange(el.value.length, el.value.length)
      })
    }
    window.addEventListener('roomify:compose', take)
    return () => window.removeEventListener('roomify:compose', take)
  }, [setText])

  // Hold Space to talk; Escape throws away what was heard.
  const held = useRef(false)
  const { start, stop, cancel } = speech
  const listening = speech.listening
  useEffect(() => {
    if (s.recorded3d || state.view3d) return
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && listening) {
        e.preventDefault()
        e.stopImmediatePropagation()
        held.current = false
        return cancel()
      }
      if (e.code !== 'Space' || e.repeat || typing(e.target) || busy) return
      e.preventDefault()
      held.current = true
      start({ hold: true })
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !held.current) return
      e.preventDefault()
      held.current = false
      stop()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up)
    }
  }, [start, stop, cancel, listening, busy, s.recorded3d, state.view3d])

  const placeholder = busy
    ? 'Type your next message; it sends when Roomify is done'
    : fresh
      ? 'A desk and a chair for long days, €400'
      : s.status === 'asking'
        ? 'Width in cm, like 160'
        : s.offer
          ? 'Anything else, like “a rug under the desk”'
          : 'Swap a piece, like “a warmer lamp”'
  const pending = state.voice.pending
  const note = hint ?? speech.error ?? (pending ? `Which piece? Tap it on the room for “${pending}”.` : null)

  if (s.recorded3d) return (
    <div className="rounded-board bg-surface p-4 text-chrome text-ink">
      <p className="font-semibold">Explore this recorded room</p>
      <p className="mt-1 text-muted">Orbit the room, inspect each piece and open its shop listing. This recording stays as captured.</p>
      {API_URL && <a href="/?demo=1" className="press mt-3 inline-flex min-h-9 items-center rounded-control bg-primary px-3 font-semibold text-surface">Open a live room</a>}
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      {note && (
        <p role="status" className="flex items-start gap-2 text-chrome text-ink">
          <span aria-hidden="true" className={`mt-[0.45rem] size-1.5 shrink-0 rounded-full ${pending && !hint && !speech.error ? 'bg-chosen' : 'bg-negative'}`} />
          {note}
        </p>
      )}

      <form
        className={`flex flex-col rounded-[4px] border bg-surface transition-colors duration-200 focus-within:border-ink ${speech.listening ? 'border-ink' : 'border-ink/25'}`}
        onSubmit={(e) => {
          e.preventDefault()
          if (send(text)) setText('')
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
            value={speech.listening ? speech.interim : speech.transcribing ? '' : text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            disabled={speech.transcribing}
            placeholder={speech.listening ? '' : speech.transcribing ? 'Writing down what you said…' : placeholder}
            className={`block w-full resize-none bg-transparent px-3 pt-2.5 text-chrome leading-5 placeholder:text-muted focus:outline-none disabled:cursor-not-allowed ${speech.listening ? 'text-ink' : ''}`}
          />
          {speech.listening && !speech.interim && (
            <span className="pointer-events-none absolute top-2.5 left-3 text-chrome text-muted">Listening… it sends when you stop talking</span>
          )}
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
                    onBlur={() => {
                      if (Number(budget) < 20) {
                        setBudget('20')
                        setHint('A budget starts at €20.')
                      }
                      setEditBudget(false)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
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
            <span className="flex-1 pl-2 text-small text-muted"><span className="max-lg:hidden">{speech.supported ? 'Mic, or hold Space' : ''}</span></span>
          )}

          {speech.supported && (
            <button
              type="button"
              disabled={(busy && !speech.listening) || speech.transcribing}
              onClick={() => (speech.listening ? stop() : start())}
              aria-label={speech.listening ? 'Stop and send' : speech.transcribing ? 'Writing down what you said' : 'Talk to Roomify'}
              aria-pressed={speech.listening}
              className={`press grid size-10 shrink-0 place-items-center rounded-full transition-colors duration-200 disabled:opacity-40 ${speech.listening || speech.transcribing ? 'bg-ink text-surface disabled:opacity-100' : 'bg-raised text-ink hover:bg-active'}`}
            >
              {speech.listening ? (
                <Square size={14} strokeWidth={2.5} className="fill-current" />
              ) : speech.transcribing ? (
                <LoaderCircle size={18} strokeWidth={2} className="motion-safe:animate-spin" />
              ) : (
                <Mic size={18} strokeWidth={2} />
              )}
            </button>
          )}
          {working && s.offer ? (
            // Never stuck watching: Stop puts the room back as it was and the message back in the box.
            <button
              key="stop"
              type="button"
              onClick={() => actions.stop()}
              aria-label="Stop Roomify"
              title="Stop, and go back to the room as it was"
              className="press grid size-10 shrink-0 place-items-center rounded-full bg-primary text-surface"
            >
              <Square size={13} strokeWidth={2.5} className="fill-current" />
            </button>
          ) : (
            // Its own element: if React reused Stop's button, the click that stops would also submit.
            <button
              key="send"
              type="submit"
              aria-label="Send"
              disabled={!text.trim() || busy || speech.listening}
              className="press grid size-10 shrink-0 place-items-center rounded-full bg-primary text-surface disabled:bg-secondary disabled:text-muted"
            >
              <ArrowUp size={18} strokeWidth={2.25} />
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
