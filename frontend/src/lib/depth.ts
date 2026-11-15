import { api } from '../api/client'
import { API_URL, OFFERS } from '../api/config'
import type { Model3DOut } from '../api/wire'
import type { Product, Session } from '../types'
import type { Geometry } from './roomShell'

/** The 3D room needs the back end (depth and models), the room's own photo and placed pieces. */
export const canView3D = (s: Session): boolean =>
  !!(s.recorded3d || OFFERS) && !!s.beforeSrc && s.status === 'done' && s.products.some((p) => p.placed !== false && !!p.thumb?.src)

/** Asked for once per page; a failure is forgotten so it can be tried again. */
function once<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let made = cache.get(key)
  if (!made) {
    made = make()
    made.catch(() => cache.delete(key))
    cache.set(key, made)
  }
  return made
}

const rooms = new Map<string, Promise<Shell>>()
const models = new Map<string, Promise<Model3DOut>>()

/** The person's own room photo, its depth map and its measurements. */
const roomDepthOf = (photoSrc: string) =>
  once(rooms, photoSrc, async (): Promise<Shell> => {
    const photo = await (await fetch(photoSrc)).blob()
    const out = await api.photoDepth(photo)
    return { photo: photoSrc, depth: out.depth_url, geometry: out.geometry ?? null, objects: out.objects ?? [] }
  })

/** Something already standing in the room, cut out of the picture to be modelled. */
export type RoomObject = { name: string; box: Product['box']; on_top: boolean; crop_url: string }
type Shell = { photo: string; depth: string; geometry: Geometry | null; objects: RoomObject[] }
type Recording = { capturedAt: string; shell: Shell; models: Record<string, Model3DOut> }
const recordings = new Map<string, Promise<Recording>>()
const recordingOf = (url: string) => once(recordings, url, async () => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error("Couldn't load the recorded room. Refresh to try again.")
  return response.json() as Promise<Recording>
})

async function recordedModel(s: Session, photo: string): Promise<Model3DOut> {
  const recording = await recordingOf(s.recorded3d!)
  const model = recording.models[photo]
  if (!model) throw new Error('This piece has no recorded 3D model.')
  return model
}
const shells = new Map<string, Promise<Shell>>()

/** A room picture Roomify made (fal storage): the only kind the back end makes a shell from. */
const ours = (src: string | null | undefined): src is string => !!src && /^https:\/\/([\w-]+\.)*fal\.media\//.test(src)

/** What the shell takes out of the render: each placed piece, by name and where it stands. */
const shellPieces = (s: Session) =>
  s.products.filter((p) => p.placed !== false).map((p) => ({ name: `${p.slot.toLowerCase()}: ${p.title}`.slice(0, 200), box: p.box }))

async function askShell(render: string, pieces: ReturnType<typeof shellPieces>): Promise<Shell> {
  const response = await fetch(`${API_URL}/depth/shell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ render_url: render, pieces }),
    signal: AbortSignal.timeout(270_000), // image edit (120), depth (45), optional enrichment (75)
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : "Couldn't prepare the room for 3D.")
  return { photo: body.image_url, depth: body.depth_url, geometry: body.geometry ?? null, objects: body.objects ?? [] }
}

/**
 * The room the 3D models stand in: the finished render with the chosen pieces taken out, so a piece
 * the design replaced or removed is not left behind in 3D. Without a render, the person's own photo.
 */
export function roomShellOf(s: Session): Promise<Shell> {
  if (s.recorded3d) return recordingOf(s.recorded3d).then((r) => r.shell)
  const pieces = shellPieces(s)
  const render = s.afterSrc
  const fromPhoto = () => roomDepthOf(s.beforeSrc)
  if (!ours(render) || !pieces.length) return fromPhoto()
  // If the shell can't be made, the person's own photo still gives a room to look round.
  return once(shells, JSON.stringify([render, pieces]), () => askShell(render, pieces)).catch(fromPhoto)
}

/** A 3D model of something already in the room, from its cut-out of the picture. */
export const objectModelOf = (o: RoomObject, s: Session) => s.recorded3d ? recordedModel(s, o.crop_url) : once(models, o.crop_url, () => api.model3d(o.crop_url, '', o.name))

/** A product's 3D model, from the shop's photos of it (its page's gallery). */
export const modelOf = (p: Product, s: Session) => s.recorded3d ? recordedModel(s, p.thumb!.src) : once(models, p.thumb!.src, () => api.model3d(p.thumb!.src, p.url, p.title))

/** Start everything the 3D room needs as soon as a room is finished, so it opens fast. */
export function prepare3D(s: Session) {
  if (!canView3D(s)) return
  void import('../components/room3d/Room3D').catch(() => {}) // the viewer's code, ahead of the click
  roomShellOf(s)
    .then((shell) => shell.objects.forEach((o) => objectModelOf(o, s).catch(() => {})))
    .catch(() => {})
  for (const p of s.products) if (p.placed !== false && p.thumb?.src) modelOf(p, s).catch(() => {})
}
