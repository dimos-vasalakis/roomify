/**
 * The furnished room as a 3D mesh, in plain WebGL2.
 *
 * Every pixel of the render is pushed back along its own camera ray by the depth map, so from
 * the original camera the mesh looks exactly like the render, and from anywhere else you see
 * the room's real shape. Two layers:
 * - the room as photographed, cut cleanly wherever the depth jumps (the edge of a desk against
 *   the wall behind it), so pieces stand free instead of smearing into the wall;
 * - behind it, the room as if the pieces were gone: the walls and floor carried on behind each
 *   piece and softly filled in from the colours around it. It is only seen in the gaps a moved
 *   camera opens up, slightly muted, so it never passes for photographed detail.
 */

export type View = { yaw: number; pitch: number; zoom: number }
/** A point to keep a label on: the product's box on the render, 0 to 1. */
export type Anchor = { id: string; box: { x: number; y: number; w: number; h: number } }
export type Projected = { id: string; x: number; y: number; visible: boolean }
type Vec3 = [number, number, number]
type Rgb = [number, number, number]

export type RoomView = {
  /** Ease the camera toward this view. */
  aim: (v: Partial<View>) => void
  /** Put the camera here at once. */
  jump: (v: View) => void
  nudge: (yaw: number, pitch: number) => void
  zoomBy: (factor: number) => void
  /** The scan front, in nearness: 1 builds nothing, below 0 everything is built. */
  setFront: (front: number) => void
  /** A slow sway left and right, for when nobody is touching it. */
  setAuto: (on: boolean) => void
  onFrame: (fn: (pins: Projected[]) => void) => void
  dispose: () => void
}

export const FRONT: View = { yaw: 0, pitch: 0, zoom: 1 }
const VFOV_DEG = 50 // a phone's main camera, landscape
const NEAR_M = 1.2
const FAR_M = 4.2
/** Mesh columns: about one vertex per 2.5 render pixels. */
const COLS = 480
/** A jump in nearness (0 to 1) this much bigger than the surface's own slope is the edge of a piece. */
const BREAK = 0.034
/** The background layer reaches this far behind a piece, as a share of the width. */
const REACH = 0.035
const LIMIT = { yaw: 30, pitchMin: -8, pitchMax: 22, zoomMin: 0.5, zoomMax: 1.15 }
const SWAY = { deg: 14, speed: 0.32 }
const RAD = Math.PI / 180

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

function perspective(fovyDeg: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan((fovyDeg * RAD) / 2)
  const nf = 1 / (near - far)
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0])
}

function lookAt(eye: Vec3, target: Vec3) {
  const z = normalize(sub(eye, target))
  const x = normalize(cross([0, 1, 0], z))
  const y = cross(z, x)
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1])
}

function multiply(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(16)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[i + 4 * k] * b[k + 4 * j]
      out[i + 4 * j] = sum
    }
  return out
}

function pixels(img: HTMLImageElement, w: number, h: number) {
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
function readNearness(depth: HTMLImageElement, w: number, h: number) {
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
const smoothKeepingEdges = (src: Float32Array, w: number, h: number, r: number, sigma: number) =>
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

const extreme = (src: Float32Array, w: number, h: number, r: number) =>
  separable(src, w, h, (get, n, out) => {
    for (let i = 0; i < n; i++) {
      let m = -Infinity
      for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) m = Math.max(m, get(k))
      out(i, m)
    }
  })

const mean = (src: Float32Array, w: number, h: number, r: number) =>
  separable(src, w, h, (get, n, out) => {
    // Running sum: O(1) per sample whatever the radius.
    let sum = 0
    let lo = 0
    let hi = -1
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - r)
      const b = Math.min(n - 1, i + r)
      while (hi < b) sum += get(++hi)
      while (lo < a) sum -= get(lo++)
      out(i, sum / (b - a + 1))
    }
  })

/**
 * Depth maps blur a piece's outline into a ramp from the wall to the piece: points floating in
 * mid-air that smear the piece sideways once the camera moves. Where the depth changes a lot in a
 * small neighbourhood, each point is snapped to the nearer or the farther side, whichever is closer.
 */
