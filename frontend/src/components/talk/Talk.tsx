import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { money } from '../../lib/format'
import { gsap, reducedMotion, useGSAP } from '../../lib/motion'
import { linesOf, totalOf } from '../../lib/session'
import { useVoiceOut } from '../../lib/voiceOut'
import { useStore } from '../../state/store'
import { Composer } from './Composer'
import { Thread } from './Thread'

const MUTE_KEY = 'roomify.muted'
const readMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

/** A figure that counts to its new value. */
function Count({ value, currency }: { value: number; currency?: string }) {
  const el = useRef<HTMLSpanElement>(null)
  const shown = useRef(value)
  useGSAP(
    () => {
      if (!el.current) return
      if (reducedMotion()) {
        shown.current = value
        el.current.textContent = money(value, currency)
        return
      }
      const proxy = { v: shown.current }
      gsap.to(proxy, {
        v: value,
        duration: 0.7,
        ease: 'power2.out',
        onUpdate: () => {
          shown.current = proxy.v
          if (el.current) el.current.textContent = money(Math.round(proxy.v * 100) / 100, currency)
        },
      })
    },
    { dependencies: [value, currency] },
  )
  return <span ref={el}>{money(shown.current, currency)}</span>
}

/** The conversation column: the total against the budget, the conversation, and the composer. */
export function Talk() {
  const { active: s } = useStore()
  const voice = useVoiceOut()
  const [muted, setMuted] = useState(readMuted)
  const total = totalOf(s)
  const over = total > s.budgetEur
  const lines = linesOf(s)

  // Read new replies aloud, never the history of a room just opened.
  const seen = useRef<{ id: string; count: number }>({ id: s.id, count: lines.length })
  useEffect(() => {
    if (seen.current.id !== s.id) {
      seen.current = { id: s.id, count: lines.length }
      voice.stop()
      return
    }
    const fresh = lines.slice(seen.current.count)
    seen.current.count = lines.length
    const last = fresh.filter((l) => l.role === 'agent').at(-1)
    if (last && !muted) voice.say(`${s.id}:${lines.lastIndexOf(last)}`, last.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to new lines only
  }, [s.id, lines.length])

  const toggle = () => {
    const next = !muted
    setMuted(next)
    if (next) voice.stop()
    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0')
    } catch {
      /* the choice just isn't remembered */
    }
  }

  return (
    <aside aria-label="Conversation with Roomify" className="flex h-full min-h-0 flex-col rounded-board border border-border bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-rule px-5 pt-4 pb-4">
        {s.products.length ? (
          <div className="min-w-0 flex-1">
            <p className="num text-total font-semibold tracking-[-0.02em] text-ink">
              <Count value={total} currency={s.currency} />
              <span className="ml-1.5 text-body font-normal tracking-normal text-muted">of {money(s.budgetEur, s.currency)}</span>
            </p>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
              <div
                className={`h-full origin-left rounded-full transition-transform duration-700 ease-[var(--ease-out)] ${over ? 'bg-negative' : 'bg-chosen'}`}
                style={{ transform: `scaleX(${Math.min(1, total / Math.max(1, s.budgetEur))})` }}
              />
            </div>
            {over && <p className="mt-1.5 text-chrome text-ink">Over budget by {money(total - s.budgetEur, s.currency)}</p>}
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-title font-semibold tracking-[-0.015em] text-ink">{s.name}</p>
            <p className="num mt-0.5 text-chrome text-muted">{s.status === 'new' ? 'Budget and brief in one sentence' : `Budget ${money(s.budgetEur, s.currency)}`}</p>
          </div>
        )}
        {voice.supported && (
          <button
            type="button"
            onClick={toggle}
            aria-pressed={!muted}
            aria-label={muted ? 'Read replies aloud' : 'Stop reading replies aloud'}
            title={muted ? 'Read replies aloud' : 'Mute replies'}
            className="press -mr-1.5 grid size-9 shrink-0 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
          >
            {muted ? <VolumeX size={18} strokeWidth={2} /> : <Volume2 size={18} strokeWidth={2} />}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-5 [scrollbar-width:thin]">
        <Thread speaking={voice.speaking} spoken={voice.spoken} />
      </div>

      <div className="rounded-b-board bg-surface p-3 max-lg:sticky max-lg:bottom-0">
        <Composer key={s.id} />
      </div>
    </aside>
  )
}
