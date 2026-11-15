import { useStore } from '../../state/store'
import { BlockError } from '../common/BlockError'

/** The last few lines between the person and the agent, under the room like a chat. */
export function ChatThread() {
  const { active: s } = useStore()
  const lines = (s.chat ?? []).slice(-6)
  // Before the first answer the brief form shows any error itself.
  if (!lines.length || s.status === 'new') return null
  return (
    <section aria-label="Conversation with Roomify" aria-live="polite" className="flex flex-col gap-2">
      {lines.map((line, i) => (
        <p
          key={`${i}-${line.text.slice(0, 12)}`}
          className={
            line.role === 'user'
              ? 'max-w-[85%] self-end rounded-card bg-raised px-3 py-2 text-body text-ink'
              : 'max-w-[85%] self-start text-body leading-6 text-ink'
          }
        >
          {line.role === 'agent' && <span className="mr-2 text-chrome font-medium text-muted">Roomify</span>}
          {line.text}
        </p>
      ))}
      <BlockError block="start" />
    </section>
  )
}
