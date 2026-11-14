import { ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { useActions } from '../../state/actions'
import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'

export function RefineRoom() {
  const { active: s } = useStore()
  const actions = useActions()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form className="rounded-panel border border-border bg-surface p-4" onSubmit={(e) => {
      e.preventDefault()
      if (!text.trim() || busy) return
      setBusy(true)
      void actions.startRun(`${s.prompt}\nUpdate the design: ${text.trim()}`.slice(0, 2000), s.budgetEur, s.city, s.wallCm).finally(() => setBusy(false))
    }}>
      <label htmlFor="refine-room" className="block text-chrome font-medium">Make it more you</label>
      <div className="mt-2 flex items-center gap-3">
        <input id="refine-room" value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder="Warmer wood, a softer chair, less clutter…" className="h-row min-w-0 flex-1 bg-transparent text-body placeholder:text-muted focus:outline-none" />
        <button type="submit" disabled={!text.trim() || busy} aria-label="Update the room" className="press grid size-row shrink-0 place-items-center rounded-control bg-primary text-surface disabled:bg-secondary disabled:text-muted"><ArrowUp size={20} strokeWidth={1.75} /></button>
      </div>
      <p className="mt-2 text-small text-muted">The room and shopping list update together.</p>
      <BlockError block="start" className="mt-2" />
    </form>
  )
}