function sharpenEdges(src: Float32Array, w: number, h: number, r: number, range: number) {
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

/**
 * Fills the holes of an image from what is beside them. Rooms are built of walls and floors that
 * run sideways, so each row of a hole blends from the colour on its left to the colour on its
 * right, then the rows are softened together so the fill carries no streaks.
 */
function fillHoles(rgb: Float32Array, known: Float32Array, w: number, h: number) {
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      if (known[y * w + x]) {
        x++
        continue
      }
      const start = x
      while (x < w && !known[y * w + x]) x++
      const left = start > 0 ? (y * w + start - 1) * 3 : -1
      const right = x < w ? (y * w + x) * 3 : -1
      for (let i = start; i < x; i++) {
        const t = left < 0 ? 1 : right < 0 ? 0 : (i - start + 1) / (x - start + 1)
        for (let c = 0; c < 3; c++) {
          const l = left < 0 ? rgb[right + c] : rgb[left + c]
          const r = right < 0 ? rgb[left + c] : rgb[right + c]
          rgb[(y * w + i) * 3 + c] = left < 0 && right < 0 ? 0.5 : l * (1 - t) + r * t
        }
      }
    }
  }
  // Soften the filled rows into each other; what was photographed stays untouched.
  const r = 4
  const soft = new Float32Array(rgb)
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      if (known[y * w + x]) continue
      for (let c = 0; c < 3; c++) {
        let sum = 0
        let n = 0
        for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
          sum += rgb[(k * w + x) * 3 + c]
          n++
        }
        soft[(y * w + x) * 3 + c] = sum / n
      }
    }
  return soft
}

const distanceOf = (near: number) => 1 / (1 / FAR_M + near * (1 / NEAR_M - 1 / FAR_M))

const VERT = `#version 300 es
in vec3 aPos;
in vec2 aUv;
in float aNear;
uniform mat4 uViewProj;
out vec2 vUv;
out float vNear;
void main() {
  vUv = aUv;
  vNear = aNear;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in float vNear;
uniform sampler2D uColor;
uniform float uFront;
uniform vec3 uAccent;
uniform vec3 uGround;
uniform float uBehind;
uniform float uShade;
out vec4 outColor;
void main() {
  vec3 c = texture(uColor, vUv).rgb;
  // Filled in, not photographed: a little muted once the camera has moved, never passed off as detail.
  if (uBehind > 0.5) c = mix(c, mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 0.8) * 0.96, uShade);
  // The scan: what is not read yet sits in shadow; the front itself is a thin accent grid.
  float built = vNear - uFront;
  if (built < 0.0) c *= 0.28;
  float band = built >= 0.0 ? 1.0 - smoothstep(0.0, 0.06, built) : 0.0;
  vec2 g = abs(fract(vUv * vec2(96.0, 64.0)) - 0.5);
  float line = step(0.42, max(g.x, g.y));
  c = mix(c, uAccent, band * (0.2 + 0.8 * line));
  // The picture's own edges fade into the room's darkness instead of ending in a hard frame.
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.03, min(e.x, e.y));
  outColor = vec4(mix(uGround, c, mix(1.0, edge, uShade)), 1.0);
}`

function shader(gl: WebGL2RenderingContext, type: number, source: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, source)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
  return s
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Couldn't load the room's picture."))
    img.src = src
  })
}

