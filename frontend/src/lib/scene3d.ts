/**
 * The furnished room as a real 3D scene (three.js).
 *
 * - The shell is the person's own EMPTY room photo pushed back by its depth map. With nothing in
 *   front of the walls there is nothing to tear or smear when the camera moves.
 * - The floor is found in that shell (a plane fitted to its lower part), the world is levelled on
 *   it and scaled to metres from the listed heights of the pieces (or a phone's usual height).
 * - Every piece is a real 3D model made from its shop photo, placed where the render put it: on
 *   the floor, on top of the piece under it, or on the wall; turned to face the room or backed
 *   onto the nearest wall; sized from the shop's listed measurements. Real soft shadows tie it
 *   to the floor. A piece whose model can't be made stands in as a flat card cut from the render.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { readNearness, sharpenEdges, smoothKeepingEdges } from './depthGrid'

export type Box = { x: number; y: number; w: number; h: number }
export type Piece = {
  id: string
  slot: string
  title: string
  /** Where the render put it, 0 to 1 of the frame. */
  box: Box
  widthCm: number | null
  depthCm: number | null
  heightCm: number | null
  /** Resolves to the GLB of the product, made from its shop photo. */
  model: Promise<string> | null
}
export type PieceState = 'modelling' | 'ready' | 'card'
export type Pin = { id: string; x: number; y: number; visible: boolean }
export type View = { yaw: number; pitch: number; zoom: number }
export type Scene3D = {
  aim: (v: View) => void
  setAuto: (on: boolean) => void
  dispose: () => void
}
type Options = {
  photo: HTMLImageElement
  depth: HTMLImageElement
  render: HTMLImageElement | null
  pieces: Piece[]
  ground: string
  accent: string
  onPins: (pins: Pin[]) => void
  onPiece: (id: string, state: PieceState) => void
  onUserMove: () => void
}

export const FRONT: View = { yaw: 0, pitch: 0, zoom: 1 }
const VFOV = 50 // a phone's main camera, landscape
const CAMERA_HEIGHT_M = 1.45 // where people hold a phone to photograph a room
const COLS = 360
const BREAK = 0.25 // only a real cliff in the empty room is left open; anything less is bridged
const RAD = Math.PI / 180
const SWAY = { deg: 12, speed: 0.3 }
// The direction a generated model faces in its own file: glTF's front is +Z.
const MODEL_FRONT_YAW = 0

const HANGS = /painting|wall art|print|poster|mirror|wall clock|πίνακ|κάδρ|καθρέφτ|αφίσ/i
const SITS_ON_TOP = /lamp|vase|plant|decor|clock|speaker|φωτιστ|βάζο|φυτό|λάμπα/i

/** Usual heights (m) by kind of piece: a size read only from the picture stays within reach of them. */
const TYPICAL_HEIGHT: [RegExp, number][] = [
  [/office chair|καρέκλα γραφείου|gaming/i, 1.15],
  [/armchair|πολυθρόνα|lounge/i, 0.9],
  [/chair|καρέκλα|stool|σκαμπό/i, 0.85],
  [/sofa|καναπ/i, 0.85],
  [/floor lamp|δαπέδου|lampadater/i, 1.55],
  [/lamp|φωτιστ/i, 0.45],
  [/desk|γραφείο|table|τραπέζι/i, 0.75],
  [/bed|κρεβ/i, 0.95],
  [/bookcase|shelf|βιβλιοθήκη|ραφιέρα/i, 1.8],
  [/wardrobe|ντουλάπα/i, 2],
  [/sideboard|cabinet|συρταριέρα|μπουφές|κομοδίνο|nightstand/i, 0.75],
  [/plant|φυτό/i, 1.1],
]
const typicalHeight = (label: string) => TYPICAL_HEIGHT.find(([re]) => re.test(label))?.[1] ?? null

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}

/** The camera ray through a point of the photo (0 to 1), in the photo camera's own frame. */
function cameraRay(u: number, v: number, aspect: number) {
  const tanY = Math.tan((VFOV * RAD) / 2)
  return new THREE.Vector3((u * 2 - 1) * tanY * aspect, (1 - v * 2) * tanY, -1).normalize()
}

/** A repeatable random sequence, so the same room always gives the same shell. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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

/**
 * Depth Anything gives nearness up to an unknown scale and offset; a wrong offset bows flat walls.
 * Pick the offset that makes the floor and the main wall flattest: rooms are made of planes.
 */
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

