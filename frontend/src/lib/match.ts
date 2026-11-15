import type { Product } from '../types'

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'for', 'to', 'of', 'in', 'on', 'it', 'this', 'that', 'make', 'get', 'give',
  'me', 'i', 'want', 'please', 'can', 'you', 'more', 'less', 'some', 'one', 'set', 'pair',
])

/** Lower case, accents off (Greek too), split into words, plurals folded. */
const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))

/**
 * Which product a spoken sentence is about: "make the lamp warmer" -> the Lamp.
 * The slot name counts most, then words of the title. Null when nothing is named.
 */
export function productNamed(sentence: string, products: Product[]): Product | null {
  const said = new Set(words(sentence))
  let best: Product | null = null
  let bestScore = 0
  for (const p of products) {
    const slot = words(p.slot)
    const title = words(p.title).filter((w) => w.length > 3)
    const score = slot.filter((w) => said.has(w)).length * 3 + title.filter((w) => said.has(w)).length
    if (score > bestScore) {
      best = p
      bestScore = score
    }
  }
  return best
}

/** The sentence as an instruction: trimmed, first letter capital. */
export const instructionOf = (sentence: string) => {
  const t = sentence.trim().replace(/\s+/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** "160", "160 cm", "1.6 m", "3,2m", "3 μέτρα" → centimetres; null when it isn't a width. */
export const widthIn = (text: string): number | null => {
  const m = text.trim().match(/^\D*?(\d+(?:[.,]\d+)?)\s*(cm|εκ\.?|m\b|μ\b|meters?|metres?|μέτρα)?\D*$/i)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  const metres = m[2] ? /^(m|μ|met|μέτ)/i.test(m[2]) : n < 10
  const cm = Math.round(metres ? n * 100 : n)
  return cm >= 40 && cm <= 3000 ? cm : null
}

