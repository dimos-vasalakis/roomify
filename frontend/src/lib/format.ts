const formats = new Map<string, Intl.NumberFormat>()
const formatOf = (currency: string) => {
  let f = formats.get(currency)
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-IE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } catch {
      f = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    formats.set(currency, f)
  }
  return f
}

/** €1,234.50 or US$1,234.50, no space after the sign. Prices stay in the shop's own currency. */
export const money = (v: number, currency = 'EUR') => formatOf(currency).format(v).replace(/\s/g, '').replace('US$', '$')

/** +€12.00 / −€12.00 with a real minus sign. */
export const signedMoney = (v: number, currency = 'EUR') => (v < 0 ? `−${money(-v, currency)}` : `+${money(v, currency)}`)

/** Sum of cents, so totals match the rounded figures on screen. */
export const sumEur = (values: number[]) =>
  values.reduce((cents, v) => cents + Math.round(v * 100), 0) / 100

export const size = (w: number | null, d: number | null) =>
  w && d ? `${w} × ${d} cm` : w ? `${w} cm wide` : null

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Shop name from a retailer domain: ikea.gr -> IKEA. */
export const shopName = (retailer: string) =>
  ({ 'ikea.gr': 'IKEA', 'jysk.gr': 'JYSK', 'leroymerlin.gr': 'Leroy Merlin' })[retailer] ?? retailer

const CUT = new Set(['for', 'with', 'under', 'by', 'near', 'that', 'so', 'to', 'in', 'on'])
const TAIL = new Set(['and', 'a', 'an', 'the', 'with', 'for', 'of', 'to', 'in', 'or', 'some', 'maybe'])

/** A room name from the brief, like a chat named after its first message: "Reading chair and a desk". */
export function roomName(prompt: string) {
  let words = prompt.split(/[.;:!?\n]/)[0].trim().split(/\s+/)
  if (words.length > 1 && /^(a|an|the)$/i.test(words[0])) words = words.slice(1)
  // Stop before a phrase like "for long days" or "under the window".
  const cut = words.findIndex((w, i) => i >= 2 && CUT.has(w.toLowerCase().replace(/,+$/, '')))
  words = words.slice(0, cut === -1 ? 6 : Math.min(cut, 6))
  const bare = (w: string) => w.toLowerCase().replace(/[,]+$/, '')
  while (words.length > 1 && TAIL.has(bare(words[words.length - 1]))) words.pop()
  words[words.length - 1] = words[words.length - 1].replace(/,+$/, '')
  const name = words.join(' ')
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'New room'
}
