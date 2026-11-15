import { BRAND } from '../../brand'

/** The product mark: a room outline left open at one corner, with one placed piece. */
export function Mark({ withName = true }: { withName?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M31 15 13 27.5V53h38V35" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="miter" />
        <circle cx="45" cy="19" r="8" className="fill-chosen" />
      </svg>
      {withName && <span className="text-body font-semibold tracking-[-0.01em]">{BRAND.name}</span>}
    </span>
  )
}
