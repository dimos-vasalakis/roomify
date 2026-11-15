import { isWorking } from '../../lib/session'
import { useStore } from '../../state/store'

const dots = (alpha: number) => `radial-gradient(circle at center, rgb(23 23 23 / ${alpha}) 1px, transparent 1.5px)`
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

/**
 * The paper the board sits on: a drafting-table dot grid that fades toward the edges, a little
 * grain, and, only while the agent works, a band that passes over the grid and darkens its dots.
 */
export function Backdrop() {
  const { active } = useStore()
  const working = isWorking(active)
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: dots(0.11), backgroundSize: '24px 24px', maskImage: 'radial-gradient(ellipse 85% 75% at 50% 45%, #000 35%, transparent 100%)' }}
      />
      {working && (
        <div
          className="absolute inset-y-0 left-0 w-[40vw] motion-safe:animate-[field_6s_linear_infinite] motion-reduce:hidden"
          style={{ backgroundImage: dots(0.38), backgroundSize: '24px 24px', maskImage: 'linear-gradient(90deg, transparent, #000 50%, transparent)' }}
        />
      )}
      <div className="absolute inset-0 opacity-[0.06] mix-blend-multiply" style={{ backgroundImage: GRAIN }} />
    </div>
  )
}
