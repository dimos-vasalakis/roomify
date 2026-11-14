import { useState } from 'react'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { instructionOf } from '../../lib/match'
import { useSpeech } from '../../lib/speech'
import { BlockError } from '../common/BlockError'
import { MicButton } from '../common/MicButton'

/** First run: what the room needs, the budget and the city. */
export function StartForm() {
  const { active: s } = useStore()
  const actions = useActions()
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState(s.prompt)
  const [budget, setBudget] = useState(String(s.budgetEur))
  const [city, setCity] = useState(s.city)
  const [wall, setWall] = useState(s.wallCm ? String(s.wallCm) : '')
  const speech = useSpeech({ onFinal: (said) => setPrompt((p) => (p.trim() ? `${p.trim()} ${said}` : instructionOf(said))) })
  const b = Number(budget)
  const ready = !!s.beforeSrc && prompt.trim().length > 3 && b >= 20

  const field = 'w-full rounded-control border border-control bg-surface px-3 text-body placeholder:text-muted focus:border-ink focus:outline-none'

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready || busy) return
        setBusy(true)
        void actions.startRun(prompt.trim(), b, city, Number(wall) >= 40 ? Number(wall) : null).finally(() => setBusy(false))
      }}
    >
      <p className="text-chrome leading-6 text-muted">Your photo, a few words, a room that feels like you.</p>
      <div>
        <label htmlFor="need" className="mb-1.5 block text-chrome font-medium">
          What does the room need?
        </label>
        <div className="relative">
          <textarea
            id="need"
            maxLength={1500}
            rows={4}
            value={speech.listening ? `${prompt}${prompt && speech.interim ? ' ' : ''}${speech.interim}` : prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={speech.listening ? 'Listening…' : 'A calm work corner. A wood desk and a comfortable chair. Warm, minimal, no gaming furniture.'}
            className={`${field} resize-none py-2.5 pr-12 leading-6`}
          />
          <div className="absolute right-2 bottom-2"><MicButton
            listening={speech.listening}
            supported={speech.supported}
            onStart={speech.start}
            onStop={speech.stop}
            label="Say what the room needs"
          /></div>
        </div>
        {speech.error && <p className="mt-1.5 text-chrome text-ink">{speech.error}</p>}
      </div>
      {!prompt && <div className="flex flex-wrap gap-2">
        {[
          ['Work corner', 'A calm work corner with a wood desk and a comfortable office chair. Warm neutral colours, no gaming furniture.'],
          ['Reading nook', 'A cosy reading nook with an armchair and a floor lamp. Warm light, natural materials.'],
          ['Living room', 'A relaxed living room with a sofa, coffee table and rug. Natural colours and simple shapes.'],
        ].map(([label, brief]) => <button key={label} type="button" onClick={() => setPrompt(brief)} className="press min-h-control rounded-control bg-raised px-3 text-small text-ink hover:bg-active">{label}</button>)}
      </div>}
      <div>
        <div>
          <label htmlFor="budget" className="mb-1.5 block text-chrome font-medium">
            Budget
          </label>
          <div className="flex h-10 items-center rounded-control border border-control bg-surface pl-3 focus-within:border-ink">
            <span className="text-body text-muted">€</span>
            <input
              id="budget"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))}
              className="num h-full min-w-0 flex-1 bg-transparent px-1.5 text-body focus:outline-none"
            />
          </div>
        </div>
      </div>
      <details className="text-chrome">
        <summary className="cursor-pointer py-1 font-medium text-muted hover:text-ink">Room details <span className="font-normal">· optional</span></summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="wall" className="mb-1.5 block text-chrome font-medium">
            Wall width
          </label>
          <div className="flex h-10 items-center rounded-control border border-control bg-surface pr-3 focus-within:border-ink">
            <input
              id="wall"
              inputMode="numeric"
              value={wall}
              onChange={(e) => setWall(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
              placeholder="140"
              className="num h-full min-w-0 flex-1 bg-transparent px-3 text-body placeholder:text-muted focus:outline-none"
            />
            <span className="text-chrome text-muted">cm</span>
          </div>
        </div>
        <div>
          <label htmlFor="city" className="mb-1.5 block text-chrome font-medium">
            City
          </label>
          <input id="city" value={city} onChange={(e) => setCity(e.target.value)} className={`${field} h-10`} />
        </div>
        </div>
      </details>
      <button
        type="submit"
        disabled={!ready || busy}
        className="press h-11 rounded-control bg-primary text-body font-medium text-surface disabled:bg-secondary disabled:text-muted"
      >
        {busy ? 'Starting your design…' : s.afterSrc ? 'Create updated room' : 'Create my room'}
      </button>
      <BlockError block="start" />
      {!s.beforeSrc && <p className="-mt-2 text-chrome text-muted">Add a photo of the room first.</p>}
      <p className="text-chrome text-muted">
        Real products from Greek shops. One room preview and a shopping list within your budget.
      </p>
    </form>
  )
}
