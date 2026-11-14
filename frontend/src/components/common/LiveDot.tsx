/** A small ink dot that breathes while the agent is working. Static under reduced motion. */
export function LiveDot({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-1.5 shrink-0 rounded-full bg-ink motion-safe:animate-[breathe_1.6s_ease-in-out_infinite] ${className}`}
    />
  )
}
