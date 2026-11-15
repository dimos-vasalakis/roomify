/**
 * A depth map read into a grid, cleaned for building geometry: the 8-bit steps smoothed out,
 * and the blurred outlines of objects snapped to one side or the other.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export function pixels(img: HTMLImageElement, w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Nearness 0 (far) to 1 (near) at each grid point. Depth Anything gives relative inverse depth:
 * the darkest and brightest few percent are clipped so one stray pixel can't flatten the room.
 */
export function readNearness(depth: HTMLImageElement, w: number, h: number) {
  const px = pixels(depth, w, h).data
  const raw = new Float32Array(w * h)
  for (let i = 0; i < raw.length; i++) raw[i] = px[i * 4] / 255
  const sorted = Float32Array.from(raw).sort()
  const lo = sorted[Math.floor(sorted.length * 0.01)]
  const hi = sorted[Math.floor(sorted.length * 0.995)]
  const span = Math.max(1e-3, hi - lo)
  for (let i = 0; i < raw.length; i++) raw[i] = clamp((raw[i] - lo) / span, 0, 1)
  return raw
}

/** One pass along rows then columns. */
function separable(src: Float32Array, w: number, h: number, pass: (get: (k: number) => number, n: number, out: (k: number, v: number) => void) => void) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) pass((k) => src[y * w + k], w, (k, v) => (tmp[y * w + k] = v))
  for (let x = 0; x < w; x++) pass((k) => tmp[k * w + x], h, (k, v) => (out[k * w + x] = v))
  return out
}

/**
 * Smooths the 8-bit steps out of walls and floors without blurring across a piece's edge: each
 * neighbour counts less the more its nearness differs (a soft weight, so no new steps appear).
 */
export const smoothKeepingEdges = (src: Float32Array, w: number, h: number, r: number, sigma: number) =>
  separable(src, w, h, (get, n, out) => {
    for (let i = 0; i < n; i++) {
      const c = get(i)
      let sum = 0
      let weight = 0
      for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) {
        const v = get(k)
        const d = (v - c) / sigma
        const wt = Math.exp(-d * d) * (1 - Math.abs(k - i) / (r + 1))
        sum += v * wt
        weight += wt
      }
      out(i, sum / weight)
    }
  })

export const extreme = (src: Float32Array, w: number, h: number, r: number) =>
  separable(src, w, h, (get, n, out) => {
    for (let i = 0; i < n; i++) {
      let m = -Infinity
      for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) m = Math.max(m, get(k))
      out(i, m)
    }
  })

/**
 * Depth maps blur a piece's outline into a ramp from the wall to the piece: points floating in
 * mid-air that smear the piece sideways once the camera moves. Where the depth changes a lot in a
 * small neighbourhood, each point is snapped to the nearer or the farther side, whichever is closer.
 */
export function sharpenEdges(src: Float32Array, w: number, h: number, r: number, range: number) {
  const hi = extreme(src, w, h, r)
  const neg = src.map((v) => -v)
  const lo = extreme(neg, w, h, r).map((v) => -v)
  const out = new Float32Array(src.length)
  for (let k = 0; k < src.length; k++) {
    const v = src[k]
    out[k] = hi[k] - lo[k] > range ? (v - lo[k] < hi[k] - v ? lo[k] : hi[k]) : v
  }
  return out
}


