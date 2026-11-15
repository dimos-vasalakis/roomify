/**
 * The furnished room as a real 3D scene (three.js), to walk all the way round.
 *
 * - The room is a floor and four walls with the photo painted on them (`roomShell.ts`). A wall
 *   fades away while the camera is behind it, like a doll's house, so every side can be seen.
 * - Every piece is a real 3D model made from the shop's own photos of it, placed where the render
 *   put it (`placement.ts`) at its listed size. Soft shadows tie it to the floor. A rug lies flat
 *   with the shop's photo on it. A piece whose model can't be made stands as a card cut from the
 *   render.
 * - The camera starts exactly where the photo was taken, so the preview dissolves into it.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { HANGS, placePieces, type Box, type Placement } from './placement'
import { RAD, buildRoom, clamp, type Geometry, type Surface } from './roomShell'

export type { Box }
export type Piece = {
  id: string
  slot: string
  title: string
  /** Where the render put it, 0 to 1 of the frame. */
  box: Box
  widthCm: number | null
  depthCm: number | null
  heightCm: number | null
  /** The shop's photo: laid on a rug. */
  photo: string | null
  /** Resolves to the GLB of the product, made from its shop photos. */
  model: Promise<string> | null
  /** Already in the room (cut out of the photo), not one of the chosen pieces. */
  existing?: boolean
  onTop?: boolean
}
export type PieceState = 'modelling' | 'ready' | 'card'
export type Pin = { id: string; x: number; y: number; visible: boolean }
export type ViewName = 'photo' | 'front' | 'left' | 'right' | 'back' | 'top'
export type Scene3D = {
  view: (name: ViewName) => void
  /** Circle one piece, close, to see it from every side; null goes back to the room. */
  focus: (id: string | null) => void
  setAuto: (on: boolean) => void
  dispose: () => void
}
type Options = {
  photo: HTMLImageElement
  depth: HTMLImageElement
  /** The room measured in metres, when the back end could. */
  geometry: Geometry | null
  render: HTMLImageElement | null
  pieces: Piece[]
  ground: string
  paper: string
  accent: string
  onPins: (pins: Pin[]) => void
  onPiece: (id: string, state: PieceState) => void
  onPick: (id: string) => void
  onUserMove: () => void
}

const WALL = 0.1 // thickness, shown where a wall is cut
const ELEVATION = 36 * RAD
// Each named side, as a turn round the room from the side the photo was taken.
const SIDE_DEG: Record<Exclude<ViewName, 'photo'>, number> = { front: 24, right: 90, back: 180, left: -90, top: 0 }
const FADE_S = 0.25
const FLY_S = 1.5

type Pose = { target: THREE.Vector3; spherical: THREE.Spherical }

