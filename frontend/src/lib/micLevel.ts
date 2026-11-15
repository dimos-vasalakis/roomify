import { useEffect, useRef, type RefObject } from 'react'

/**
 * The microphone's live level, written straight into a set of bars (no React re-renders).
 * `level` is read every frame (0 to 1); while it is null the bars breathe quietly instead.
 */
export function useMicBars(active: boolean, count: number, level: RefObject<number | null>) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (!active) return
    let raf = 0
    let frame = 0
    let t = 0
    const levels = new Array(count).fill(0.08)
    const tick = () => {
      // One new bar every third frame keeps the wave readable.
      if (frame++ % 3 === 0) {
        levels.shift()
        const v = level.current
        levels.push(v === null ? 0.15 + 0.1 * Math.sin((t += 0.45)) : v)
        bars.current.forEach((el, i) => {
          if (el) el.style.transform = `scaleY(${Math.max(0.08, Math.min(1, levels[i]))})`
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, count, level])

  return bars
}