/** The room behind the pieces: walls and floor carried on, coloured from what surrounds each piece. */
function behindPieces(color: HTMLImageElement, front: Float32Array, w: number, h: number) {
  const reach = Math.max(2, Math.round(COLS * REACH))
  // The farthest surface nearby, smoothed into a continuous wall and floor.
  const far = mean(extreme(front, w, h, reach), w, h, reach)
  const back = new Float32Array(front.length)
  // A piece: clearly in front of the room behind it, widened a little so its own edge colours stay out.
  const piece = new Float32Array(front.length)
  for (let k = 0; k < front.length; k++) {
    back[k] = Math.max(far[k], front[k])
    piece[k] = front[k] * 1.06 < back[k] ? 1 : 0
  }
  const grown = extreme(piece, w, h, 2)

  // Colour at the grid's size: the hidden area's colour is soft by nature.
  const img = pixels(color, w, h).data
  const rgb = new Float32Array(w * h * 3)
  const known = new Float32Array(w * h)
  for (let k = 0; k < w * h; k++) {
    rgb[k * 3] = img[k * 4] / 255
    rgb[k * 3 + 1] = img[k * 4 + 1] / 255
    rgb[k * 3 + 2] = img[k * 4 + 2] / 255
    known[k] = grown[k] > 0 ? 0 : 1
  }
  const fill = fillHoles(rgb, known, w, h)
  const tex = new Uint8Array(w * h * 4)
  for (let k = 0; k < w * h; k++) {
    tex[k * 4] = fill[k * 3] * 255
    tex[k * 4 + 1] = fill[k * 3 + 1] * 255
    tex[k * 4 + 2] = fill[k * 3 + 2] * 255
    tex[k * 4 + 3] = 255
  }
  return { back, tex }
}

