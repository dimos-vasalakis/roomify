import { ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { useSpeech } from '../../lib/speech'
import { BlockError } from '../common/BlockError'
import { MicButton } from '../common/MicButton'

/** The one question the agent cannot answer from the photo. */
export function AskCard() {
  const { active: s } = useStore()
  const actions = useActions()
  const [value, setValue] = useState(s.ask?.suggestion ? String(Math.round(s.ask.suggestion)) : '')
  const speech = useSpeech({ onFinal: (said) => setValue(said.replace(/[^\d]/g, '').slice(0, 4)) })
  if (!s.ask) return null
  const n = Number(value)
  const ok = Number.isFinite(n) && n >= 40 && n <= 2000

  return (
    <form
      className="rounded-card bg-raised p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) void actions.answer(Math.round(n))
      }}
    >
      <p className="text-small text-muted">The agent needs one thing</p>
      <label htmlFor="ask" className="mt-1 block text-body font-medium text-ink">
        {s.ask.question}
      </label>
      <p className="mt-1 text-chrome text-muted">
        {s.ask.suggestion ? 'That is its estimate from the photo. Send it if it looks right, or correct it.' : 'So nothing it picks is too big for the space. A tape measure or a guess both work.'}
      </p>
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
        <MicButton listening={speech.listening} supported={speech.supported} onStart={speech.start} onStop={speech.stop} label="Say the width" className="size-10!" />
        <button
          type="submit"
          disabled={!ok}
          aria-label="Send"
          className="press grid size-10 place-items-center rounded-control bg-primary text-surface disabled:bg-secondary disabled:text-muted"
        >
          <ArrowUp size={16} strokeWidth={2} />
        </button>
      </div>
      {s.offer && (
        <button type="button" onClick={() => void actions.talk("Skip, I don't know the size")} className="press mt-3 text-chrome text-muted underline underline-offset-4 hover:text-ink">
          Skip, design without it
        </button>
      )}
      <BlockError block="ask" className="mt-3" />
    </form>
  )
}
