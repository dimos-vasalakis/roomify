import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'

gsap.registerPlugin(useGSAP, CustomEase)

/** The same curves as the CSS tokens in styles/tokens.css. */
export const EASE_OUT = CustomEase.create('roomify-out', '0.23,1,0.32,1')
export const EASE_IN_OUT = CustomEase.create('roomify-in-out', '0.77,0,0.175,1')

export const DUR = { fast: 0.16, base: 0.24, slow: 0.6 } as const
export const STAGGER = 0.07

export const REDUCED = '(prefers-reduced-motion: reduce)'
export const FULL = '(prefers-reduced-motion: no-preference)'

export const reducedMotion = () => window.matchMedia(REDUCED).matches

type Target = gsap.TweenTarget
type Opts = { y?: number; x?: number; scale?: number; delay?: number; stagger?: number; duration?: number }

/**
 * Bring something into view. Always ends fully visible and clears its inline styles, so an
 * interrupted animation can never leave content hidden. Reduced motion: opacity only, no travel.
 */
export function enter(targets: Target, o: Opts = {}) {
  // Nothing on screen to bring in (an empty room, a ref not attached yet): nothing to do.
  if (!targets || (typeof targets === 'string' ? !document.querySelector(targets) : !gsap.utils.toArray(targets).length)) return
  if (reducedMotion()) {
    return gsap.fromTo(targets, { opacity: 0 }, { opacity: 1, duration: DUR.fast, clearProps: 'opacity' })
  }
  return gsap.fromTo(
    targets,
    { opacity: 0, y: o.y ?? 0, x: o.x ?? 0, scale: o.scale ?? 1 },
    {
      opacity: 1,
      y: 0,
      x: 0,
      scale: 1,
      duration: o.duration ?? DUR.base,
      delay: o.delay ?? 0,
      stagger: o.stagger ?? 0,
      ease: EASE_OUT,
      clearProps: 'opacity,transform',
    },
  )
}

export { gsap, useGSAP }