function shellMaterial(photo: THREE.Texture, ground: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: photo }, uGround: { value: ground }, uFade: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 uGround;
      uniform float uFade;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        // The photo's own edges fade into the dark once the camera moves, instead of a hard frame.
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.0, 0.04, min(e.x, e.y));
        gl_FragColor = vec4(mix(uGround, c, mix(1.0, edge, uFade)), 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  })
}

export function createScene(canvas: HTMLCanvasElement, o: Options): Scene3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const ground = new THREE.Color(o.ground)
  const scene = new THREE.Scene()
  scene.background = ground
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = environment
  scene.environmentIntensity = 0.55

  // ---- The shell: the empty room, pushed back by its depth ----
  const aspect = o.photo.naturalWidth / o.photo.naturalHeight
  const rows = Math.round(COLS / aspect)
  const w = COLS + 1
  const h = rows + 1
  const near = smoothKeepingEdges(sharpenEdges(readNearness(o.depth, w, h), w, h, 2, 0.12), w, h, 3, 0.04)
  const dirs: THREE.Vector3[] = []
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dirs.push(cameraRay(i / COLS, j / rows, aspect))
  const rowOf = (k: number) => Math.floor(k / w)
  const shift = calibrate(dirs, near, rowOf, rows)
  const raw = dirs.map((d, k) => d.clone().multiplyScalar(1 / (shift + near[k])))

  // The room's planes: the floor, then up to four walls and a ceiling, each a real flat surface.
  const random = seeded(23)
  const tolerance = 0.014 * median(raw.filter((_, k) => k % 7 === 0).map((p) => p.length()))
  const every = raw.filter((_, k) => k % 3 === 0)
  const floorFit = fitPlane(every.filter((_, i) => rowOf(i * 3) > rows * 0.6), isFloor, tolerance, random, 400)
  const planes: Plane[] = []
  let left = every
  if (floorFit && floorFit.normal.y > 0) {
    planes.push(floorFit)
    left = left.filter((p) => off(floorFit, p) > tolerance)
  }
  for (let n = 0; n < 4; n++) {
    const wall = fitPlane(left, isWall, tolerance, random, 300)
    if (!wall || wall.count < every.length * 0.05) break
    planes.push(wall)
    left = left.filter((p) => off(wall, p) > tolerance)
  }
  const ceiling = fitPlane(left.filter((p) => p.y > 0), (n) => isFloor(n), tolerance, random, 200)
  if (ceiling && ceiling.count > every.length * 0.04) planes.push(ceiling)
  // Seen from inside, a room's surface along any ray is the FIRST of its planes the ray meets: so
  // each point goes onto the nearest plane that agrees with its depth. Walls come out straight,
  // corners are clean lines, and the photo stays exactly where it was (every point keeps its ray).
  for (let k = 0; k < raw.length; k++) {
    const dist = raw[k].length()
    let nearest = Infinity
    for (const plane of planes) {
      const along = plane.normal.dot(dirs[k])
      if (along >= -1e-4) continue
      const t = -plane.d / along
      // Wide band: for a room seen from inside, the first plane a ray meets is the true surface.
      if (t > dist * 0.7 && t < dist * 1.35 && t < nearest) nearest = t
    }
    if (nearest < Infinity) raw[k] = dirs[k].clone().multiplyScalar(nearest)
  }

  // Level the world on the floor; the photo's camera keeps its tilt.
  const floor = floorFit && floorFit.normal.y > 0 ? floorFit : { normal: new THREE.Vector3(0, 1, 0), d: -median(raw.filter((_, k) => rowOf(k) > rows * 0.8).map((p) => p.y)) }
  const level = new THREE.Quaternion().setFromUnitVectors(floor.normal, new THREE.Vector3(0, 1, 0))
  const heightRaw = Math.max(0.02, floor.d) // the camera's height above the floor, in depth units
  let scale = CAMERA_HEIGHT_M / heightRaw
  const toWorld = (cameraDir: THREE.Vector3) => cameraDir.clone().applyQuaternion(level)
  const ray = (u: number, v: number) => toWorld(cameraRay(u, v, aspect))

  // Metres from the pieces' listed heights: each floor piece says how tall the room must be.
  let floorY = -CAMERA_HEIGHT_M
  const onFloor = (dir: THREE.Vector3, y = floorY) => (dir.y < -1e-3 ? dir.clone().multiplyScalar(y / dir.y) : null)
  const ratios: number[] = []
  for (const p of o.pieces) {
    if (!p.heightCm || HANGS.test(`${p.slot} ${p.title}`)) continue
    const base = onFloor(ray(p.box.x + p.box.w / 2, p.box.y + p.box.h))
    if (!base) continue
    const facing = new THREE.Vector3(base.x, 0, base.z).normalize()
    const top = ray(p.box.x + p.box.w / 2, p.box.y)
    const t = base.dot(facing) / Math.max(1e-3, top.dot(facing))
    const tall = top.multiplyScalar(t).y - floorY
    if (tall > 0.05) ratios.push(p.heightCm / 100 / tall)
  }
  if (ratios.length) {
    const r = clamp(median(ratios), 0.6, 1.6)
    scale *= r
    floorY *= r
  }

  const positions = new Float32Array(w * h * 3)
  for (let k = 0; k < raw.length; k++) {
    const p = raw[k].clone().applyQuaternion(level).multiplyScalar(scale)
    positions.set([p.x, p.y, p.z], k * 3)
  }
  const uvs = new Float32Array(w * h * 2)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) uvs.set([i / COLS, 1 - j / rows], (j * w + i) * 2)
  const index: number[] = []
  const flat = (a: number, b: number) => Math.abs(near[a] - near[b]) < BREAK
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < COLS; i++) {
      const a = j * w + i
      const b = a + 1
      const c = a + w
      const d = c + 1
      if (flat(a, c) && flat(c, d) && flat(a, d)) index.push(a, c, d)
      if (flat(a, d) && flat(d, b) && flat(a, b)) index.push(a, d, b)
    }
  const shellGeometry = new THREE.BufferGeometry()
  shellGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  shellGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  shellGeometry.setIndex(index)
  shellGeometry.computeVertexNormals()
  const photoTexture = new THREE.Texture(o.photo)
  photoTexture.colorSpace = THREE.SRGBColorSpace
  photoTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  photoTexture.needsUpdate = true
  const shellMat = shellMaterial(photoTexture, ground)
  const shell = new THREE.Mesh(shellGeometry, shellMat)
  scene.add(shell)

  // Soft shadows on the floor, nothing else drawn there.
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.32 }))
  catcher.rotation.x = -Math.PI / 2
  catcher.position.y = floorY + 0.003
  catcher.receiveShadow = true
  scene.add(catcher)

  // Light: a soft sky, and one sun-like key from above the camera's side for the shadows.
  scene.add(new THREE.HemisphereLight(0xfffaf2, 0x403830, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.radius = 6
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.02
  scene.add(key, key.target)

  // ---- The camera: where the photo was taken, circling the middle of the room ----
  const camera = new THREE.PerspectiveCamera(VFOV, 1.5, 0.05, 80)
  const viewDir = toWorld(new THREE.Vector3(0, 0, -1))
  const centreHits = o.pieces.map((p) => onFloor(ray(p.box.x + p.box.w / 2, p.box.y + p.box.h))).filter((v): v is THREE.Vector3 => !!v)
  const d0 = clamp(centreHits.length ? median(centreHits.map((v) => v.length())) : 3, 1.2, 8)
  const target = viewDir.clone().multiplyScalar(d0)
  camera.position.set(0, 0, 0)
  camera.up.set(0, 1, 0)
  camera.lookAt(target)
  key.position.set(target.x - 2.2, floorY + 4.2, target.z + 2.6)
  key.target.position.copy(target).setY(floorY)
  const sc = key.shadow.camera
  sc.left = sc.bottom = -5
  sc.right = sc.top = 5
  sc.near = 0.5
  sc.far = 14
  sc.updateProjectionMatrix()

  let disposed = false
  let auto = false
  let goal: THREE.Spherical | null = null
  const growing: { pivot: THREE.Group; t: number }[] = []

  const controls = new OrbitControls(camera, canvas)
  controls.target.copy(target)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.rotateSpeed = 0.55
  controls.zoomSpeed = 0.7
  controls.update()
  const start = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target))
  // The photo only saw one side of the room: beyond about 50° round, its walls stretch thin.
  controls.minAzimuthAngle = start.theta - 50 * RAD
  controls.maxAzimuthAngle = start.theta + 50 * RAD
  controls.minPolarAngle = 18 * RAD
  controls.maxPolarAngle = Math.min(start.phi + 10 * RAD, 98 * RAD)
  controls.minDistance = d0 * 0.3
  controls.maxDistance = d0 * 1.25
  controls.addEventListener('start', () => {
    goal = null
    auto = false
    o.onUserMove()
  })

  // ---- The pieces ----
  type Footprint = { x: number; z: number; yaw: number; halfW: number; halfD: number }
  const footprints: Footprint[] = []
  /** Do two footprints on the floor overlap? (Separating axes of two rectangles.) */
  const overlap = (a: Footprint, b: Footprint) => {
    const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2].map((t) => [Math.sin(t), Math.cos(t)])
    const corners = (f: Footprint) =>
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
        const lx = sx * f.halfW
        const lz = sz * f.halfD
        return [f.x + lx * Math.cos(f.yaw) + lz * Math.sin(f.yaw), f.z - lx * Math.sin(f.yaw) + lz * Math.cos(f.yaw)]
      })
    const ca = corners(a)
    const cb = corners(b)
    return axes.every(([ax, az]) => {
      const pa = ca.map(([x, z]) => x * ax + z * az)
      const pb = cb.map(([x, z]) => x * ax + z * az)
      return Math.max(...pa) > Math.min(...pb) + 0.01 && Math.max(...pb) > Math.min(...pa) + 0.01
    })
  }
  type Placed = { id: string; group: THREE.Group; height: number; ready: boolean }
  const placed: Placed[] = []
  const loader = new GLTFLoader()
  const raycaster = new THREE.Raycaster()
  const accent = new THREE.Color(o.accent)
  const disposables: { dispose: () => void }[] = []
  const pieceBoxes = new Map<string, { box: Box; topY: number; centre: THREE.Vector3; reach: number }>()

  const metres = (cm: number | null) => (cm && cm > 0 ? cm / 100 : null)
  const wallBehind = (from: THREE.Vector3, away: THREE.Vector3, reach: number) => {
    raycaster.set(from, away)
    raycaster.far = reach
    const hit = raycaster.intersectObject(shell, false)[0]
    raycaster.far = Infinity
    if (!hit?.face) return null
    const normal = hit.face.normal.clone()
    normal.y = 0
    if (normal.lengthSq() < 0.5) return null // the floor or a slope, not a wall
    normal.normalize()
    if (normal.dot(away) > 0) normal.negate()
    return { point: hit.point, normal }
  }

  // Floor pieces first, so a lamp knows the height of the desk it stands on.
  // Floor pieces first and biggest first (a desk keeps its place, a chair steps clear of it),
  // then what stands on them and what hangs.
  const later = (p: Piece) => Number(HANGS.test(p.slot + p.title) || SITS_ON_TOP.test(p.slot))
  const area = (p: Piece) => (p.widthCm ?? p.box.w * 300) * (p.depthCm ?? p.box.h * 150)
  const order = [...o.pieces].sort((a, b) => later(a) - later(b) || area(b) - area(a))
  for (const p of order) {
    const label = `${p.slot} ${p.title}`
    const cx = p.box.x + p.box.w / 2
    const bottom = ray(cx, p.box.y + p.box.h)
    const group = new THREE.Group()
    let width = metres(p.widthCm)
    let depth = metres(p.depthCm)
    let height = metres(p.heightCm)
    let yaw = 0
    const position = new THREE.Vector3()

    if (HANGS.test(label)) {
      // On the wall: where the middle of its box meets the room.
      raycaster.set(new THREE.Vector3(), ray(cx, p.box.y + p.box.h / 2))
      const hit = raycaster.intersectObject(shell, false)[0]
      if (!hit) continue
      const normal = (hit.face?.normal.clone() ?? new THREE.Vector3(0, 0, 1)).setY(0).normalize()
      if (normal.dot(hit.point) > 0) normal.negate()
      yaw = Math.atan2(normal.x, normal.z)
      width ??= p.box.w * 2 * Math.tan((VFOV * RAD) / 2) * aspect * hit.distance
      height ??= p.box.h * 2 * Math.tan((VFOV * RAD) / 2) * hit.distance
      depth = Math.min(depth ?? 0.04, 0.08)
      position.copy(hit.point).addScaledVector(normal, depth / 2 + 0.01).setY(hit.point.y - height / 2)
    } else {
      // Standing on something: the floor, or the top of the piece whose box holds its foot.
      const foot = { x: cx, y: p.box.y + p.box.h }
      const under = SITS_ON_TOP.test(p.slot)
        ? [...pieceBoxes.values()].find(({ box }) => foot.x > box.x && foot.x < box.x + box.w && foot.y > box.y && foot.y < box.y + box.h * 0.75)
        : undefined
      const standY = under ? under.topY : floorY
      let base = onFloor(bottom, standY)
      if (under && (!base || base.distanceTo(under.centre) > under.reach)) {
        // Near the horizon a ray barely meets the top: stand it where its ray passes over the piece below.
        const n = new THREE.Vector3(under.centre.x, 0, under.centre.z).normalize()
        const t = under.centre.dot(n) / Math.max(1e-3, bottom.dot(n))
        base = bottom.clone().multiplyScalar(t).setY(standY)
      }
      if (!base) {
        // Above the horizon: where the ray meets the room, dropped to the floor.
        raycaster.set(new THREE.Vector3(), bottom)
        const hit = raycaster.intersectObject(shell, false)[0]
        if (!hit) continue
        base = hit.point.clone().setY(standY)
      }
      const facing = new THREE.Vector3(base.x, 0, base.z).normalize()
      const reach = base.length()
      width ??= p.box.w * 2 * Math.tan((VFOV * RAD) / 2) * aspect * reach
      if (!height) {
        const top = ray(cx, p.box.y)
        height = Math.max(0.1, top.multiplyScalar(base.dot(facing) / Math.max(1e-3, top.dot(facing))).y - standY)
        const usual = typicalHeight(label)
        if (usual) height = clamp(height, usual * 0.8, usual * 1.2)
      }
      depth ??= clamp(width * 0.55, 0.3, 1.1)
      // The box's foot is the front edge: its middle is half a depth further from the camera.
      position.copy(base).addScaledVector(facing, under ? 0 : depth / 2)
      yaw = Math.atan2(-facing.x, -facing.z) // facing the camera
      if (!under) {
        const wall = wallBehind(new THREE.Vector3(position.x, standY + height / 2, position.z), facing, depth / 2 + 0.7)
        if (wall) {
          // Backed onto the wall it stands against, square to it.
          yaw = Math.atan2(wall.normal.x, wall.normal.z)
          position.set(wall.point.x, standY, wall.point.z).addScaledVector(wall.normal, depth / 2 + 0.02)
        }
      }
      position.y = standY
      if (!under) {
        // Two pieces never stand in each other: this one steps clear of those already placed.
        const mine: Footprint = { x: position.x, z: position.z, yaw, halfW: width / 2, halfD: depth / 2 }
        for (let step = 0; step < 50 && footprints.some((f) => overlap(f, mine)); step++) {
          const other = footprints.find((f) => overlap(f, mine))!
          const away = new THREE.Vector2(mine.x - other.x, mine.z - other.z)
          if (away.lengthSq() < 1e-6) away.set(facing.z, -facing.x)
          away.normalize().multiplyScalar(0.03)
          mine.x += away.x
          mine.z += away.y
        }
        position.x = mine.x
        position.z = mine.z
        footprints.push(mine)
      }
      pieceBoxes.set(p.id, { box: p.box, topY: standY + height, centre: position.clone().setY(standY + height), reach: Math.max(width, depth) * 0.6 })
    }

    group.position.copy(position)
    group.rotation.y = yaw
    scene.add(group)
    const entry: Placed = { id: p.id, group, height, ready: false }
    placed.push(entry)

    // While its model is being made: an outline of its real size, in the one accent colour.
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
      new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.85 }),
    )
    outline.position.y = height / 2
    group.add(outline)
    o.onPiece(p.id, 'modelling')

    const size = { width, depth, height }
    const asCard = () => {
      if (!o.render) return
      // No model: the piece as the render shows it, on a card standing where it stands.
      const crop = document.createElement('canvas')
      const iw = o.render.naturalWidth
      const ih = o.render.naturalHeight
      crop.width = Math.max(1, Math.round(p.box.w * iw))
      crop.height = Math.max(1, Math.round(p.box.h * ih))
      crop.getContext('2d')!.drawImage(o.render, p.box.x * iw, p.box.y * ih, p.box.w * iw, p.box.h * ih, 0, 0, crop.width, crop.height)
      const texture = new THREE.CanvasTexture(crop)
      texture.colorSpace = THREE.SRGBColorSpace
      const card = new THREE.Mesh(new THREE.PlaneGeometry(size.width, size.height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
      card.position.y = size.height / 2
      card.rotation.y = Math.atan2(-group.position.x, -group.position.z) - group.rotation.y
      group.remove(outline)
      group.add(card)
      disposables.push(texture, card.geometry, card.material as THREE.Material)
      entry.ready = true
      o.onPiece(p.id, 'card')
    }

    if (!p.model) {
      asCard()
      continue
    }
    p.model
      .then((url) => loader.loadAsync(url))
      .then((gltf) => {
        if (disposed) return
        const model = gltf.scene
        model.rotation.y = MODEL_FRONT_YAW
        model.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(model)
        const dims = bounds.getSize(new THREE.Vector3())
        // One scale for all three sides (no stretching): the listed height when there is one.
        const k = metres(p.heightCm) ? size.height / dims.y : Math.min(size.width / Math.max(dims.x, 1e-3), size.height / Math.max(dims.y, 1e-3))
        model.scale.setScalar(k)
        const centre = bounds.getCenter(new THREE.Vector3())
        model.position.set(-centre.x * k, -bounds.min.y * k, -centre.z * k)
        model.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = true
          mesh.receiveShadow = true
        })
        const pivot = new THREE.Group()
        pivot.add(model)
        pivot.scale.setScalar(0.001)
        group.remove(outline)
        group.add(pivot)
        entry.height = dims.y * k
        entry.ready = true
        growing.push({ pivot, t: 0 })
        o.onPiece(p.id, 'ready')
      })
      .catch(() => {
        if (!disposed) asCard()
      })
    disposables.push(outline.geometry, outline.material as THREE.Material)
  }
  // ---- The loop ----
  let raf = 0
  let phase = 0
  let last = performance.now()
  const resize = () => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // Wider than the photo on a narrow screen: show all of it rather than crop the room.
    camera.fov = Math.max(VFOV, (2 * Math.atan(Math.tan((VFOV * RAD) / 2) * aspect / camera.aspect)) / RAD)
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  const offset = new THREE.Vector3()
  const current = new THREE.Spherical()
  const tmp = new THREE.Vector3()
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (auto) {
      phase += dt * SWAY.speed
      goal = new THREE.Spherical(goal?.radius ?? current.radius, goal?.phi ?? current.phi, start.theta + SWAY.deg * RAD * Math.sin(phase))
    }
    if (goal) {
      offset.copy(camera.position).sub(controls.target)
      current.setFromVector3(offset)
      const k = 1 - Math.exp(-dt * (auto ? 2 : 4))
      current.theta += (goal.theta - current.theta) * k
      current.phi += (goal.phi - current.phi) * k
      current.radius += (goal.radius - current.radius) * k
      camera.position.copy(controls.target).add(offset.setFromSpherical(current))
      camera.lookAt(controls.target)
    }
    controls.update()
    // The photo's edges fade only once the camera has left where the photo was taken.
    const moved = camera.position.length() / Math.max(0.01, d0)
    shellMat.uniforms.uFade.value = clamp(moved * 6, 0, 1)
    for (const g of growing) {
      g.t = Math.min(1, g.t + dt / 0.5)
      const e = 1 - Math.pow(1 - g.t, 3)
      g.pivot.scale.setScalar(Math.max(0.001, e))
    }
    renderer.render(scene, camera)

    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    o.onPins(
      placed.map(({ id, group, height }) => {
        tmp.set(0, height, 0).applyMatrix4(group.matrixWorld).project(camera)
        const ahead = tmp.z < 1
        const x = ((tmp.x + 1) / 2) * cw
        const y = ((1 - tmp.y) / 2) * ch
        return { id, x, y, visible: ahead && x > -20 && y > -20 && x < cw + 20 && y < ch + 20 }
      }),
    )
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  return {
    aim: (v) => {
      auto = false
      goal = new THREE.Spherical(start.radius * clamp(v.zoom, 0.3, 1.25), clamp(start.phi - v.pitch * RAD, controls.minPolarAngle, controls.maxPolarAngle), start.theta + v.yaw * RAD)
    },
    setAuto: (on) => {
      if (on && !auto) {
        offset.copy(camera.position).sub(controls.target)
        current.setFromVector3(offset)
        phase = Math.asin(clamp((current.theta - start.theta) / (SWAY.deg * RAD), -1, 1))
      }
      auto = on
      if (!on) goal = null
    },
    dispose: () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      controls.dispose()
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose()
          m.dispose()
        }
      })
      disposables.forEach((d) => d.dispose())
      photoTexture.dispose()
      environment.dispose()
      pmrem.dispose()
      renderer.dispose()
    },
  }
}
