import { useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import { money, shopName } from './format'
import { isWorking } from './session'

export type TraceKind = 'step' | 'pick' | 'reject' | 'render' | 'done'

/** One thing the agent did, `t` milliseconds into the run. */
export type TraceEntry = { id: number; t: number; kind: TraceKind; verb: string; text: string }

/** The agent's step in one word, read from its own sentence. */
export function verbOf(text: string): string {
  const t = text.toLowerCase()
  if (/search|look(ing)? for|find/.test(t)) return 'Search'
  if (/read|open|page|listing/.test(t)) return 'Read'
  if (/measur|width|wall|fit/.test(t)) return 'Measure'
  if (/draw|render|paint|picture|preview/.test(t)) return 'Render'
  if (/check|verify|match|compar/.test(t)) return 'Check'
  if (/budget|price|cost|total/.test(t)) return 'Budget'
  return 'Think'
}

type Seen = { id: string; now: string | null; picks: Set<string>; rejects: Set<string>; after: string | null; working: boolean }

const seenOf = (s: Session): Seen => ({
  id: s.id,
  now: s.now?.text ?? null,
  picks: new Set(s.products.map((p) => p.id)),
  rejects: new Set(s.rejections.map((r) => r.id)),
  after: s.afterSrc,
  working: isWorking(s),
})

/**
 * The run as a timeline, built on the screen from what the room's state already shows:
 * every new step, piece chosen, piece turned down and render, stamped with the time it arrived.
 * Starts over when a new run starts (or the recorded sample loops).
 */
export function useTrace(s: Session) {
  const [entries, setEntries] = useState<TraceEntry[]>([])
  const [t0, setT0] = useState<number | null>(() => (isWorking(s) ? s.now?.startedAt ?? Date.now() : null))
  const [t1, setT1] = useState<number | null>(null)
  const seen = useRef<Seen | null>(null)
  const next = useRef(1)

  useEffect(() => {
    const prev = seen.current
    const cur = seenOf(s)
    seen.current = cur
    const restart = !prev || prev.id !== s.id || (cur.working && !prev.working) || (cur.working && cur.picks.size < prev.picks.size)
    const start = restart ? (cur.working ? Date.now() : null) : t0
    const at = () => (start ? Date.now() - start : 0)
    const add: TraceEntry[] = []
    const push = (kind: TraceKind, verb: string, text: string) => add.push({ id: next.current++, t: at(), kind, verb, text })

    if (restart) {
      setT0(start)
      setT1(null)
      if (cur.working && cur.now) push('step', verbOf(cur.now), cur.now)
      setEntries(add)
      return
    }
    if (!cur.working && !prev.working) return

    if (cur.now && cur.now !== prev.now) push('step', verbOf(cur.now), cur.now)
    for (const r of s.rejections) if (!prev.rejects.has(r.id)) push('reject', 'Reject', `${r.slot} · ${shopName(r.retailer)} — ${r.reason}`)
    for (const p of s.products)
      if (!prev.picks.has(p.id)) push('pick', 'Pick', `${p.slot} · ${shopName(p.retailer)} · ${money(p.priceEur, p.currency ?? s.currency)}`)
    if (cur.after && cur.after !== prev.after) push('render', 'Render', 'Your room, with exactly these pieces')
    if (prev.working && !cur.working) {
      push('done', s.status === 'failed' ? 'Stop' : 'Done', s.status === 'failed' ? (s.error?.what ?? "Couldn't finish") : 'Ready to look at')
      setT1(Date.now())
    }
    if (add.length) setEntries((e) => [...e, ...add].slice(-60))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fold each change of the room in once
  }, [s])

  // Counts come from the room itself, so a run opened half-way still adds up.
  return {
    entries,
    t0,
    t1,
    picked: s.products.length,
    rejected: s.rejections.length,
    looked: s.products.length + s.rejections.length,
  }
}

/** 0:07.4 */
export const stamp = (ms: number) => {
  const s = Math.max(0, ms) / 1000
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}
