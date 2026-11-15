/**
 * The furnished room as a 3D mesh, in plain WebGL2.
 *
 * Every pixel of the render is pushed back along its own camera ray by the depth map, so from
 * the original camera the mesh looks exactly like the render, and from anywhere else you see
 * the room's real shape. Triangles stretched across a depth jump (the wall behind a sofa) are
 * places the camera never saw: they are left open rather than invented.
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
const VFOV_DEG = 45 // a phone's main camera on a 3:2 crop
const NEAR_M = 1
const FAR_M = 3
const COLS = 320
const LIMIT = { yaw: 28, pitchMin: -8, pitchMax: 20, zoomMin: 0.55, zoomMax: 1.15 }
const SWAY = { deg: 15, speed: 0.35 }
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
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let sum = 0
    for (let k = 0; k < 4; k++) sum += a[i + 4 * k] * b[k + 4 * j]
    out[i + 4 * j] = sum
  }
  return out
}

/** Nearness 0 (far) to 1 (near) at each grid point, as the depth map gives it. */
function readNearness(depth: HTMLImageElement, w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(depth, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const raw = new Float32Array(w * h)
  for (let i = 0; i < raw.length; i++) raw[i] = px[i * 4] / 255
  return raw
}

/** One pass along rows then columns: a box average (8-bit steps become slopes) or a minimum. */
function filter(src: Float32Array, w: number, h: number, r: number, kind: 'mean' | 'min') {
  const pass = (from: Float32Array, step: number, along: number, across: number) => {
    const out = new Float32Array(from.length)
    const stride = step === 1 ? w : 1
    for (let a = 0; a < across; a++)
      for (let i = 0; i < along; i++) {
        let acc = kind === 'min' ? 1 : 0
        let n = 0
        for (let k = Math.max(0, i - r); k <= Math.min(along - 1, i + r); k++) {
          const v = from[a * stride + k * step]
          acc = kind === 'min' ? Math.min(acc, v) : acc + v
          n++
        }
        out[a * stride + i * step] = kind === 'min' ? acc : acc / n
      }
    return out
  }
  return pass(pass(src, 1, w, h), w, h, w)
}

const distanceOf = (near: number) => 1 / (1 / FAR_M + near * (1 / NEAR_M - 1 / FAR_M))

const VERT = `#version 300 es
in vec3 aPos;
in vec2 aUv;
in float aNear;
uniform mat4 uViewProj;
out vec2 vUv;
out vec3 vPos;
out float vNear;
void main() {
  vUv = aUv;
  vPos = aPos;
  vNear = aNear;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vPos;
in float vNear;
uniform sampler2D uColor;
uniform float uFront;
uniform vec3 uAccent;
uniform float uFar;
uniform float uShade;
out vec4 outColor;
void main() {
  // Seen edge-on from the original camera: stretched over a depth jump, never photographed.
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (uFar < 0.5 && abs(dot(n, normalize(vPos))) < 0.07) discard;
  vec3 c = texture(uColor, vUv).rgb;
  // The far layer fills what the camera never saw: shaded grey once the camera has moved, so it
  // never passes for detail. From where the photo was taken it is the photo itself.
  if (uFar > 0.5) c = mix(c, mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 0.3) * 0.42, uShade);
  float built = vNear - uFront;
  if (built < 0.0) c *= 0.3;
  float band = built >= 0.0 ? 1.0 - smoothstep(0.0, 0.07, built) : 0.0;
  vec2 g = abs(fract(vUv * vec2(96.0, 64.0)) - 0.5);
  float line = step(0.42, max(g.x, g.y));
  outColor = vec4(mix(c, uAccent, band * (0.25 + 0.75 * line)), 1.0);
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

export function createRoomView(
  canvas: HTMLCanvasElement,
  color: HTMLImageElement,
  depth: HTMLImageElement,
  anchors: Anchor[],
  colors: { accent: Rgb; ground: Rgb },
): RoomView {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })
  if (!gl) throw new Error("This browser can't show the room in 3D.")

  // The mesh: one vertex per grid point, placed along its camera ray.
  const aspect = color.naturalWidth / color.naturalHeight
  const rows = Math.round(COLS / aspect)
  const w = COLS + 1
  const h = rows + 1
  const raw = readNearness(depth, w, h)
  const near = filter(raw, w, h, 1, 'mean')
  // Behind every piece, the room as if the piece were gone: the farthest surface nearby.
  const far = filter(filter(raw, w, h, 10, 'min'), w, h, 4, 'mean')
  const tanY = Math.tan((VFOV_DEG * RAD) / 2)
  const tanX = tanY * aspect
  const place = (u: number, v: number, n: number, push = 1): Vec3 => {
    const d = distanceOf(n) * push
    return [(u * 2 - 1) * tanX * d, (1 - v * 2) * tanY * d, -d]
  }
  const pos = new Float32Array(w * h * 3)
  const farPos = new Float32Array(w * h * 3)
  const uv = new Float32Array(w * h * 2)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i
    const p = place(i / COLS, j / rows, near[k])
    pos.set(p, k * 3)
    // A little further back, so the two layers never fight where they meet.
    farPos.set(place(i / COLS, j / rows, Math.min(far[k], near[k]), 1.03), k * 3)
    uv.set([i / COLS, j / rows], k * 2)
  }
  const index = new Uint32Array(COLS * rows * 6)
  let o = 0
  for (let j = 0; j < rows; j++) for (let i = 0; i < COLS; i++) {
    const a = j * w + i
    index.set([a, a + w, a + 1, a + 1, a + w, a + w + 1], o)
    o += 6
  }

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
    return { id, at: place(box.x + box.w / 2, box.y + box.h / 2, s[Math.floor(s.length * 0.8)] ?? 0.5) }
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
  const ib = gl.createBuffer()
  const layer = (positions: Float32Array) => {
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
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
    return vao
  }
  const front = layer(pos)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW)
  const behind = layer(farPos)
  gl.bindVertexArray(null)

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, color)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))

  const uViewProj = gl.getUniformLocation(program, 'uViewProj')
  const uFront = gl.getUniformLocation(program, 'uFront')
  const uFar = gl.getUniformLocation(program, 'uFar')
  const uShade = gl.getUniformLocation(program, 'uShade')
  gl.uniform1i(gl.getUniformLocation(program, 'uColor'), 0)
  gl.uniform3fv(gl.getUniformLocation(program, 'uAccent'), colors.accent)
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
    const dist = d0 * v.zoom
    const y = v.yaw * RAD
    const p = v.pitch * RAD
    return [dist * Math.sin(y) * Math.cos(p), dist * Math.sin(p), -d0 + dist * Math.cos(y) * Math.cos(p)]
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
    const viewProj = multiply(perspective(VFOV_DEG, cw / Math.max(1, ch), 0.05, 60), lookAt(eyeOf(now), target))
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.uniformMatrix4fv(uViewProj, false, viewProj)
    gl.uniform1f(uShade, clamp((Math.abs(now.yaw) + Math.abs(now.pitch) + Math.abs(1 - now.zoom) * 60) / 8, 0, 1))
    for (const [vao, isFar] of [[behind, 1], [front, 0]] as const) {
      gl.bindVertexArray(vao)
      gl.uniform1f(uFar, isFar)
      gl.drawElements(gl.TRIANGLES, index.length, gl.UNSIGNED_INT, 0)
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
    setFront: (front) => {
      gl.useProgram(program)
      gl.uniform1f(uFront, front)
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
      gl.deleteBuffer(ib)
      gl.deleteTexture(texture)
      gl.deleteVertexArray(front)
      gl.deleteVertexArray(behind)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    },
  }
}