export function createScene(canvas: HTMLCanvasElement, o: Options): Scene3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(o.ground)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = environment
  scene.environmentIntensity = 0.6

  const room = buildRoom(
    o.photo,
    o.depth,
    o.pieces.map((p) => ({ box: p.box, heightCm: p.heightCm, hangs: HANGS.test(`${p.slot} ${p.title}`) })),
    o.geometry,
    // What already stands there is modelled, so it isn't also painted on the floor and walls.
    o.pieces.filter((p) => p.existing).map((p) => p.box),
  )
  const { floorY, ceilingY } = room
  const centre = room.at((room.s0 + room.s1) / 2, (room.t0 + room.t1) / 2, floorY)
  const paper = new THREE.Color(o.paper)

  // ---- The room: painted surfaces, a wall's cut edge in paper, a slab under it all ----
  type Wall = { surface: Surface; mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; cap: THREE.Mesh; opacity: number }
  const walls: Wall[] = []
  const textures: THREE.Texture[] = []
  for (const surface of room.surfaces) {
    const texture = new THREE.CanvasTexture(surface.canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    textures.push(texture)
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    const mesh = new THREE.Mesh(quad(surface), material)
    scene.add(mesh)
    if (surface.name === 'floor') continue
    // The wall's top, cut: a strip of paper as thick as the wall, so it reads as a model.
    const along = surface.u.clone().multiplyScalar(surface.lu)
    const outward = surface.inward.clone().negate().multiplyScalar(WALL)
    const a = surface.origin.clone().setY(ceilingY).addScaledVector(surface.u, -WALL)
    const capGeometry = new THREE.BufferGeometry().setFromPoints([
      a,
      a.clone().add(along).addScaledVector(surface.u, 2 * WALL),
      a.clone().add(along).addScaledVector(surface.u, 2 * WALL).add(outward),
      a.clone().add(outward),
    ])
    capGeometry.setIndex([0, 2, 1, 0, 3, 2])
    const cap = new THREE.Mesh(capGeometry, new THREE.MeshBasicMaterial({ color: paper, side: THREE.DoubleSide, transparent: true }))
    scene.add(cap)
    walls.push({ surface, mesh, material, cap, opacity: 1 })
  }
  const slabW = room.s1 - room.s0 + 2 * WALL
  const slabD = room.t1 - room.t0 + 2 * WALL
  const slab = new THREE.Mesh(new THREE.BoxGeometry(slabW, 0.12, slabD), new THREE.MeshBasicMaterial({ color: paper }))
  slab.position.copy(centre).setY(floorY - 0.061)
  slab.rotation.y = Math.atan2(room.axisS.x, room.axisS.z) - Math.PI / 2
  scene.add(slab)

  // Soft shadows on the floor, nothing else drawn there.
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(slabW, slabD), new THREE.ShadowMaterial({ opacity: 0.34 }))
  catcher.rotation.set(-Math.PI / 2, 0, slab.rotation.y)
  catcher.position.copy(centre).setY(floorY + 0.004)
  catcher.receiveShadow = true
  scene.add(catcher)

  // Light: a soft sky, and one high key light for the shadows, from the photo's side.
  scene.add(new THREE.HemisphereLight(0xfffaf2, 0x5a5048, 1.15))
  const key = new THREE.DirectionalLight(0xffffff, 1.7)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.radius = 5
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.02
  key.position.copy(centre).addScaledVector(room.axisT, 2.2).addScaledVector(room.axisS, -1.6).setY(floorY + 5)
  key.target.position.copy(centre)
  const span = Math.max(slabW, slabD) / 2 + 0.5
  Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.5, far: 14 })
  key.shadow.camera.updateProjectionMatrix()
  scene.add(key, key.target)

  // ---- The camera ----
  const camera = new THREE.PerspectiveCamera(room.vfov, 1.5, 0.05, 100)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.rotateSpeed = 0.6
  controls.zoomSpeed = 0.8
  controls.minDistance = 0.6
  controls.maxPolarAngle = 88 * RAD
  controls.autoRotateSpeed = 0.7

  const photoTarget = room.ray(0.5, 0.5).multiplyScalar(clamp(-room.t0 * 0.6, 1.5, 6))
  const roomRadius = 0.5 * Math.hypot(room.s1 - room.s0, room.t1 - room.t0, ceilingY - floorY)
  controls.maxDistance = roomRadius * 4
  const poseOf = (target: THREE.Vector3, from: THREE.Vector3): Pose => ({ target, spherical: new THREE.Spherical().setFromVector3(from.clone().sub(target)) })
  const photoPose = poseOf(photoTarget, new THREE.Vector3())
  /** Facing the room from one side, far enough to see all of it. */
  const sidePose = (name: Exclude<ViewName, 'photo'>): Pose => {
    const turn = SIDE_DEG[name] * RAD
    const dir = room.axisT.clone().multiplyScalar(Math.cos(turn)).addScaledVector(room.axisS, Math.sin(turn))
    const distance = (roomRadius / Math.sin((camera.fov * RAD) / 2)) * 1.02
    const target = centre.clone().setY(floorY + 0.7)
    const elevation = name === 'top' ? 86 * RAD : ELEVATION
    return { target, spherical: new THREE.Spherical(distance, Math.PI / 2 - elevation, Math.atan2(dir.x, dir.z)) }
  }
  const apply = (pose: Pose) => {
    controls.target.copy(pose.target)
    camera.position.setFromSpherical(pose.spherical).add(pose.target)
    camera.lookAt(pose.target)
  }
  apply(photoPose)
  controls.update()

  // A flight from where the camera is to a pose: round the target, never through the room.
  let flight: { from: Pose; to: Pose; t: number } | null = null
  const fly = (to: Pose) => {
    const from = poseOf(controls.target.clone(), camera.position)
    // The short way round.
    let dTheta = to.spherical.theta - from.spherical.theta
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta))
    to = { target: to.target, spherical: new THREE.Spherical(to.spherical.radius, to.spherical.phi, from.spherical.theta + dTheta) }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply(to)
      flight = null
      return
    }
    flight = { from, to, t: 0 }
  }

  let disposed = false
  let auto = false
  controls.addEventListener('start', () => {
    flight = null
    auto = false
    o.onUserMove()
  })

  // ---- The pieces ----
  const placements = placePieces(room, o.pieces)
  type Placed = { id: string; group: THREE.Group; place: Placement; top: number; existing: boolean }
  const placed: Placed[] = []
  const loader = new GLTFLoader()
  const accent = new THREE.Color(o.accent)
  const growing: { pivot: THREE.Object3D; t: number }[] = []
  const billboards: THREE.Mesh[] = []
  const textureLoader = new THREE.TextureLoader().setCrossOrigin('anonymous')

  for (const place of placements) {
    const p = o.pieces.find((x) => x.id === place.id)!
    const group = new THREE.Group()
    group.position.copy(place.position)
    group.rotation.y = place.yaw
    group.userData.pieceId = p.id
    scene.add(group)
    const entry: Placed = { id: p.id, group, place, top: place.height, existing: !!p.existing }
    placed.push(entry)
    const { width, depth, height } = place

    if (place.kind === 'lies') {
      // A rug: the shop's photo, flat on the floor at its listed size.
      const material = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 1 })
      const rug = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
      rug.position.y = height / 2
      rug.receiveShadow = true
      group.add(rug)
      if (p.photo)
        textureLoader.load(p.photo, (texture) => {
          if (disposed) return texture.dispose()
          texture.colorSpace = THREE.SRGBColorSpace
          material.map = texture
          material.color.set(0xffffff)
          material.needsUpdate = true
        })
      o.onPiece(p.id, 'ready')
      continue
    }

    // While its model is being made: an outline of its real size, in the one accent colour.
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
      new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.9 }),
    )
    outline.position.y = height / 2
    group.add(outline)
    o.onPiece(p.id, 'modelling')

    const asCard = () => {
      group.remove(outline)
      if (!o.render) return
      // No model: the piece as the render shows it, on a card that turns to face the camera.
      const crop = document.createElement('canvas')
      const iw = o.render.naturalWidth
      const ih = o.render.naturalHeight
      crop.width = Math.max(1, Math.round(p.box.w * iw))
      crop.height = Math.max(1, Math.round(p.box.h * ih))
      crop.getContext('2d')!.drawImage(o.render, p.box.x * iw, p.box.y * ih, p.box.w * iw, p.box.h * ih, 0, 0, crop.width, crop.height)
      const texture = new THREE.CanvasTexture(crop)
      texture.colorSpace = THREE.SRGBColorSpace
      const card = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }))
      card.position.y = height / 2
      group.add(card)
      billboards.push(card)
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
        fitModel(model, place, p)
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
        entry.top = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y
        growing.push({ pivot, t: 0 })
        o.onPiece(p.id, 'ready')
      })
      .catch(() => {
        if (!disposed) asCard()
      })
  }

  // ---- Picking a piece: a click, not a drag ----
  const raycaster = new THREE.Raycaster()
  let down: { x: number; y: number } | null = null
  const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
    down = null
    const rect = canvas.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera)
    const hit = raycaster.intersectObjects(placed.filter((x) => !x.existing).map((x) => x.group), true)[0]
    let node: THREE.Object3D | null = hit?.object ?? null
    while (node && !node.userData.pieceId) node = node.parent
    if (node) o.onPick(node.userData.pieceId as string)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)

  // ---- The loop ----
  let raf = 0
  let last = performance.now()
  const resize = () => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // Wider than the photo on a narrow screen: show all of it rather than crop the room.
    camera.fov = Math.max(room.vfov, (2 * Math.atan((Math.tan((room.vfov * RAD) / 2) * room.aspect) / camera.aspect)) / RAD)
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  const toCamera = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / FLY_S)
      const e = ease(flight.t)
      const { from, to } = flight
      const target = from.target.clone().lerp(to.target, e)
      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(from.spherical.radius, to.spherical.radius, e),
        THREE.MathUtils.lerp(from.spherical.phi, to.spherical.phi, e),
        THREE.MathUtils.lerp(from.spherical.theta, to.spherical.theta, e),
      )
      apply({ target, spherical: s })
      if (flight.t >= 1) flight = null
    }
    controls.autoRotate = auto && !flight
    controls.update(dt)

    // A wall the camera is behind fades away, so the room stays open to look into.
    for (const w of walls) {
      toCamera.copy(camera.position).sub(w.surface.origin)
      const goal = toCamera.dot(w.surface.inward) > 0.05 ? 1 : 0
      w.opacity += clamp(goal - w.opacity, -dt / FADE_S, dt / FADE_S)
      w.material.opacity = w.opacity
      w.material.transparent = w.opacity < 1
      w.material.depthWrite = w.opacity > 0.5
      w.mesh.visible = w.opacity > 0.01
      ;(w.cap.material as THREE.MeshBasicMaterial).opacity = w.opacity
      w.cap.visible = w.opacity > 0.01
    }
    for (const card of billboards) {
      const parent = card.parent!
      parent.getWorldPosition(tmp)
      card.rotation.y = Math.atan2(camera.position.x - tmp.x, camera.position.z - tmp.z) - parent.rotation.y
    }
    for (const g of growing) {
      g.t = Math.min(1, g.t + dt / 0.5)
      g.pivot.scale.setScalar(Math.max(0.001, 1 - Math.pow(1 - g.t, 3)))
    }
    renderer.render(scene, camera)

    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    o.onPins(
      placed.filter((x) => !x.existing).map(({ id, group, top }) => {
        tmp.set(0, top, 0).applyMatrix4(group.matrixWorld).project(camera)
        const x = ((tmp.x + 1) / 2) * cw
        const y = ((1 - tmp.y) / 2) * ch
        return { id, x, y, visible: tmp.z < 1 && x > -20 && y > -20 && x < cw + 20 && y < ch + 20 }
      }),
    )
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  return {
    view: (name) => {
      auto = false
      fly(name === 'photo' ? photoPose : sidePose(name))
    },
    focus: (id) => {
      const item = placed.find((x) => x.id === id)
      if (!item) {
        fly(sidePose('front'))
        return
      }
      const { place, group } = item
      const size = Math.max(place.width, place.depth, item.top)
      const target = group.position.clone().setY(group.position.y + item.top / 2)
      // From in front of it and a little to the side, then round it.
      const front = new THREE.Vector3(Math.sin(place.yaw + 0.5), 0, Math.cos(place.yaw + 0.5))
      fly({ target, spherical: new THREE.Spherical(clamp(size * 2.1, 1.1, 7), Math.PI / 2 - 24 * RAD, Math.atan2(front.x, front.z)) })
    },
    setAuto: (on) => {
      auto = on
    },
    dispose: () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      controls.dispose()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh && !(child as THREE.LineSegments).isLineSegments) return
        mesh.geometry?.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          if (!m) continue
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose()
          m.dispose()
        }
      })
      textures.forEach((t) => t.dispose())
      environment.dispose()
      pmrem.dispose()
      renderer.dispose()
    },
  }
}

