import { BRAND } from '../../brand'

/** The product mark: a room outline left open at one corner, where the agent's spark sits. */
export function Mark() {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M31 15 13 27.5V53h38V35" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="miter" />
        <path d="M45 7Q47.2 16.8 57 19Q47.2 21.2 45 31Q42.8 21.2 33 19Q42.8 16.8 45 7Z" className="fill-chosen" />
      </svg>
      <span className="text-[1rem] font-medium leading-6">{BRAND.name}</span>
    </span>
  )
}
