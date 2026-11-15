/**
 * The room itself as real geometry: a floor and four walls, sized from the photo's depth, with the
 * photo baked onto every surface where the photo saw it. Seen from anywhere, not only from where
 * the photo was taken.
 *
 * - Depth Anything gives nearness up to an unknown scale and offset. The offset is picked so the
 *   floor and the main wall come out flattest; the scale is metres from where people hold a phone
 *   and the listed heights of the pieces.
 * - Walls are straight lines in the plan of everything above furniture height. The room is the
 *   rectangle they make (rooms are rectangles); a wall the photo never saw closes it.
 * - Each surface is painted texel by texel from the photo, but only where the photo's depth agrees
 *   that the surface is what the camera saw there. What it didn't see (behind a sofa, the wall
 *   behind the camera) is filled smoothly from the colours around it, never smeared.
 */
import * as THREE from 'three'
import { pixels, readNearness, sharpenEdges, smoothKeepingEdges } from './depthGrid'

const PHONE_VFOV = 50 // a phone's main camera, landscape: when the room wasn't measured
export const RAD = Math.PI / 180
const CAMERA_HEIGHT_M = 1.45 // where people hold a phone to photograph a room
const COLS = 240
const PX_PER_M = 300 // about the photo's own sharpness on a wall a few metres away
const MAX_PX = 2048

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const percentile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[clamp(Math.floor(s.length * q), 0, s.length - 1)] : NaN
}

/** A repeatable random sequence, so the same room always gives the same shape. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The camera ray through a point of the photo (0 to 1), in the photo camera's own frame. */
export function cameraRay(u: number, v: number, aspect: number, tanY: number) {
  return new THREE.Vector3((u * 2 - 1) * tanY * aspect, (1 - v * 2) * tanY, -1).normalize()
}

type Plane = { normal: THREE.Vector3; d: number; count: number }
const off = (plane: Plane, p: THREE.Vector3) => Math.abs(plane.normal.dot(p) + plane.d)

/** The plane most points lie on (RANSAC), among planes `accept` allows. Its normal faces the camera. */
function fitPlane(points: THREE.Vector3[], accept: (n: THREE.Vector3) => boolean, tolerance: number, random: () => number, tries = 260): Plane | null {
  if (points.length < 30) return null
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  let best: Plane | null = null
  for (let i = 0; i < tries; i++) {
    const a = points[(random() * points.length) | 0]
    const b = points[(random() * points.length) | 0]
    const c = points[(random() * points.length) | 0]
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a))
    if (n.lengthSq() < 1e-12) continue
    n.normalize()
    if (!accept(n)) continue
    const normal = n.clone()
    let d = -normal.dot(a)
    if (d < 0) {
      normal.negate() // the camera (the origin) is on the side the normal points to
      d = -d
    }
    const plane: Plane = { normal, d, count: 0 }
    for (const p of points) if (off(plane, p) < tolerance) plane.count++
    if (!best || plane.count > best.count) best = plane
  }
  return best
}

const isFloor = (n: THREE.Vector3) => Math.abs(n.y) > 0.6
const isWall = (n: THREE.Vector3) => Math.abs(n.y) < 0.35

/** The offset that makes the floor and the main wall flattest: rooms are made of planes. */
function calibrate(dirs: THREE.Vector3[], near: Float32Array, rowOf: (k: number) => number, rows: number) {
  const step = Math.max(1, Math.floor(dirs.length / 3500))
  const sample: number[] = []
  for (let k = 0; k < dirs.length; k += step) sample.push(k)
  const score = (offset: number) => {
    const random = seeded(11)
    const pts = sample.map((k) => dirs[k].clone().multiplyScalar(1 / (offset + near[k])))
    const tolerance = 0.012 * median(pts.map((p) => p.length()))
    const lower = pts.filter((_, i) => rowOf(sample[i]) > rows * 0.6)
    const floor = fitPlane(lower, isFloor, tolerance, random)
    const rest = floor ? pts.filter((p) => off(floor, p) > tolerance) : pts
    const wall = fitPlane(rest, isWall, tolerance, random)
    return (floor ? floor.count / Math.max(1, lower.length) : 0) + 0.7 * (wall ? wall.count / Math.max(1, rest.length) : 0)
  }
  let best = { offset: 0.4, score: -1 }
  for (const offset of [0.06, 0.12, 0.2, 0.3, 0.42, 0.6, 0.85, 1.2, 1.8, 2.8]) {
    const sc = score(offset)
    if (sc > best.score) best = { offset, score: sc }
  }
  for (const f of [0.75, 0.88, 1.14, 1.3]) {
    const sc = score(best.offset * f)
    if (sc > best.score) best = { offset: best.offset * f, score: sc }
  }
  return best.offset
}

