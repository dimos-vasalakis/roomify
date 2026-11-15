/**
 * Where each piece stands in the 3D room: where the render put it, on the floor, on the piece
 * under it, or on the wall. Square to the room, backed onto a wall it stands near, inside the
 * room, never inside another piece, at the shop's listed size.
 */
import * as THREE from 'three'
import { RAD, clamp, type Room } from './roomShell'

export type Box = { x: number; y: number; w: number; h: number }
export type PieceIn = {
  id: string
  slot: string
  title: string
  box: Box
  widthCm: number | null
  depthCm: number | null
  heightCm: number | null
  /** Stands on another piece (a bowl on a table), whatever its name says. */
  onTop?: boolean
  /** Already in the room: it stays exactly where the photo measured it. */
  existing?: boolean
}
export type Placement = {
  id: string
  /** The middle of its footprint, at the height it stands on. */
  position: THREE.Vector3
  /** Turn about the vertical: the model's front (+Z) faces this way. */
  yaw: number
  width: number
  depth: number
  height: number
  kind: 'stands' | 'hangs' | 'lies' | 'on-top'
}

export const HANGS = /painting|wall art|print|poster|mirror|wall clock|πίνακ|κάδρ|καθρέφτ|αφίσ/i
export const LIES = /\brug\b|carpet|χαλί|χαλάκι/i
const SITS_ON_TOP = /table lamp|desk lamp|lamp|vase|plant|decor|clock|speaker|φωτιστ|βάζο|φυτό|λάμπα/i
const STANDS_ALONE = /floor lamp|δαπέδου|lampadater/i

/** Usual heights (m) by kind of piece: a size read only from the picture stays within reach of them. */
const TYPICAL_HEIGHT: [RegExp, number][] = [
  [/office chair|καρέκλα γραφείου|gaming/i, 1.15],
  [/armchair|πολυθρόνα|lounge/i, 0.9],
  [/chair|καρέκλα|stool|σκαμπό/i, 0.85],
  [/sofa|καναπ/i, 0.85],
  [/floor lamp|δαπέδου|lampadater/i, 1.55],
  [/lamp|φωτιστ/i, 0.45],
  [/coffee table|τραπεζάκι/i, 0.42],
  [/side table|end table|bedside|nightstand|κομοδίνο/i, 0.55],
  [/ottoman|pouf|πουφ/i, 0.42],
  [/desk|γραφείο|table|τραπέζι/i, 0.75],
  [/bed|κρεβ/i, 0.95],
  [/bookcase|shelf|βιβλιοθήκη|ραφιέρα/i, 1.8],
  [/wardrobe|ντουλάπα/i, 2],
  [/sideboard|cabinet|συρταριέρα|μπουφές|κομοδίνο|nightstand/i, 0.75],
  [/plant|φυτό/i, 1.1],
]
const typicalHeight = (label: string) => TYPICAL_HEIGHT.find(([re]) => re.test(label))?.[1] ?? null
const metres = (cm: number | null) => (cm && cm > 0 ? cm / 100 : null)

export const kindOf = (p: PieceIn): Placement['kind'] => {
  const label = `${p.slot} ${p.title}`
  if (HANGS.test(label)) return 'hangs'
  if (LIES.test(label)) return 'lies'
  if (p.onTop) return 'on-top'
  if (SITS_ON_TOP.test(p.slot) && !STANDS_ALONE.test(label)) return 'on-top'
  return 'stands'
}

type Rect = { id: string; s: number; t: number; hs: number; ht: number; top: number; yaw: number }

