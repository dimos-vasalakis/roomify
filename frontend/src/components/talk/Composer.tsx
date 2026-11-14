import { ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { instructionOf, productNamed } from '../../lib/match'
import { useSpeech } from '../../lib/speech'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { MicButton } from '../common/MicButton'

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/**
 * Under the room, like a chat: say or type what to change. "Make the lamp warmer" swaps the lamp.
 * Without an item named, the next tap on the room picks it. Hold Space to talk.
 */
export function Composer() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const [text, setText] = useState('')
  const busy = !!state.swapping

  const change = (sentence: string) => {
    const instruction = instructionOf(sentence)
    if (!instruction || busy) return
    const product = productNamed(sentence, s.products)
    if (product) {
      dispatch({ type: 'setVoice', voice: { caption: instruction, pending: null } })
      dispatch({ type: 'selectProduct', id: product.id })
      void actions.swap(product.id, instruction)
    } else {
      dispatch({ type: 'selectProduct', id: null })
      dispatch({ type: 'setVoice', voice: { caption: instruction, pending: instruction } })
    }
  }

  const speech = useSpeech({ onFinal: change })

  // Mirror the live words and errors into the store, so the room shows them in large type.
  useEffect(() => {
    dispatch({ type: 'setVoice', voice: { listening: speech.listening, ...(speech.listening ? { caption: speech.interim } : {}) } })
  }, [speech.listening, speech.interim, dispatch])
  useEffect(() => {
    dispatch({ type: 'setVoice', voice: { error: speech.error } })
  }, [speech.error, dispatch])

  // A sentence without an item waits for a tap on the room.
  const pending = state.voice.pending
  useEffect(() => {
    if (!pending || !state.selectedProductId || busy) return
    dispatch({ type: 'setVoice', voice: { pending: null } })
    void actions.swap(state.selectedProductId, pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when an item is tapped
  }, [state.selectedProductId, pending])

  // The caption clears a few seconds after the change starts.
  useEffect(() => {
    if (state.voice.listening || state.voice.pending || !state.voice.caption) return
    const t = setTimeout(() => dispatch({ type: 'setVoice', voice: { caption: '' } }), 4000)
    return () => clearTimeout(t)
  }, [state.voice.listening, state.voice.pending, state.voice.caption, dispatch])

  // Hold Space to talk.
  const held = useRef(false)
  const { start, stop } = speech
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e.target) || busy || state.walkMode || state.playingWalkInId) return
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
  }, [start, stop, busy, state.walkMode, state.playingWalkInId])

  return (
    <form
      className="flex items-center gap-2 rounded-panel border border-border bg-surface p-2 pl-4 focus-within:border-ink"
      onSubmit={(e) => {
        e.preventDefault()
        change(text)
        setText('')
      }}
    >
      <label htmlFor="change" className="sr-only">
        Tell Roomify what to change
      </label>
      <input
        id="change"
        autoComplete="off"
        value={speech.listening ? speech.interim : text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        placeholder={speech.listening ? 'Listening…' : busy ? 'Changing it…' : 'Tell Roomify what to change, like “a warmer lamp”'}
        className="h-10 min-w-0 flex-1 bg-transparent text-body placeholder:text-muted focus:outline-none"
      />
      {speech.supported && !speech.listening && !text && (
        <kbd className="hidden rounded-[4px] bg-raised px-1.5 py-0.5 text-small font-sans text-muted md:inline">Hold Space</kbd>
      )}
      <MicButton listening={speech.listening} supported={speech.supported} onStart={start} onStop={stop} label="Say a change" className="size-10!" />
      <button
        type="submit"
        aria-label="Change it"
        disabled={!text.trim() || busy}
        className="press grid size-10 shrink-0 place-items-center rounded-control bg-primary text-surface disabled:bg-secondary disabled:text-muted"
      >
        <ArrowUp size={18} strokeWidth={2} />
      </button>
    </form>
  )
}
