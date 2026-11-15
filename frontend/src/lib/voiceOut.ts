import { useCallback, useEffect, useRef, useState } from 'react'

/* Roomify speaks its replies with the browser's own voice. No key, no server. */

const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null)

/** A clear English voice when the browser has one; otherwise the default. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = synth()?.getVoices() ?? []
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  const prefer = ['Samantha', 'Ava', 'Google UK English Female', 'Google US English', 'Serena', 'Daniel', 'Natural']
  for (const name of prefer) {
    const v = en.find((x) => x.name.includes(name))
    if (v) return v
  }
  return en[0] ?? null
}

/**
 * Speak one line at a time. `spoken` is how many characters have been said so far, for the
 * word-by-word caption: from the browser's word boundaries when it sends them, else estimated.
 */
export function useVoiceOut() {
  const [line, setLine] = useState<{ key: string; text: string } | null>(null)
  const [spoken, setSpoken] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    synth()?.cancel()
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    setLine(null)
  }, [])

  const say = useCallback(
    (key: string, text: string) => {
      const s = synth()
      if (!s || !text.trim()) return
      s.cancel()
      if (timer.current) clearInterval(timer.current)
      const u = new SpeechSynthesisUtterance(text)
      const voice = pickVoice()
      if (voice) u.voice = voice
      u.rate = 1.04
      let boundaries = false
      u.onstart = () => {
        setSpoken(0)
        // About 14 characters a second, until real word boundaries arrive.
        const started = Date.now()
        timer.current = setInterval(() => {
          if (!boundaries) setSpoken(Math.min(text.length, Math.round(((Date.now() - started) / 1000) * 14)))
        }, 80)
      }
      u.onboundary = (e) => {
        boundaries = true
        const end = text.indexOf(' ', e.charIndex)
        setSpoken(end === -1 ? text.length : end)
      }
      u.onend = u.onerror = () => {
        if (timer.current) clearInterval(timer.current)
        timer.current = null
        setSpoken(text.length)
        setLine((l) => (l?.key === key ? null : l))
      }
      setLine({ key, text })
      setSpoken(0)
      s.speak(u)
    },
    [],
  )

  useEffect(() => () => stop(), [stop])

  return { say, stop, speaking: line?.key ?? null, spoken, supported: !!synth() }
}
