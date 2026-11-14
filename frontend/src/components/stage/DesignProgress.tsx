import { Check } from 'lucide-react'
import { useStore } from '../../state/store'

const steps = ['Read the room', 'Find the pieces', 'Create the preview']

export function DesignProgress() {
  const { active: s } = useStore()
  const current = s.phase === 'planning' ? 0 : s.phase === 'rendering' || s.phase === 'checking' ? 2 : 1
  return (
    <div className="border-t border-rule bg-surface p-4" aria-label="Design progress">
      <ol className="grid grid-cols-3 gap-3">
        {steps.map((step, i) => <li key={step} aria-current={i === current ? 'step' : undefined} className={`flex items-start gap-2 text-small sm:text-chrome ${i > current ? 'text-muted' : 'text-ink'}`}>
          <span className={`grid size-5 shrink-0 place-items-center rounded-full ${i < current ? 'bg-chosen text-surface' : i === current ? 'bg-ink text-surface' : 'bg-raised text-muted'}`}>{i < current ? <Check size={12} strokeWidth={2} /> : i + 1}</span>
          <span className={i === current ? 'font-medium' : ''}>{step}</span>
        </li>)}
      </ol>
      <p className="mt-3 text-chrome text-muted" role="status">{s.now?.text ?? 'Starting your design…'}</p>
    </div>
  )
}
