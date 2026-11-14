import { useCallback, useEffect, useRef, useState } from 'react'

/* The browser's own speech recognition (Chrome, Edge, Safari). No key, no server. */

type Alternative = { transcript: string }
type Result = { isFinal: boolean; 0: Alternative }
type ResultEvent = { results: ArrayLike<Result> }
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: ResultEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionCtor = new () => Recognition

/** Looked up on use, so a browser (or a test) that adds it later is picked up. */
const ctor = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export const speechSupported = () => !!ctor()

const MESSAGES: Record<string, string> = {
  'not-allowed': 'Allow the microphone to talk to the room.',
  'service-not-allowed': 'Allow the microphone to talk to the room.',
  'no-speech': "Didn't catch that. Try again.",
  'audio-capture': 'No microphone found.',
  network: 'Speech needs an internet connection.',
}

type Options = { lang?: string; onFinal: (text: string) => void }

/**
 * Hold-to-talk or click-to-talk. `interim` is what has been heard so far, for live captions.
 * When listening ends, `onFinal` gets the whole sentence (or what was heard, if stopped early).
 */
export function useSpeech({ lang = 'en-US', onFinal }: Options) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  const heard = useRef('')
  const final = useRef(onFinal)
  useEffect(() => {
    final.current = onFinal
  }, [onFinal])

  const start = useCallback(() => {
    const Ctor = ctor()
    if (!Ctor || rec.current) return
    const r = new Ctor()
    r.lang = lang
    r.interimResults = true
    r.continuous = true
    heard.current = ''
    r.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      heard.current = text.trim()
      setInterim(heard.current)
    }
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(MESSAGES[e.error] ?? 'Speech stopped working. Try again.')
    }
    r.onend = () => {
      rec.current = null
      setListening(false)
      setInterim('')
      if (heard.current) final.current(heard.current)
      heard.current = ''
    }
    setError(null)
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      rec.current = null
      setError('Speech is busy. Try again.')
    }
  }, [lang])

  const stop = useCallback(() => rec.current?.stop(), [])

  useEffect(() => () => rec.current?.abort(), [])

  return { start, stop, listening, interim, error, supported: speechSupported() }
}
