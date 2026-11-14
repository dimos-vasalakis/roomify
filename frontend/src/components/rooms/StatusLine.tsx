import { money } from '../../lib/format'
import { totalOf } from '../../lib/session'
import type { Session } from '../../types'
import { LiveDot } from '../common/LiveDot'

/** The second line of a room in the list: where it stands, in plain words. */
export function StatusLine({ session: s }: { session: Session }) {
  switch (s.status) {
    case 'done':
      return (
        <span className="num text-muted">
          {money(totalOf(s))} of {money(s.budgetEur)}
        </span>
      )
    case 'shopping':
      return (
        <span className="flex items-center gap-1.5 text-ink">
          <LiveDot /> Shopping, {s.products.length} in the basket
        </span>
      )
    case 'drawing':
      return (
        <span className="flex items-center gap-1.5 text-ink">
          <LiveDot /> Drawing your room
        </span>
      )
    case 'asking':
      return <span className="font-medium text-ink">Waiting for your answer</span>
    case 'failed':
      return (
        <span className="flex items-center gap-1.5 text-muted">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-negative" /> Couldn't finish
        </span>
      )
    case 'new':
      return <span className="text-muted">Not started</span>
  }
}