type Line = { normal: THREE.Vector2; c: number; inliers: THREE.Vector2[] }

/** Straight walls in the plan (RANSAC lines): points p with normal·p = c. Normal faces the camera. */
function fitLines(points: THREE.Vector2[], random: () => number, max = 4): Line[] {
  const lines: Line[] = []
  let left = points
  for (let n = 0; n < max && left.length > 40; n++) {
    let best: Line | null = null
    for (let i = 0; i < 300; i++) {
      const a = left[(random() * left.length) | 0]
      const b = left[(random() * left.length) | 0]
      const along = new THREE.Vector2().subVectors(b, a)
      if (along.lengthSq() < 0.09) continue // points too close give a wild direction
      const normal = new THREE.Vector2(-along.y, along.x).normalize()
      let c = normal.dot(a)
      if (c > 0) {
        normal.negate()
        c = -c
      }
      const inliers = left.filter((p) => Math.abs(normal.dot(p) - c) < 0.05 + 0.015 * p.length())
      if (!best || inliers.length > best.inliers.length) best = { normal, c, inliers }
    }
    if (!best || best.inliers.length < points.length * 0.06) break
    lines.push(best)
    const kept = new Set(best.inliers)
    left = left.filter((p) => !kept.has(p))
  }
  return lines
}

export type Surface = {
  name: 'floor' | 'back' | 'left' | 'right' | 'front' | 'ceiling'
  /** Corner the texture starts at, the two directions it runs, and how far (m). */
  origin: THREE.Vector3
  u: THREE.Vector3
  v: THREE.Vector3
  lu: number
  lv: number
  /** Into the room. */
  inward: THREE.Vector3
  canvas: HTMLCanvasElement
}

export type Room = {
  aspect: number
  /** The photo's vertical field of view, degrees: measured, or a phone's. */
  vfov: number
  floorY: number
  ceilingY: number
  /** Along the back wall (left to right in the photo) and from the back wall towards the camera. */
  axisS: THREE.Vector3
  axisT: THREE.Vector3
  s0: number
  s1: number
  t0: number
  t1: number
  /** The photo camera's frame turned level: the photo's camera sits at the origin. */
  level: THREE.Quaternion
  ray: (u: number, v: number) => THREE.Vector3
  onFloor: (dir: THREE.Vector3, y?: number) => THREE.Vector3 | null
  /** A point at (s, t) in the plan, at height y. */
  at: (s: number, t: number, y: number) => THREE.Vector3
  plan: (p: THREE.Vector3) => { s: number; t: number }
  /** What the photo's measurements say about the thing inside a box of the picture: its footprint
   *  in the plan, and its bottom and top heights. Null when too little of it was measured. */
  measure: (box: Cutout) => { s: number; t: number; width: number; depth: number; bottom: number; top: number } | null
  /** Where a ray from the photo's camera first meets a wall, or null. */
  hitWall: (dir: THREE.Vector3) => { point: THREE.Vector3; inward: THREE.Vector3; distance: number } | null
  surfaces: Surface[]
  /** The direction the photo looks, level. */
  viewDir: THREE.Vector3
}

type Cutout = { x: number; y: number; w: number; h: number }
export type Measured = { box: { x: number; y: number; w: number; h: number }; heightCm: number | null; hangs: boolean }
/** The room measured in metres (MoGe-2): distance along each grid ray, 0 where unknown. */
export type Geometry = { fov_y: number; cols: number; rows: number; distance: number[] }

