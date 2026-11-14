import { useStore, type Block } from '../../state/store'

/** An error that belongs to one block of the screen, for the room that is open. */
export function BlockError({ block, className = '' }: { block: Block; className?: string }) {
  const { state, active } = useStore()
  const error = state.errors[block]
  if (!error || (error.sessionId && error.sessionId !== active.id)) return null
  return (
    <p role="alert" className={`flex gap-2 text-chrome text-ink ${className}`}>
      <span aria-hidden="true" className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-negative" />
      <span>{error.message}</span>
    </p>
  )
}
