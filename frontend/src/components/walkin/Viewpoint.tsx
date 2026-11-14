import type { Point } from '../../types'

type Props = { at: Point; aimDeg: number; ghost?: boolean; small?: boolean }

const R = 56
const HALF = 30 // half the field of view, degrees

const wedge = () => {
  const rad = (d: number) => (d * Math.PI) / 180
  const x1 = 60 + R * Math.sin(rad(-HALF))
  const y1 = 60 - R * Math.cos(rad(-HALF))
  const x2 = 60 + R * Math.sin(rad(HALF))
  const y2 = 60 - R * Math.cos(rad(HALF))
  return `M60 60L${x1.toFixed(2)} ${y1.toFixed(2)}A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`
}
const WEDGE = wedge()

/** Where the camera stands and which way it looks: a dot with a field-of-view cone. */
export function Viewpoint({ at, aimDeg, ghost = false, small = false }: Props) {
  const size = small ? 72 : 120
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 overflow-visible ${ghost ? 'opacity-60' : ''}`}
      style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
    >
      <g transform={`rotate(${aimDeg} 60 60)`}>
        <path d={WEDGE} fill="#fff" fillOpacity={small ? 0.22 : 0.32} stroke="#fff" strokeWidth="3" />
        <path d={WEDGE} fill="none" stroke="#171717" strokeWidth="1.25" />
      </g>
      <circle cx="60" cy="60" r={small ? 6 : 8} fill="#fff" />
      <circle cx="60" cy="60" r={small ? 3.5 : 5} fill="#171717" />
    </svg>
  )
}
