import { BRAND } from '../../brand'

/** The product mark: a room corner in plan (two walls meeting) with one chosen dot. */
export function Mark() {
  return (
    <span className="flex items-center gap-2">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 17V3h14" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="3" className="fill-chosen" />
      </svg>
      <span className="text-[1rem] font-medium leading-6">{BRAND.name}</span>
    </span>
  )
}