export function buildRoom(photo: HTMLImageElement, depth: HTMLImageElement, measured: Measured[], geometry: Geometry | null, cutouts: Cutout[] = []): Room {
  const aspect = photo.naturalWidth / photo.naturalHeight
  const vfov = geometry ? geometry.fov_y : PHONE_VFOV
  const tanY = Math.tan((vfov * RAD) / 2)
  const cols = geometry ? geometry.cols : COLS
  const rows = geometry ? geometry.rows : Math.round(COLS / aspect)
  const w = cols + 1
  const h = rows + 1
  const dirs: THREE.Vector3[] = []
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dirs.push(cameraRay(i / cols, j / rows, aspect, tanY))
  const rowOf = (k: number) => Math.floor(k / w)
  let raw: THREE.Vector3[]
  if (geometry) {
    // Metres already. Where it couldn't tell (a window's sky), the nearest known point in the row.
    const d = Float32Array.from(geometry.distance)
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = j * w + i
        if (d[k] > 0) continue
        for (let r = 1; r < w; r++) {
          const a = d[j * w + Math.max(0, i - r)]
          const b = d[j * w + Math.min(w - 1, i + r)]
          if (a > 0 || b > 0) {
            d[k] = Math.max(a, b)
            break
          }
        }
      }
    raw = dirs.map((dir, k) => dir.clone().multiplyScalar(d[k] || 8))
  } else {
    const near = smoothKeepingEdges(sharpenEdges(readNearness(depth, w, h), w, h, 2, 0.12), w, h, 3, 0.04)
    const shift = calibrate(dirs, near, rowOf, rows)
    raw = dirs.map((dir, k) => dir.clone().multiplyScalar(1 / (shift + near[k])))
  }

  // ---- Level on the floor ----
  const random = seeded(23)
  const tolerance = 0.014 * median(raw.filter((_, k) => k % 7 === 0).map((p) => p.length()))
  const lower = raw.filter((_, k) => k % 2 === 0 && rowOf(k) > rows * 0.6)
  const fit = fitPlane(lower, isFloor, tolerance, random, 400)
  const floorPlane =
    fit && fit.normal.y > 0 ? fit : { normal: new THREE.Vector3(0, 1, 0), d: geometry ? 1.4 : -median(raw.filter((_, k) => rowOf(k) > rows * 0.8).map((p) => p.y)) }
  const level = new THREE.Quaternion().setFromUnitVectors(floorPlane.normal, new THREE.Vector3(0, 1, 0))
  const unlevel = level.clone().invert()
  // Measured: metres as they are. Otherwise metres from where people hold a phone.
  let scale = geometry ? 1 : CAMERA_HEIGHT_M / Math.max(0.02, floorPlane.d)
  let floorY = geometry ? -floorPlane.d : -CAMERA_HEIGHT_M
  const ray = (u: number, v: number) => cameraRay(u, v, aspect, tanY).applyQuaternion(level)
  const onFloor = (dir: THREE.Vector3, y = floorY) => (dir.y < -1e-3 ? dir.clone().multiplyScalar(y / dir.y) : null)

  // Unmeasured, each standing piece with a listed height says how tall the room must be.
  const ratios: number[] = []
  for (const p of geometry ? [] : measured) {
    if (!p.heightCm || p.hangs) continue
    const base = onFloor(ray(p.box.x + p.box.w / 2, p.box.y + p.box.h))
    if (!base) continue
    const facing = new THREE.Vector3(base.x, 0, base.z).normalize()
    const top = ray(p.box.x + p.box.w / 2, p.box.y)
    const tall = top.multiplyScalar(base.dot(facing) / Math.max(1e-3, top.dot(facing))).y - floorY
    if (tall > 0.05) ratios.push(p.heightCm / 100 / tall)
  }
  if (ratios.length) {
    const r = clamp(median(ratios), 0.6, 1.6)
    scale *= r
    floorY *= r
  }
  const world = raw.map((p) => p.clone().applyQuaternion(level).multiplyScalar(scale))

  // ---- The walls: straight lines in the plan of everything above furniture height ----
  const high = world.filter((p, k) => k % 2 === 0 && p.y > floorY + 0.9 && p.y < floorY + 2.4).map((p) => new THREE.Vector2(p.x, p.z))
  const lines = fitLines(high, seeded(31))
  const viewDir = new THREE.Vector3(0, 0, -1).applyQuaternion(level).setY(0).normalize()
  const toCamera = new THREE.Vector2(-viewDir.x, -viewDir.z)
  // The back wall: the strongest line facing the camera.
  const back = lines.filter((l) => l.normal.dot(toCamera) > 0.6).sort((a, b) => b.inliers.length - a.inliers.length)[0]
  const n = back ? back.normal : toCamera
  const axisT = new THREE.Vector3(n.x, 0, n.y).normalize()
  const axisS = new THREE.Vector3(0, 1, 0).cross(axisT).normalize()
  const plan = (p: THREE.Vector3) => ({ s: p.dot(axisS), t: p.dot(axisT) })
  const at = (s: number, t: number, y: number) => axisS.clone().multiplyScalar(s).addScaledVector(axisT, t).setY(y)

  const seen = world.filter((p, k) => k % 2 === 0 && p.y > floorY - 0.2)
  const seenS = seen.map((p) => plan(p).s)
  let t0 = back ? back.c : percentile(seen.map((p) => plan(p).t), 0.05)
  t0 = clamp(t0, -9, -1.6)
  // Side walls: lines square to the back wall, nearest on each side; else past what the photo saw.
  const sides = lines.filter((l) => l !== back && Math.abs(new THREE.Vector3(l.normal.x, 0, l.normal.y).dot(axisS)) > 0.8)
  const sideAt = (l: Line) => median(l.inliers.map((q) => q.x * axisS.x + q.y * axisS.z))
  const leftWall = sides.map(sideAt).filter((s) => s < -0.5).sort((a, b) => b - a)[0]
  const rightWall = sides.map(sideAt).filter((s) => s > 0.5).sort((a, b) => a - b)[0]
  let s0 = leftWall ?? Math.min(-1.4, percentile(seenS, 0.01) - 0.35)
  let s1 = rightWall ?? Math.max(1.4, percentile(seenS, 0.99) + 0.35)
  if (s1 - s0 > 9) {
    const mid = (s0 + s1) / 2
    s0 = mid - 4.5
    s1 = mid + 4.5
  }
  // The photographer stands near the wall opposite: the room closes a little behind the camera.
  const t1 = Math.max(0.7, t0 + 3)
  const tops = world.filter((p) => p.y > floorY + 2.1).map((p) => p.y)
  const ceilingY = floorY + clamp(tops.length > 40 ? percentile(tops, 0.97) - floorY : 2.7, 2.4, 3.6)

  const hitWall = (dir: THREE.Vector3) => {
    let best: { point: THREE.Vector3; inward: THREE.Vector3; distance: number } | null = null
    const walls: [THREE.Vector3, number][] = [
      [axisT, t0],
      [axisS, s0],
      [axisS.clone().negate(), -s1],
      [axisT.clone().negate(), -t1],
    ]
    for (const [inward, offset] of walls) {
      const along = dir.dot(inward)
      if (along > -1e-4) continue
      const distance = offset / along
      if (distance <= 0) continue
      const point = dir.clone().multiplyScalar(distance)
      const { s, t } = plan(point)
      if (s < s0 - 0.01 || s > s1 + 0.01 || t < t0 - 0.01 || t > t1 + 0.01) continue
      if (!best || distance < best.distance) best = { point, inward: inward.clone(), distance }
    }
    return best
  }

  const measure = (box: Cutout) => {
    // Only measured rooms: guessed depth would give a guessed size.
    if (!geometry) return null
    const ss: number[] = []
    const ts: number[] = []
    const ys: number[] = []
    for (let j = Math.ceil(box.y * rows); j <= Math.floor((box.y + box.h) * rows); j++)
      for (let i = Math.ceil(box.x * cols); i <= Math.floor((box.x + box.w) * cols); i++) {
        const p = world[j * w + i]
        if (!p || p.y < floorY + 0.04 || p.y > ceilingY - 0.1) continue // the floor or rug under it
        const { s, t } = plan(p)
        if (t < t0 + 0.1 || s < s0 + 0.1 || s > s1 - 0.1) continue // the wall behind it
        ss.push(s)
        ts.push(t)
        ys.push(p.y)
      }
    if (ss.length < 8) return null
    const [sa, sb, ta, tb] = [percentile(ss, 0.05), percentile(ss, 0.95), percentile(ts, 0.05), percentile(ts, 0.95)]
    return { s: (sa + sb) / 2, t: (ta + tb) / 2, width: Math.max(0.1, sb - sa), depth: Math.max(0.1, tb - ta), bottom: percentile(ys, 0.03), top: percentile(ys, 0.97) }
  }

  // ---- Paint each surface from the photo ----
  const depthAt = sampler(Float32Array.from(raw, (p) => p.length() * scale), w, h)
  const iw = Math.min(photo.naturalWidth, 1600)
  const ih = Math.round(iw / aspect)
  const image = pixels(photo, iw, ih).data
  const up = new THREE.Vector3(0, 1, 0)
  const height = ceilingY - floorY
  const defs: Omit<Surface, 'canvas'>[] = [
    { name: 'floor', origin: at(s0, t1, floorY), u: axisS.clone(), v: axisT.clone().negate(), lu: s1 - s0, lv: t1 - t0, inward: up.clone() },
    { name: 'back', origin: at(s0, t0, floorY), u: axisS.clone(), v: up.clone(), lu: s1 - s0, lv: height, inward: axisT.clone() },
    { name: 'left', origin: at(s0, t1, floorY), u: axisT.clone().negate(), v: up.clone(), lu: t1 - t0, lv: height, inward: axisS.clone() },
    { name: 'right', origin: at(s1, t0, floorY), u: axisT.clone(), v: up.clone(), lu: t1 - t0, lv: height, inward: axisS.clone().negate() },
    { name: 'front', origin: at(s1, t1, floorY), u: axisS.clone().negate(), v: up.clone(), lu: s1 - s0, lv: height, inward: axisT.clone().negate() },
    { name: 'ceiling', origin: at(s0, t0, ceilingY), u: axisS.clone(), v: axisT.clone(), lu: s1 - s0, lv: t1 - t0, inward: up.clone().negate() },
  ]
  const painted = defs.map((d) => paint(d))
  // A wall the photo never saw takes the colour of the walls it did.
  const wallColour = average(painted.filter((p) => !['floor', 'ceiling'].includes(p.surface.name))) ?? [225, 220, 212]
  const ceilingColour = average(painted.filter((p) => p.surface.name === 'ceiling')) ?? wallColour.map((c) => Math.min(255, c * 1.05))
  const surfaces = painted.map((p) => {
    if (p.surface.name === 'floor') return finish(p, floorPatch(p) ?? floorBase(p) ?? flat(average([p]) ?? [150, 120, 90]))
    return finish(p, flat(p.surface.name === 'ceiling' ? ceilingColour : wallColour))
  })

  function paint(s: Omit<Surface, 'canvas'>) {
    const W = clamp(Math.round(s.lu * PX_PER_M), 8, MAX_PX)
    const H = clamp(Math.round(s.lv * PX_PER_M), 8, MAX_PX)
    const rgb = new Float32Array(W * H * 3)
    const weight = new Float32Array(W * H)
    const p = new THREE.Vector3()
    const c = new THREE.Vector3()
    // The back wall also shows what is seen through it (a doorway, a window): farther is fine there.
    const throughOk = s.name === 'back'
    const tol = s.name === 'floor' ? 0.1 : 0.13
    for (let r = 0; r < H; r++) {
      const fv = (1 - (r + 0.5) / H) * s.lv
      for (let i = 0; i < W; i++) {
        p.copy(s.origin).addScaledVector(s.u, ((i + 0.5) / W) * s.lu).addScaledVector(s.v, fv)
        c.copy(p).applyQuaternion(unlevel)
        if (c.z > -1e-3) continue
        const pu = (c.x / -c.z / (tanY * aspect) + 1) / 2
        const pv = (1 - c.y / -c.z / tanY) / 2
        if (pu < 0 || pu > 1 || pv < 0 || pv > 1) continue
        if (cutouts.some((b) => pu > b.x && pu < b.x + b.w && pv > b.y && pv < b.y + b.h)) continue
        const dist = p.length()
        const seenAt = depthAt(pu, pv)
        if (seenAt < dist * (1 - tol) || (!throughOk && seenAt > dist * (1 + tol))) continue
        const x = pu * (iw - 1)
        const y = pv * (ih - 1)
        const x0 = Math.floor(x)
        const y0 = Math.floor(y)
        const fx = x - x0
        const fy = y - y0
        const k = r * W + i
        for (let ch = 0; ch < 3; ch++) {
          const a = image[(y0 * iw + x0) * 4 + ch]
          const b = image[(y0 * iw + Math.min(iw - 1, x0 + 1)) * 4 + ch]
          const cc = image[(Math.min(ih - 1, y0 + 1) * iw + x0) * 4 + ch]
          const d = image[(Math.min(ih - 1, y0 + 1) * iw + Math.min(iw - 1, x0 + 1)) * 4 + ch]
          rgb[k * 3 + ch] = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy
        }
        // Fades out over the photo's last few percent, so its frame never shows as a line.
        weight[k] = clamp(Math.min(pu, 1 - pu, pv, 1 - pv) / 0.02, 0, 1)
      }
    }
    return { surface: s, W, H, rgb, weight }
  }

  return {
    aspect,
    vfov,
    floorY,
    ceilingY,
    axisS,
    axisT,
    s0,
    s1,
    t0,
    t1,
    level,
    ray,
    onFloor,
    at,
    plan,
    measure,
    hitWall,
    surfaces,
    viewDir,
  }
}

