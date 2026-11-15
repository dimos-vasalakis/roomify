import { useEffect, useRef } from 'react'

/**
 * The microphone's live level, written straight into a set of bars (no React re-renders).
 * Falls back to a quiet idle motion when the browser won't share the microphone.
 */
export function useMicBars(active: boolean, count: number) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (!active) return
    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let stopped = false
    const levels = new Array(count).fill(0.08)

    const draw = (read: () => number) => {
      const tick = () => {
        if (stopped) return
        levels.shift()
        levels.push(read())
        bars.current.forEach((el, i) => {
          if (el) el.style.transform = `scaleY(${Math.max(0.08, Math.min(1, levels[i]))})`
        })
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(s).connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        let frame = 0
        let last = 0.08
        draw(() => {
          // One new bar every third frame keeps the wave readable.
          if (frame++ % 3) return last
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (const v of data) sum += ((v - 128) / 128) ** 2
          last = Math.min(1, Math.sqrt(sum / data.length) * 5)
          return last
        })
      })
      .catch(() => {
        let t = 0
        draw(() => 0.15 + 0.1 * Math.sin((t += 0.15)))
      })

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [active, count])

  return bars
}