export function placePieces(room: Room, pieces: PieceIn[]): Placement[] {
  const tanY = Math.tan((room.vfov * RAD) / 2)
  const { axisS, axisT, s0, s1, t0, t1 } = room
  // The four ways a piece can face, square to the room: away from each wall.
  const fronts = [
    { dir: axisT, wallGap: (_s: number, t: number) => t - t0 }, // backed onto the back wall
    { dir: axisS, wallGap: (s: number) => s - s0 }, // onto the left wall
    { dir: axisS.clone().negate(), wallGap: (s: number) => s1 - s }, // onto the right wall
    { dir: axisT.clone().negate(), wallGap: (_s: number, t: number) => t1 - t }, // onto the front wall
  ]
  const yawOf = (dir: THREE.Vector3) => Math.atan2(dir.x, dir.z)
  const rects: Rect[] = []
  const out: Placement[] = []

  const order = [...pieces].sort((a, b) => rank(a) - rank(b) || area(b) - area(a))
  for (const p of order) {
    const kind = kindOf(p)
    const label = `${p.slot} ${p.title}`
    const cx = p.box.x + p.box.w / 2
    let width = metres(p.widthCm)
    let depth = metres(p.depthCm)
    let height = metres(p.heightCm)

    if (kind === 'hangs') {
      const hit = room.hitWall(room.ray(cx, p.box.y + p.box.h / 2))
      if (!hit) continue
      width ??= p.box.w * 2 * tanY * room.aspect * hit.distance
      height ??= p.box.h * 2 * tanY * hit.distance
      depth = Math.min(depth ?? 0.04, 0.08)
      const bottom = clamp(hit.point.y - height / 2, room.floorY + 0.3, room.ceilingY - height - 0.05)
      const position = hit.point.clone().addScaledVector(hit.inward, depth / 2 + 0.01).setY(bottom)
      out.push({ id: p.id, position, yaw: yawOf(hit.inward), width, depth, height, kind })
      continue
    }

    if (p.existing) {
      const m = room.measure(p.box)
      if (m) {
        // Where the photo measured it. Its model was made from the photo, so it already faces the
        // way the photo saw it: turned to face the camera.
        const under = kind === 'on-top' ? rects.find((r) => holds(r, p.box, room)) : undefined
        const standY = under ? under.top : room.floorY
        // Only part of it may be in the photo: a usual height for its kind keeps it believable.
        const usual = typicalHeight(label)
        const height = usual ? clamp(m.top - standY, usual * 0.75, usual * 1.3) : Math.max(0.05, m.top - standY)
        const position = room.at(m.s, m.t, standY)
        const yaw = Math.atan2(-position.x, -position.z)
        rects.push({ id: p.id, s: m.s, t: m.t, hs: m.width / 2, ht: m.depth / 2, top: standY + height, yaw })
        out.push({ id: p.id, position, yaw, width: m.width, depth: m.depth, height, kind: under ? 'on-top' : 'stands' })
        continue
      }
    }

    // The front edge of its foot, where the render shows it meets what it stands on.
    const footRay = room.ray(cx, p.box.y + p.box.h)
    const under = kind === 'on-top' ? rects.find((r) => holds(r, p.box, room)) : undefined
    const standY = under ? under.top : room.floorY
    let foot = room.onFloor(footRay, standY)
    if (!foot) {
      const hit = room.hitWall(footRay)
      if (!hit) continue
      foot = hit.point.setY(standY)
    }
    const facing = new THREE.Vector3(foot.x, 0, foot.z).normalize()
    const reach = foot.length()
    width ??= p.box.w * 2 * tanY * room.aspect * reach
    if (kind === 'lies') {
      // A rug: its far edge is where the top of its box meets the floor.
      const far = room.onFloor(room.ray(cx, p.box.y))
      depth ??= clamp(far ? far.distanceTo(foot) : width * 0.66, 0.5, 4)
      height = 0.012
    }
    if (!height) {
      const top = room.ray(cx, p.box.y)
      height = Math.max(0.1, top.multiplyScalar(foot.dot(facing) / Math.max(1e-3, top.dot(facing))).y - standY)
      const usual = typicalHeight(label)
      if (usual) height = clamp(height, usual * 0.8, usual * 1.2)
    }
    depth ??= clamp(width * 0.55, 0.3, 1.1)
    const centre = foot.clone().addScaledVector(facing, under ? 0 : depth / 2)
    let { s, t } = room.plan(centre)

    // Faces the room from the wall it stands near; otherwise faces the camera, square to the room.
    let front = fronts.reduce((a, b) => (b.dir.dot(facing) < a.dir.dot(facing) ? b : a))
    if (under) {
      front = fronts.find((f) => Math.abs(yawOf(f.dir) - under.yaw) < 0.01) ?? front
    } else if (kind === 'stands') {
      // Only a wall it could have its back to, seen from the camera; the back wall wins a tie.
      const toCamera = facing.clone().negate()
      const near = fronts
        .filter((f) => f.dir.dot(toCamera) > 0.2)
        .map((f) => {
          const alongT = Math.abs(f.dir.dot(axisT)) > 0.5
          return { f, gap: f.wallGap(s, t) - (alongT ? depth! : width!) / 2 + (alongT ? 0 : 0.25) }
        })
        .sort((a, b) => a.gap - b.gap)[0]
      if (near && near.gap < 0.6) {
        front = near.f
        // Backed onto it, 3 cm off.
        const back = depth / 2 + 0.03
        if (front === fronts[0]) t = t0 + back
        else if (front === fronts[1]) s = s0 + back
        else if (front === fronts[2]) s = s1 - back
        else t = t1 - back
      }
    }
    const alongT = Math.abs(front.dir.dot(axisT)) > 0.5
    const hs = (alongT ? width : depth) / 2
    const ht = (alongT ? depth : width) / 2
    const inside = () => {
      s = s1 - s0 > 2 * hs + 0.04 ? clamp(s, s0 + hs + 0.02, s1 - hs - 0.02) : (s0 + s1) / 2
      t = t1 - t0 > 2 * ht + 0.04 ? clamp(t, t0 + ht + 0.02, t1 - ht - 0.02) : (t0 + t1) / 2
    }
    inside()
    if (!under && kind === 'stands') {
      // Two pieces never stand in each other: this one steps clear of those already placed.
      for (let step = 0; step < 80; step++) {
        const other = rects.find((r) => r.top > room.floorY + 0.05 && Math.abs(r.s - s) < r.hs + hs - 0.01 && Math.abs(r.t - t) < r.ht + ht - 0.01)
        if (!other) break
        const away = new THREE.Vector2(s - other.s, t - other.t)
        if (away.lengthSq() < 1e-6) away.set(1, 0)
        away.normalize().multiplyScalar(0.04)
        s += away.x
        t += away.y
        inside()
      }
    }
    if (under) {
      // Within the top of the piece it stands on.
      s = clamp(s, under.s - under.hs + hs, under.s + under.hs - hs)
      t = clamp(t, under.t - under.ht + ht, under.t + under.ht - ht)
    }
    const yaw = yawOf(front.dir)
    rects.push({ id: p.id, s, t, hs, ht, top: standY + height, yaw })
    out.push({ id: p.id, position: room.at(s, t, standY), yaw, width, depth, height, kind: under ? 'on-top' : kind === 'on-top' ? 'stands' : kind })
  }
  return out
}

/** Floor pieces first and biggest first (a desk keeps its place, a chair steps clear of it),
 *  rugs before them (they don't push anything), then what stands on them and what hangs. */
function rank(p: PieceIn) {
  const kind = kindOf(p)
  return kind === 'lies' ? 0 : kind === 'stands' ? 1 : kind === 'on-top' ? 2 : 3
}
const area = (p: PieceIn) => (p.widthCm ?? p.box.w * 300) * (p.depthCm ?? p.box.h * 150)

/** Does a piece's foot (in the render) fall on the top of this placed piece? */
function holds(r: Rect, box: Box, room: Room) {
  if (r.top < room.floorY + 0.2) return false // a rug holds nothing up
  const foot = room.onFloor(room.ray(box.x + box.w / 2, box.y + box.h), r.top)
  if (!foot) return false
  const { s, t } = room.plan(foot)
  return Math.abs(s - r.s) < r.hs + 0.25 && Math.abs(t - r.t) < r.ht + 0.35
}
