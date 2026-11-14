import { Mic } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { instructionOf, productNamed } from '../../lib/match'
import { useSpeech } from '../../lib/speech'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/**
 * "Say a change" for a finished room. Hold Space (or click) and say "make the lamp warmer":
 * the item it names is swapped, as if typed. If no item is named, the next tap on the room picks it.
 */
export function VoiceBar() {
  const { state, active: s, dispatch } = useStore()
  const actions = useActions()
  const busy = !!state.swapping

  const speech = useSpeech({
    onFinal: (sentence) => {
      const instruction = instructionOf(sentence)
      const product = productNamed(sentence, s.products)
      if (product) {
        dispatch({ type: 'setVoice', voice: { caption: instruction, pending: null } })
        dispatch({ type: 'selectProduct', id: product.id })
        void actions.swap(product.id, instruction)
      } else {
        dispatch({ type: 'selectProduct', id: null })
        dispatch({ type: 'setVoice', voice: { caption: instruction, pending: instruction } })
      }
    },
  })

  // Mirror the live caption and errors into the store, so the room can show them in large type.
  useEffect(() => {
    dispatch({ type: 'setVoice', voice: { listening: speech.listening, ...(speech.listening ? { caption: speech.interim } : {}) } })
  }, [speech.listening, speech.interim, dispatch])
  useEffect(() => {
    dispatch({ type: 'setVoice', voice: { error: speech.error } })
  }, [speech.error, dispatch])

  // A sentence without an item waits for a tap: the tapped item is swapped with it.
  const pending = state.voice.pending
  useEffect(() => {
    if (!pending || !state.selectedProductId || busy) return
    dispatch({ type: 'setVoice', voice: { pending: null } })
    void actions.swap(state.selectedProductId, pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when an item is tapped
  }, [state.selectedProductId, pending])

  // The caption fades out a few seconds after the swap starts.
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

  if (!speech.supported) return null

  return (
    <button
      type="button"
      aria-pressed={speech.listening}
      disabled={busy}
      onClick={speech.listening ? speech.stop : speech.start}
      className={`press inline-flex h-control items-center gap-2 rounded-control px-3 text-chrome font-medium transition-colors duration-150 disabled:opacity-50 ${speech.listening ? 'bg-ink text-surface' : 'bg-secondary text-ink hover:bg-control'}`}
    >
      <Mic size={16} strokeWidth={1.75} />
      {speech.listening ? 'Listening…' : 'Say a change'}
      {!speech.listening && <kbd className="ml-0.5 hidden rounded-[4px] bg-surface px-1.5 text-small font-sans text-muted lg:inline">Space</kbd>}
    </button>
  )
}