/** A surface as two triangles facing into the room, its texture running from `origin`. */
function quad(s: Surface) {
  const a = s.origin
  const b = a.clone().addScaledVector(s.u, s.lu)
  const c = b.clone().addScaledVector(s.v, s.lv)
  const d = a.clone().addScaledVector(s.v, s.lv)
  const geometry = new THREE.BufferGeometry().setFromPoints([a, b, c, d])
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}

/**
 * A generated model at the piece's listed size, standing on its base, front (+Z) forward.
 * One scale for all three sides from the listed height; width and depth then meet the listing
 * within a few percent (more would stretch the shop's own shape).
 */
function fitModel(model: THREE.Object3D, place: Placement, p: Piece) {
  model.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(model)
  const dims = bounds.getSize(new THREE.Vector3())
  // Already in the room: as tall as the photo measured it, its own shape kept (only part of it may
  // have been in the photo, so its measured width only caps it).
  if (p.existing) {
    const k = Math.min(place.height / Math.max(dims.y, 1e-3), (place.width * 1.4) / Math.max(dims.x, 1e-3))
    const c = bounds.getCenter(new THREE.Vector3())
    model.scale.setScalar(k)
    model.position.set(-c.x * k, -bounds.min.y * k, -c.z * k)
    return
  }
  const k = p.heightCm ? place.height / Math.max(dims.y, 1e-3) : Math.min(place.width / Math.max(dims.x, 1e-3), place.height / Math.max(dims.y, 1e-3))
  const sx = p.widthCm ? clamp(place.width / (dims.x * k), 0.85, 1.18) : 1
  const sz = p.depthCm ? clamp(place.depth / (dims.z * k), 0.85, 1.18) : 1
  model.scale.set(k * sx, k, k * sz)
  const centre = bounds.getCenter(new THREE.Vector3())
  model.position.set(-centre.x * k * sx, -bounds.min.y * k, -centre.z * k * sz)
}
