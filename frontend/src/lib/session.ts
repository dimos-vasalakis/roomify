import type { Session } from '../types'
import { sumEur } from './format'

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