export function createRoomView(
  canvas: HTMLCanvasElement,
  color: HTMLImageElement,
  depth: HTMLImageElement,
  anchors: Anchor[],
  colors: { accent: Rgb; ground: Rgb },
): RoomView {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })
  if (!gl) throw new Error("This browser can't show the room in 3D.")

  // The grid: one vertex per grid point.
  const aspect = color.naturalWidth / color.naturalHeight
  const rows = Math.round(COLS / aspect)
  const w = COLS + 1
  const h = rows + 1
  const near = smoothKeepingEdges(sharpenEdges(readNearness(depth, w, h), w, h, 2, 0.12), w, h, 3, 0.04)
  const dist = new Float32Array(near.length)
  for (let k = 0; k < near.length; k++) dist[k] = distanceOf(near[k])
  const { back, tex } = behindPieces(color, dist, w, h)

  const tanY = Math.tan((VFOV_DEG * RAD) / 2)
  const tanX = tanY * aspect
  const place = (u: number, v: number, d: number): Vec3 => [(u * 2 - 1) * tanX * d, (1 - v * 2) * tanY * d, -d]
  const pos = new Float32Array(w * h * 3)
  const backPos = new Float32Array(w * h * 3)
  const uv = new Float32Array(w * h * 2)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = j * w + i
      pos.set(place(i / COLS, j / rows, dist[k]), k * 3)
      // A little further back, so the two layers never fight where they meet.
      backPos.set(place(i / COLS, j / rows, back[k] * 1.02), k * 3)
      uv.set([i / COLS, j / rows], k * 2)
    }

  // The front layer leaves out every triangle that spans a break in the surface: those were never
  // surfaces. A flat surface, however steeply it is seen (a desk top, the floor), is a straight
  // line in nearness, so only a jump the neighbours can't explain counts as a break.
  const at = (i: number, j: number) => (i >= 0 && i <= COLS && j >= 0 && j <= rows ? near[j * w + i] : null)
  /** Does the surface break between grid points p and q (neighbours, diagonals included)? */
  const breaks = (p: number, q: number) => {
    const [pi, pj, qi, qj] = [p % w, Math.floor(p / w), q % w, Math.floor(q / w)]
    const [di, dj] = [qi - pi, qj - pj]
    const np = near[p]
    const nq = near[q]
    const step = Math.abs(nq - np)
    if (step <= BREAK) return false
    // Carry each side's own slope across the gap: a flat surface lands on the other side, a piece's edge doesn't.
    const beforeP = at(pi - di, pj - dj)
    const afterQ = at(qi + di, qj + dj)
    const fromP = beforeP === null ? np : np + (np - beforeP)
    const fromQ = afterQ === null ? nq : nq + (nq - afterQ)
    return Math.min(Math.abs(nq - fromP), Math.abs(np - fromQ)) > BREAK
  }
  const all = new Uint32Array(COLS * rows * 6)
  const cut = new Uint32Array(COLS * rows * 6)
  let na = 0
  let nc = 0
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < COLS; i++) {
      const a = j * w + i
      const b = a + 1
      const c = a + w
      const d = a + w + 1
      // Split each square along its smoother diagonal, so edges follow the pieces more closely.
      const tris =
        Math.abs(near[a] - near[d]) < Math.abs(near[b] - near[c])
          ? [[a, c, d], [a, d, b]]
          : [[a, c, b], [b, c, d]]
      for (const [x, y, z] of tris) {
        all.set([x, y, z], na)
        na += 3
        if (!breaks(x, y) && !breaks(y, z) && !breaks(x, z)) {
          cut.set([x, y, z], nc)
          nc += 3
        }
      }
    }
  const frontIndex = cut.subarray(0, nc)

  // Nearness sampled over part of the grid, for the orbit centre and the labels.
  const region = (x0: number, y0: number, x1: number, y1: number) => {
    const out: number[] = []
    for (let j = Math.floor(y0 * rows); j <= Math.ceil(y1 * rows); j++)
      for (let i = Math.floor(x0 * COLS); i <= Math.ceil(x1 * COLS); i++) out.push(near[clamp(j, 0, rows) * w + clamp(i, 0, COLS)])
    return out.sort((a, b) => a - b)
  }
  // Circle the furniture, not the back wall: a nearer centre keeps the camera from walking into the room.
  const centre = region(0.25, 0.45, 0.75, 0.9)
  const d0 = distanceOf(centre[Math.floor(centre.length * 0.6)])
  const target: Vec3 = [0, 0, -d0]
  const pins = anchors.map(({ id, box }) => {
    // The nearest surfaces inside the middle of the box: the piece, not the wall behind it.
    const s = region(box.x + box.w * 0.2, box.y + box.h * 0.2, box.x + box.w * 0.8, box.y + box.h * 0.8)
    return { id, at: place(box.x + box.w / 2, box.y + box.h / 2, distanceOf(s[Math.floor(s.length * 0.8)] ?? 0.5)) }
  })

  // GPU side.
  const program = gl.createProgram()!
  const vs = shader(gl, gl.VERTEX_SHADER, VERT)
  const fs = shader(gl, gl.FRAGMENT_SHADER, FRAG)
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("This browser can't show the room in 3D.")
  gl.useProgram(program)
  const buffers: WebGLBuffer[] = []
  const layer = (positions: Float32Array, index: Uint32Array) => {
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    for (const [name, data, size] of [['aPos', positions, 3], ['aUv', uv, 2], ['aNear', near, 1]] as const) {
      const b = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
      buffers.push(b)
    }
    const ib = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW)
    buffers.push(ib)
    gl.bindVertexArray(null)
    return { vao, count: index.length }
  }
  const front = layer(pos, frontIndex)
  const behind = layer(backPos, all)

  const texture = (fill: () => void) => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    fill()
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))
    return t
  }
  const photo = texture(() => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, color))
  const filled = texture(() => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, tex))

  const uViewProj = gl.getUniformLocation(program, 'uViewProj')
  const uFront = gl.getUniformLocation(program, 'uFront')
  const uBehind = gl.getUniformLocation(program, 'uBehind')
  const uShade = gl.getUniformLocation(program, 'uShade')
  gl.activeTexture(gl.TEXTURE0)
  gl.uniform1i(gl.getUniformLocation(program, 'uColor'), 0)
  gl.uniform3fv(gl.getUniformLocation(program, 'uAccent'), colors.accent)
  gl.uniform3fv(gl.getUniformLocation(program, 'uGround'), colors.ground)
  gl.uniform1f(uFront, -1)
  gl.enable(gl.DEPTH_TEST)
  gl.clearColor(...colors.ground, 1)

  // The camera: circles the middle of the room; at FRONT it stands where the photo was taken.
  const now: View = { ...FRONT }
  const goal: View = { ...FRONT }
  const keep = (v: View) => {
    v.yaw = clamp(v.yaw, -LIMIT.yaw, LIMIT.yaw)
    v.pitch = clamp(v.pitch, LIMIT.pitchMin, LIMIT.pitchMax)
    v.zoom = clamp(v.zoom, LIMIT.zoomMin, LIMIT.zoomMax)
  }
  const eyeOf = (v: View): Vec3 => {
    const r = d0 * v.zoom
    const y = v.yaw * RAD
    const p = v.pitch * RAD
    return [r * Math.sin(y) * Math.cos(p), r * Math.sin(p), -d0 + r * Math.cos(y) * Math.cos(p)]
  }
  let auto = false
  let phase = 0
  let listener: ((pins: Projected[]) => void) | null = null

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr))
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr))
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  let last = performance.now()
  let raf = 0
  const frame = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000)
    last = t
    if (auto) {
      phase += dt * SWAY.speed
      goal.yaw = SWAY.deg * Math.sin(phase)
    }
    const k = 1 - Math.exp(-dt * 5)
    now.yaw += (goal.yaw - now.yaw) * k
    now.pitch += (goal.pitch - now.pitch) * k
    now.zoom += (goal.zoom - now.zoom) * k

    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    // Wider than the photo on a wide screen: show all of it rather than crop the room.
    const fovy = Math.max(VFOV_DEG, (2 * Math.atan(tanX / Math.max(0.1, cw / Math.max(1, ch)))) / RAD)
    const viewProj = multiply(perspective(fovy, cw / Math.max(1, ch), 0.05, 60), lookAt(eyeOf(now), target))
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.uniformMatrix4fv(uViewProj, false, viewProj)
    gl.uniform1f(uShade, clamp((Math.abs(now.yaw) + Math.abs(now.pitch) + Math.abs(1 - now.zoom) * 60) / 6, 0, 1))
    for (const [l, isBehind, tx] of [[behind, 1, filled], [front, 0, photo]] as const) {
      gl.bindTexture(gl.TEXTURE_2D, tx)
      gl.bindVertexArray(l.vao)
      gl.uniform1f(uBehind, isBehind)
      gl.drawElements(gl.TRIANGLES, l.count, gl.UNSIGNED_INT, 0)
    }

    if (listener) {
      listener(
        pins.map(({ id, at }) => {
          const m = viewProj
          const x = m[0] * at[0] + m[4] * at[1] + m[8] * at[2] + m[12]
          const y = m[1] * at[0] + m[5] * at[1] + m[9] * at[2] + m[13]
          const wc = m[3] * at[0] + m[7] * at[1] + m[11] * at[2] + m[15]
          const sx = ((x / wc + 1) / 2) * cw
          const sy = ((1 - y / wc) / 2) * ch
          return { id, x: sx, y: sy, visible: wc > 0 && sx > -20 && sy > -20 && sx < cw + 20 && sy < ch + 20 }
        }),
      )
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  return {
    aim: (v) => {
      Object.assign(goal, v)
      keep(goal)
    },
    jump: (v) => {
      Object.assign(goal, v)
      keep(goal)
      Object.assign(now, goal)
    },
    nudge: (yaw, pitch) => {
      goal.yaw += yaw
      goal.pitch += pitch
      keep(goal)
    },
    zoomBy: (factor) => {
      goal.zoom *= factor
      keep(goal)
    },
    setFront: (value) => {
      gl.useProgram(program)
      gl.uniform1f(uFront, value)
    },
    setAuto: (on) => {
      // Pick the sway up where the camera already is, so it never jumps.
      if (on && !auto) phase = Math.asin(clamp(now.yaw / SWAY.deg, -1, 1))
      auto = on
    },
    onFrame: (fn) => {
      listener = fn
    },
    dispose: () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      listener = null
      buffers.forEach((b) => gl.deleteBuffer(b))
      gl.deleteTexture(photo)
      gl.deleteTexture(filled)
      gl.deleteVertexArray(front.vao)
      gl.deleteVertexArray(behind.vao)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    },
  }
}
