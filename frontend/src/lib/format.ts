const eur = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** €1,234.50, no space after the sign. */
export const money = (v: number) => eur.format(v).replace(/\s/g, '')

/** +€12.00 / −€12.00 with a real minus sign. */
export const signedMoney = (v: number) => (v < 0 ? `−${money(-v)}` : `+${money(v)}`)

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
