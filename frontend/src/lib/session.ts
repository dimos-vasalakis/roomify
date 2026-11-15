import type { ChatLine, Session } from '../types'
import { money, shopName, sumEur } from './format'

export const totalOf = (s: Session) => sumEur(s.products.map((p) => p.priceEur))

export const shopsOf = (s: Session) => new Set(s.products.map((p) => p.retailer)).size

/** Slots in the order the agent filled them, then slots that only have rejections. */
export const slotsOf = (s: Session) => {
  const order: string[] = []
  for (const p of s.products) if (!order.includes(p.slot)) order.push(p.slot)
  for (const r of s.rejections) if (!order.includes(r.slot)) order.push(r.slot)
  return order
}

export const isWorking = (s: Session) => s.status === 'shopping' || s.status === 'drawing'

/** The room picture to show: the render once it exists, otherwise the user's photo. */
export const pictureOf = (s: Session) => s.afterSrc ?? s.beforeSrc

export type Phase = 'planning' | 'shopping' | 'rendering' | 'checking'

export const PHASES: { id: Phase; label: string }[] = [
  { id: 'planning', label: 'Reading your room' },
  { id: 'shopping', label: 'Finding pieces' },
  { id: 'rendering', label: 'Drawing your room' },
  { id: 'checking', label: 'Checking it matches' },
]

/** Which of the four steps the agent is on, from the run's own phase and status. Null when idle. */
export function phaseOf(s: Session): Phase | null {
  if (s.status === 'drawing') return s.phase === 'checking' ? 'checking' : 'rendering'
  if (s.status !== 'shopping') return null
  if (s.phase === 'rendering' || s.phase === 'checking') return s.phase
  return s.phase === 'shopping' || s.products.length || s.rejections.length ? 'shopping' : 'planning'
}

/** Where a room stands, in plain words, for the rail and the rooms list. */
export function statusText(s: Session): string {
  switch (s.status) {
    case 'done':
      return s.products.length ? `${s.products.length} ${s.products.length === 1 ? 'piece' : 'pieces'} · ${shopsOf(s)} ${shopsOf(s) === 1 ? 'shop' : 'shops'}` : 'Done'
    case 'shopping':
    case 'drawing':
      return PHASES.find((p) => p.id === phaseOf(s))?.label ?? 'Working'
    case 'asking':
      return 'Waiting for your answer'
    case 'failed':
      return "Couldn't finish"
    default:
      return s.beforeSrc ? 'Photo added' : 'Not started'
  }
}

/** Ask the composer to take this text and focus (used by a pin's Swap). */
export const compose = (text: string) => window.dispatchEvent(new CustomEvent('roomify:compose', { detail: text }))

/** The lines of a room's conversation. Recorded rooms without one show their brief and outcome. */
export function linesOf(s: Session): ChatLine[] {
  if (s.chat?.length) return s.chat
  const lines: ChatLine[] = []
  if (s.prompt) lines.push({ role: 'user', text: s.prompt })
  if (s.wallCm && s.status !== 'asking') lines.push({ role: 'user', text: `The wall is ${s.wallCm} cm.` })
  if (s.status === 'done' && s.products.length) {
    const cur = s.currency
    const shops = [...new Set(s.products.map((p) => shopName(p.retailer)))]
    lines.push({
      role: 'agent',
      text: `Done. ${s.products.length} pieces from ${shops.join(', ')}, ${money(totalOf(s), cur)} of your ${money(s.budgetEur, cur)}. Tap a pin to see a piece, or tell me what to change.`,
    })
  }
  return lines
}

