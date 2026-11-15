import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api/client'
import { API_URL } from '../api/config'

/*
 * Talking to the room. Two listeners, so the mic works in every browser:
 * - the browser's own speech recognition (Chrome, Edge) gives live captions and the fastest answer;
 * - a recording of the same moment goes to the back end (Whisper on fal) whenever the browser's
 *   recogniser is missing or fails: Firefox, Brave, Safari, in-app browsers and phones.
 * Listening ends by itself a moment after you stop talking, or when you let go of Space.
 */

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

const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
const recordingType = () => RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? ''
/** A recording can be sent for transcription: a back end, a recorder and a microphone API. */
const canRecord = () => !!API_URL && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/**
 * Phones and Safari give the microphone to one listener at a time: running the browser's
 * recogniser next to our recorder makes one of them fail. There, the recording alone is used.
 */
const oneListenerOnly = () => {
  const ua = navigator.userAgent
  const phone = /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))
  const safari = /safari/i.test(ua) && !/chrome|chromium|crios|fxios|edg|android/i.test(ua)
  return phone || safari
}

export const speechSupported = () => !!ctor() || canRecord()

const MESSAGES: Record<string, string> = {
  'not-allowed': 'Allow the microphone to talk to the room.',
  'service-not-allowed': 'Allow the microphone to talk to the room.',
  'audio-capture': 'No microphone found.',
  network: 'Speech needs an internet connection.',
}
const NOT_HEARD = "Didn't catch that. Try again, or type it."

/** Quiet this long after speech ends the sentence. */
const SILENCE_MS = 1300
/** A sentence never runs longer than this. */
const MAX_MS = 30_000
/** At least this much sound before silence can end it, so a cough or a click doesn't. */
const SPOKEN_MS = 250
/** The recogniser only (no level meter): this long without new words ends it. */
const WORDLESS_MS = 1800
/** A recording smaller than this holds no speech worth sending. */
const MIN_BYTES = 1500

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type Take = {
  hold: boolean
  startedAt: number
  ending: boolean
  cancelled: boolean
  abort: AbortController
  // The browser's recogniser.
  rec: Recognition | null
  recText: string
  recFailed: string | null
  heardAt: number
  recDone: Promise<void>
  // Our recording, and its level.
  stream: MediaStream | null
  ctx: AudioContext | null
  recorder: MediaRecorder | null
  recorded: Promise<Blob | null>
  micFailed: string | null
  analysed: boolean
  floor: number
  loudMs: number
  loudAt: number
  timer: ReturnType<typeof setInterval> | undefined
}

type Phase = 'idle' | 'listening' | 'transcribing'
type Options = { lang?: string; onFinal: (text: string) => void }

/**
 * Click-to-talk (ends itself when you stop talking) or hold-to-talk (`start({ hold: true })`,
 * ends on `stop()`). `interim` is what has been heard so far, for live captions, and `level`
 * the microphone's loudness 0 to 1 (null when it can't be measured). The sentence goes to `onFinal`.
 */
