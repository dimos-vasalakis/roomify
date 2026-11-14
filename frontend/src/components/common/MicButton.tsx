import { Mic } from 'lucide-react'

type Props = {
  listening: boolean
  supported: boolean
  onStart: () => void
  onStop: () => void
  label?: string
  className?: string
}

/** Click to talk, click again (or pause) to finish. Hidden where the browser cannot listen. */
export function MicButton({ listening, supported, onStart, onStop, label = 'Speak', className = '' }: Props) {
  if (!supported) return null
  return (
    <button
      type="button"
      aria-label={listening ? 'Stop listening' : label}
      aria-pressed={listening}
      title={listening ? 'Stop listening' : label}
      onClick={listening ? onStop : onStart}
      className={`press relative grid size-9 shrink-0 place-items-center rounded-control transition-colors duration-150 ${listening ? 'bg-ink text-surface' : 'bg-secondary text-ink hover:bg-control'} ${className}`}
    >
      <Mic size={16} strokeWidth={1.75} />
      {listening && (
        <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-surface motion-safe:animate-[breathe_1.2s_ease-in-out_infinite]" />
      )}
    </button>
  )
}
