import { useRef, useState } from 'react'
import { EASE_IN_OUT, EASE_OUT, gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { useStore } from '../../state/store'

const PHASES = ['Reading your room', 'Placing what it chose'] as const

/**
 * The moment: your photo, a line reads the room, then the furnished room wipes in across it
 * and the chosen products land one by one. Plays the first time a finished room opens, and on Replay.
 */
export function Reveal({ before, after, revealKey }: { before: string; after: string; revealKey: number }) {
  const { dispatch } = useStore()
  const root = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<number>(0)

  useGSAP(
    () => {
      const room = root.current?.parentElement
      const dots = room?.querySelectorAll('[data-dot]') ?? []
      const done = () => {
        gsap.set(dots, { clearProps: 'opacity,transform' })
        setTimeout(() => gsap.set(dots, { clearProps: 'transition' }), 50)
        dispatch({ type: 'revealDone' })
      }
      // Safety net: if animation frames stall (a throttled tab), jump to the finished room.
      const finishLate = (tl: gsap.core.Timeline) => {
        const t = setTimeout(() => tl.progress(1), 6000)
        return () => clearTimeout(t)
      }
      if (reducedMotion() || document.hidden) {
        const tl = gsap.timeline({ onComplete: done })
        tl.fromTo('[data-after]', { opacity: 0 }, { opacity: 1, duration: 0.4 })
        if (dots.length) tl.fromTo(dots, { opacity: 0 }, { opacity: 1, duration: 0.3 })
        return finishLate(tl)
      }
      const tl = gsap.timeline({ onComplete: done })
      // The dots' own CSS transition would fade them out visibly; switch it off while hidden.
      gsap.set(dots, { opacity: 0, scale: 0.4, transition: 'none' })
      tl.set('[data-after]', { clipPath: 'inset(0 100% 0 0)' })
        .call(() => setPhase(0))
        .fromTo('[data-plate]', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: EASE_OUT })
        .fromTo('[data-scan]', { yPercent: 0, opacity: 1 }, { yPercent: 100, duration: 1.1, ease: 'power1.inOut' }, '<')
        .to('[data-scan]', { opacity: 0, duration: 0.15 })
        .call(() => setPhase(1))
        .to('[data-after]', { clipPath: 'inset(0 0% 0 0)', duration: 1.25, ease: EASE_IN_OUT }, '-=0.1')
        .fromTo('[data-edge]', { xPercent: 0, opacity: 1 }, { xPercent: 100, duration: 1.25, ease: EASE_IN_OUT }, '<')
        .to('[data-edge]', { opacity: 0, duration: 0.2 })
      if (dots.length) tl.to(dots, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2.2)', stagger: 0.12 }, '-=0.15')
      tl.to('[data-plate]', { opacity: 0, duration: 0.25 }, '+=0.2')
      return finishLate(tl)
    },
    { scope: root, dependencies: [revealKey] },
  )

  return (
    <div ref={root} className="pointer-events-none absolute inset-0" aria-hidden="true">
      <img src={before} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
      <img data-after src={after} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
      <div data-scan className="absolute inset-0 opacity-0">
        <span className="absolute inset-x-0 top-0 h-0.5 bg-surface" />
        <span className="absolute inset-x-0 top-0 h-16 -translate-y-full bg-surface/15" />
      </div>
      <div data-edge className="absolute inset-0 opacity-0">
        <span className="absolute inset-y-0 left-0 w-0.5 bg-surface" />
      </div>
      <p data-plate className="absolute top-3 left-3 flex items-center gap-2 rounded-[6px] bg-surface px-2.5 py-1 text-chrome font-medium opacity-0">
        <span className="size-1.5 rounded-full bg-chosen motion-safe:animate-[breathe_1.2s_ease-in-out_infinite]" />
        {PHASES[phase]}
      </p>
    </div>
  )
}