type Painted = { surface: Omit<Surface, 'canvas'>; W: number; H: number; rgb: Float32Array; weight: Float32Array }

/** The mean colour of everything painted from the photo, or null when nothing was. */
function average(list: Painted[]): [number, number, number] | null {
  const sum = [0, 0, 0]
  let n = 0
  for (const p of list)
    for (let k = 0; k < p.weight.length; k++) {
      const wt = p.weight[k]
      if (wt <= 0) continue
      for (let c = 0; c < 3; c++) sum[c] += p.rgb[k * 3 + c] * wt
      n += wt
    }
  return n > 50 ? [sum[0] / n, sum[1] / n, sum[2] / n] : null
}

type Base = (i: number, r: number) => [number, number, number]
const flat = (c: number[]): Base => () => [c[0], c[1], c[2]]
// How far what the photo saw carries into what it didn't: a rug goes on under a table it hid.
const FILL_REACH_M = { floor: 0.3, wall: 0.25 }

/**
 * What the photo didn't see: near what it saw, the colours around it carried over (pull-push), so a
 * hole behind a piece closes up; further away, the surface's own plain base (the wall's paint, the
 * floor's boards). Never a smear across the room.
 */
function finish(p: Painted, base: Base): Surface {
  const seen = Float32Array.from(p.weight)
  const fallback = base(0, 0)
  type Level = { W: number; H: number; rgb: Float32Array; w: Float32Array }
  const levels: Level[] = [{ W: p.W, H: p.H, rgb: p.rgb, w: p.weight }]
  while (levels[levels.length - 1].W > 1 || levels[levels.length - 1].H > 1) {
    const a = levels[levels.length - 1]
    const W = Math.ceil(a.W / 2)
    const H = Math.ceil(a.H / 2)
    const rgb = new Float32Array(W * H * 3)
    const w = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sw = 0
        const s = [0, 0, 0]
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const X = x * 2 + dx
            const Y = y * 2 + dy
            if (X >= a.W || Y >= a.H) continue
            const k = Y * a.W + X
            const wt = a.w[k]
            sw += wt
            for (let c = 0; c < 3; c++) s[c] += a.rgb[k * 3 + c] * wt
          }
        const k = y * W + x
        if (sw > 0) for (let c = 0; c < 3; c++) rgb[k * 3 + c] = s[c] / sw
        w[k] = Math.min(1, sw)
      }
    levels.push({ W, H, rgb, w })
  }
  const top = levels[levels.length - 1]
  if (top.w[0] <= 0) {
    top.rgb.set(fallback)
    top.w[0] = 1
  }
  for (let L = levels.length - 2; L >= 0; L--) {
    const a = levels[L]
    const b = levels[L + 1]
    for (let y = 0; y < a.H; y++)
      for (let x = 0; x < a.W; x++) {
        const k = y * a.W + x
        const wt = a.w[k]
        if (wt >= 1) continue
        // Bilinear from the coarser level, so filled areas are smooth, not blocky.
        const bx = clamp((x + 0.5) / 2 - 0.5, 0, b.W - 1)
        const by = clamp((y + 0.5) / 2 - 0.5, 0, b.H - 1)
        const x0 = Math.floor(bx)
        const y0 = Math.floor(by)
        const x1 = Math.min(b.W - 1, x0 + 1)
        const y1 = Math.min(b.H - 1, y0 + 1)
        const fx = bx - x0
        const fy = by - y0
        for (let c = 0; c < 3; c++) {
          const v =
            (b.rgb[(y0 * b.W + x0) * 3 + c] * (1 - fx) + b.rgb[(y0 * b.W + x1) * 3 + c] * fx) * (1 - fy) +
            (b.rgb[(y1 * b.W + x0) * 3 + c] * (1 - fx) + b.rgb[(y1 * b.W + x1) * 3 + c] * fx) * fy
          a.rgb[k * 3 + c] = a.rgb[k * 3 + c] * wt + v * (1 - wt)
        }
        a.w[k] = 1
      }
  }
  const far = distanceToSeen(seen, p.W, p.H)
  const reach = (p.surface.name === 'floor' ? FILL_REACH_M.floor : FILL_REACH_M.wall) * PX_PER_M
  for (let r = 0; r < p.H; r++)
    for (let i = 0; i < p.W; i++) {
      const k = r * p.W + i
      if (seen[k] >= 1) continue
      const t = clamp(far[k] / reach, 0, 1)
      const blend = (1 - seen[k]) * t * t * (3 - 2 * t)
      if (blend <= 0) continue
      const b = base(i, r)
      for (let c = 0; c < 3; c++) p.rgb[k * 3 + c] += (b[c] - p.rgb[k * 3 + c]) * blend
    }
  const canvas = document.createElement('canvas')
  canvas.width = p.W
  canvas.height = p.H
  const ctx = canvas.getContext('2d')!
  const out = ctx.createImageData(p.W, p.H)
  for (let k = 0; k < p.W * p.H; k++) {
    out.data[k * 4] = p.rgb[k * 3]
    out.data[k * 4 + 1] = p.rgb[k * 3 + 1]
    out.data[k * 4 + 2] = p.rgb[k * 3 + 2]
    out.data[k * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  return { ...p.surface, canvas }
}

/** Texels from each texel to the nearest one the photo saw (two-pass chamfer). */
function distanceToSeen(seen: Float32Array, W: number, H: number) {
  const d = new Float32Array(W * H)
  for (let k = 0; k < d.length; k++) d[k] = seen[k] > 0.5 ? 0 : 1e9
  const relax = (k: number, j: number, cost: number) => {
    if (d[j] + cost < d[k]) d[k] = d[j] + cost
  }
  for (let r = 0; r < H; r++)
    for (let i = 0; i < W; i++) {
      const k = r * W + i
      if (i > 0) relax(k, k - 1, 1)
      if (r > 0) {
        relax(k, k - W, 1)
        if (i > 0) relax(k, k - W - 1, 1.414)
        if (i < W - 1) relax(k, k - W + 1, 1.414)
      }
    }
  for (let r = H - 1; r >= 0; r--)
    for (let i = W - 1; i >= 0; i--) {
      const k = r * W + i
      if (i < W - 1) relax(k, k + 1, 1)
      if (r < H - 1) {
        relax(k, k + W, 1)
        if (i < W - 1) relax(k, k + W + 1, 1.414)
        if (i > 0) relax(k, k + W - 1, 1.414)
      }
    }
  return d
}

/**
 * The floor where the photo didn't see it, carried on from a clean patch of what it did see: the
 * boards or the rug continue in their own grain (mirrored so no seam shows), a touch quieter than
 * the photo so it reads as the same floor rather than a photo of it. Null when the photo saw no
 * clean square of floor.
 */
function floorPatch(p: Painted): Base | null {
  const { W, H } = p
  // Summed tables: unseen texels, brightness and brightness squared, each rectangle in O(1).
  const stride = W + 1
  const unseenSum = new Float64Array(stride * (H + 1))
  const lumSum = new Float64Array(stride * (H + 1))
  const lum2Sum = new Float64Array(stride * (H + 1))
  for (let r = 0; r < H; r++)
    for (let i = 0; i < W; i++) {
      const k = r * W + i
      const l = 0.299 * p.rgb[k * 3] + 0.587 * p.rgb[k * 3 + 1] + 0.114 * p.rgb[k * 3 + 2]
      const at = (r + 1) * stride + i + 1
      const up = r * stride + i + 1
      const left = (r + 1) * stride + i
      const diag = r * stride + i
      unseenSum[at] = (p.weight[k] >= 0.99 ? 0 : 1) + unseenSum[up] + unseenSum[left] - unseenSum[diag]
      lumSum[at] = l + lumSum[up] + lumSum[left] - lumSum[diag]
      lum2Sum[at] = l * l + lum2Sum[up] + lum2Sum[left] - lum2Sum[diag]
    }
  const box = (t: Float64Array, x: number, y: number, n: number) => t[(y + n) * stride + x + n] - t[y * stride + x + n] - t[(y + n) * stride + x] + t[y * stride + x]
  for (let size = Math.min(W, H, Math.round(1 * PX_PER_M)); size >= Math.round(0.3 * PX_PER_M); size = Math.round(size * 0.8)) {
    let n = size
    const step = Math.max(4, Math.round(n / 8))
    // The calmest clean square: a sunbeam or a shadow repeated across the floor would be a pattern.
    let best: { x: number; y: number; spread: number } | null = null
    for (let y = 0; y + n <= H; y += step)
      for (let x = 0; x + n <= W; x += step) {
        if (box(unseenSum, x, y, n) > 0) continue
        const area = n * n
        const mean = box(lumSum, x, y, n) / area
        const spread = Math.sqrt(Math.max(0, box(lum2Sum, x, y, n) / area - mean * mean))
        if (!best || spread < best.spread) best = { x, y, spread }
      }
    if (!best) continue
    // A few texels in from the square's edge: edges carry a hint of skirting or shadow that,
    // mirrored, would draw faint lines across the floor.
    const margin = Math.max(2, Math.round(n * 0.04))
    const x = best.x + margin
    const y = best.y + margin
    n -= 2 * margin
    const patch = new Float32Array(n * n * 3)
    for (let r = 0; r < n; r++) for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) patch[(r * n + i) * 3 + c] = p.rgb[((y + r) * W + x + i) * 3 + c]
    const mirror = (v: number) => {
      const m = v % (2 * n)
      return m < n ? m : 2 * n - 1 - m
    }
    return (i, r) => {
      const k = (mirror(r) * n + mirror(i)) * 3
      return [patch[k] * 0.92 + 238 * 0.08, patch[k + 1] * 0.92 + 235 * 0.08, patch[k + 2] * 0.92 + 230 * 0.08]
    }
  }
  return null
}

