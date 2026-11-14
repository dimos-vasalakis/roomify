import { ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../state/store'

/** The one question the agent cannot answer from the photo. */
export function AskCard() {
  const { active: s, dispatch } = useStore()
  const [value, setValue] = useState('')
  if (!s.ask) return null
  const n = Number(value)
  const ok = Number.isFinite(n) && n >= 40 && n <= 2000

  return (
    <form
      className="rounded-card bg-raised p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) dispatch({ type: 'answer', value: Math.round(n) })
      }}
    >
      <p className="text-small text-muted">The agent needs one thing</p>
      <label htmlFor="ask" className="mt-1 block text-body font-medium text-ink">
        {s.ask.question}
      </label>
      <p className="mt-1 text-chrome text-muted">So nothing it picks is too big for the space. A tape measure or a guess both work.</p>
      <div className="mt-3 flex gap-1.5">
        <div className="flex h-10 flex-1 items-center rounded-control border border-control bg-surface pr-3 focus-within:border-ink">
          <input
            id="ask"
            inputMode="numeric"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="160"
            className="num h-full min-w-0 flex-1 bg-transparent px-3 text-body placeholder:text-muted focus:outline-none"
          />
          <span className="text-chrome text-muted">{s.ask.unit}</span>
        </div>
        <button
          type="submit"
          disabled={!ok}
          aria-label="Send"
          className="press grid size-10 place-items-center rounded-control bg-primary text-surface disabled:bg-secondary disabled:text-muted"
        >
          <ArrowUp size={16} strokeWidth={2} />
        </button>
      </div>
    </form>
  )
}