export function useSpeech({ lang = 'en-US', onFinal }: Options) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const take = useRef<Take | null>(null)
  const level = useRef<number | null>(null)
  const final = useRef(onFinal)
  useEffect(() => {
    final.current = onFinal
  }, [onFinal])

  const release = (t: Take) => {
    clearInterval(t.timer)
    t.stream?.getTracks().forEach((track) => track.stop())
    void t.ctx?.close().catch(() => undefined)
    t.stream = null
    t.ctx = null
    if (take.current === t) level.current = null
  }

  const finish = useCallback(async (t: Take) => {
    if (t.ending || t.cancelled) return
    t.ending = true
    clearInterval(t.timer)
    try {
      t.rec?.stop()
    } catch {
      /* already stopped */
    }
    if (t.recorder && t.recorder.state !== 'inactive') t.recorder.stop()
    // The recogniser hands over its last words just after stopping; don't wait for it forever.
    await Promise.race([t.recDone, wait(1500)])
    const blob = await Promise.race([t.recorded, wait(1500).then(() => null)])
    release(t)
    if (t.cancelled) return

    let text = t.recText
    let problem: string | null = null
    const browserHeard = !!t.recText && !t.recFailed
    // Skip sending a recording the level meter says was silent: Whisper invents words for silence.
    const worthSending = !!blob && blob.size >= MIN_BYTES && (!t.analysed || t.loudMs >= SPOKEN_MS)
    if (!browserHeard && worthSending) {
      if (take.current === t) {
        setPhase('transcribing')
        setInterim('')
      }
      try {
        text = (await api.transcribe(blob, t.abort.signal)).text.trim() || t.recText
      } catch (err) {
        if (t.cancelled) return
        problem = err instanceof ApiError ? err.message : 'Couldn’t hear that. Try again, or type it.'
      }
    }
    if (t.cancelled) return
    if (take.current === t) {
      take.current = null
      setPhase('idle')
      setInterim('')
    }
    if (text) return final.current(text)
    const reason = t.recFailed ?? t.micFailed
    setError(
      (reason && reason !== 'network' && reason !== 'no-speech' && reason !== 'aborted' ? MESSAGES[reason] : null) ??
        (text ? null : problem) ??
        (reason === 'network' && !canRecord() ? MESSAGES.network : NOT_HEARD),
    )
  }, [])

  /** Stop and send what was heard. */
  const stop = useCallback(() => {
    if (take.current) void finish(take.current)
  }, [finish])

  /** Stop and throw away what was heard (Escape, leaving the room). */
  const cancel = useCallback(() => {
    const t = take.current
    if (!t) return
    t.cancelled = true
    t.abort.abort()
    try {
      t.rec?.abort()
    } catch {
      /* already stopped */
    }
    if (t.recorder && t.recorder.state !== 'inactive') t.recorder.stop()
    release(t)
    take.current = null
    setPhase('idle')
    setInterim('')
  }, [])

  const start = useCallback(
    ({ hold = false }: { hold?: boolean } = {}) => {
      if (take.current) return
      const Ctor = ctor()
      const record = canRecord()
      const useRecogniser = !!Ctor && !(record && oneListenerOnly())
      if (!useRecogniser && !record) return setError("Voice isn't available in this browser. Type instead.")

      const t: Take = {
        hold,
        startedAt: performance.now(),
        ending: false,
        cancelled: false,
        abort: new AbortController(),
        rec: null,
        recText: '',
        recFailed: null,
        heardAt: 0,
        recDone: Promise.resolve(),
        stream: null,
        ctx: null,
        recorder: null,
        recorded: Promise.resolve(null),
        micFailed: null,
        analysed: false,
        floor: 0.01,
        loudMs: 0,
        loudAt: 0,
        timer: undefined,
      }
      take.current = t
      level.current = null
      setError(null)
      setInterim('')
      setPhase('listening')

      // The browser's recogniser: started first, inside the click, as Safari and Chrome require.
      if (useRecogniser && Ctor) {
        const r = new Ctor()
        r.lang = lang
        r.interimResults = true
        r.continuous = true
        let done = () => {}
        t.recDone = new Promise<void>((resolve) => (done = resolve))
        r.onresult = (e) => {
          let text = ''
          for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
          t.recText = text.replace(/\s+/g, ' ').trim()
          t.heardAt = performance.now()
          if (take.current === t && !t.ending) setInterim(t.recText)
        }
        r.onerror = (e) => {
          if (e.error !== 'aborted') t.recFailed = e.error
        }
        r.onend = () => {
          t.rec = null
          done()
          // It stopped by itself (its own silence limit, or a failure). With nothing else
          // listening, that is the end of the sentence; otherwise the recording carries on.
          if (!t.ending && !t.cancelled && !t.recorder && !t.stream) void finish(t)
        }
        try {
          r.start()
          t.rec = r
        } catch {
          t.recFailed = 'busy'
          done()
        }
      }

      // Our own recording, which also measures the level and hears the end of the sentence.
      if (record) {
        navigator.mediaDevices
          .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
          .then((stream) => {
            if (t.ending || t.cancelled) return stream.getTracks().forEach((track) => track.stop())
            t.stream = stream
            const type = recordingType()
            const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
            const chunks: Blob[] = []
            recorder.ondataavailable = (e) => void (e.data.size && chunks.push(e.data))
            t.recorded = new Promise((resolve) => {
              recorder.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }) : null)
            })
            recorder.start(250)
            t.recorder = recorder
            try {
              const ctx = new AudioContext()
              t.ctx = ctx
              void ctx.resume().catch(() => undefined)
              const analyser = ctx.createAnalyser()
              analyser.fftSize = 1024
              ctx.createMediaStreamSource(stream).connect(analyser)
              const data = new Uint8Array(analyser.fftSize)
              let last = performance.now()
              t.analysed = true
              clearInterval(t.timer)
              t.timer = setInterval(() => {
                const now = performance.now()
                const dt = now - last
                last = now
                analyser.getByteTimeDomainData(data)
                let sum = 0
                for (const v of data) sum += ((v - 128) / 128) ** 2
                const rms = Math.sqrt(sum / data.length)
                // The room's own hum, followed slowly; speech is well above it.
                t.floor = rms < t.floor ? rms : t.floor + (rms - t.floor) * 0.01
                if (take.current === t) level.current = Math.min(1, rms * 6)
                if (rms > Math.max(0.02, t.floor * 2.5)) {
                  t.loudMs += dt
                  t.loudAt = now
                }
                check(t, now)
              }, 50)
            } catch {
              t.analysed = false
            }
          })
          .catch((err: unknown) => {
            const name = err instanceof DOMException ? err.name : ''
            t.micFailed = name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : name === 'NotFoundError' ? 'audio-capture' : 'mic'
            // The recogniser may still be listening; if not, there is nothing left to hear with.
            if (!t.rec) void finish(t)
          })
      }

      // Without a level meter, the recogniser's words decide when the sentence is over.
      t.timer = setInterval(() => check(t, performance.now()), 100)

      function check(take: Take, now: number) {
        if (take.ending || take.cancelled) return
        if (now - take.startedAt > MAX_MS) return void finish(take)
        if (take.hold) return
        if (take.analysed) {
          const lastSound = Math.max(take.loudAt, take.heardAt)
          if (take.loudMs >= SPOKEN_MS && now - lastSound > SILENCE_MS) void finish(take)
        } else if (take.recText && now - take.heardAt > WORDLESS_MS) void finish(take)
      }
    },
    [lang, finish],
  )

  useEffect(() => cancel, [cancel])

  return {
    start,
    stop,
    cancel,
    listening: phase === 'listening',
    transcribing: phase === 'transcribing',
    interim,
    error,
    level,
    supported: speechSupported(),
  }
}