/**
 * The floor where the photo didn't see it: its most common colour (boards or rug, not their average,
 * which is neither) washed half to paper, so what was seen and what wasn't are told apart, with a
 * fine grain so it isn't flat.
 */
function floorBase(p: Painted): Base | null {
  const bins = new Map<number, { n: number; sum: [number, number, number] }>()
  for (let k = 0; k < p.weight.length; k += 3) {
    if (p.weight[k] < 1) continue
    const r = p.rgb[k * 3]
    const g = p.rgb[k * 3 + 1]
    const b = p.rgb[k * 3 + 2]
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const bin = bins.get(key) ?? { n: 0, sum: [0, 0, 0] }
    bin.n++
    bin.sum[0] += r
    bin.sum[1] += g
    bin.sum[2] += b
    bins.set(key, bin)
  }
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0]
  if (!top || top.n < 50) return null
  // Half paper: plainly the room's floor, plainly not a photo of it.
  const c = top.sum.map((v, i) => (v / top.n) * 0.45 + [238, 235, 230][i] * 0.55)
  const random = seeded(5)
  const grain = Float32Array.from({ length: 4096 }, () => (random() - 0.5) * 7)
  return (i, r) => {
    const n = grain[(r * 61 + i * 7) & 4095]
    return [c[0] + n, c[1] + n, c[2] + n]
  }
}

/** Bilinear lookup in a grid of values over the photo (0 to 1 both ways). */
function sampler(values: Float32Array, w: number, h: number) {
  return (u: number, v: number) => {
    const x = clamp(u * (w - 1), 0, w - 1)
    const y = clamp(v * (h - 1), 0, h - 1)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(w - 1, x0 + 1)
    const y1 = Math.min(h - 1, y0 + 1)
    const fx = x - x0
    const fy = y - y0
    // The nearer of the four where they disagree a lot: an edge, not a slope between two things.
    const a = values[y0 * w + x0]
    const b = values[y0 * w + x1]
    const c = values[y1 * w + x0]
    const d = values[y1 * w + x1]
    const lo = Math.min(a, b, c, d)
    if (Math.max(a, b, c, d) > lo * 1.15) return lo
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
  }
}
