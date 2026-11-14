import { money } from '../../lib/format'
import { totalOf } from '../../lib/session'
import { useStore } from '../../state/store'

export function MobileTotal() {
  const { active: s } = useStore()
  if (s.status !== 'done') return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 xl:hidden">
      <p className="num text-body font-bold">{money(totalOf(s))}<span className="ml-2 text-small font-normal text-muted">of {money(s.budgetEur)}</span></p>
      <a href="#shopping-list" className="press inline-flex h-row items-center rounded-control bg-primary px-4 text-chrome font-medium text-surface">Shop {s.products.length} {s.products.length === 1 ? 'piece' : 'pieces'}</a>
    </div>
  )
}
