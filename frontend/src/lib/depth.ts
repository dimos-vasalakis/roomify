import { api } from '../api/client'
import { API_URL } from '../api/config'
import type { Session } from '../types'

/** The 3D room needs the back end (depth and models), the room's own photo and placed pieces. */
export const canView3D = (s: Session): boolean =>
  !!API_URL && !!s.beforeSrc && s.status === 'done' && s.products.some((p) => p.placed !== false && !!p.thumb?.src)

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

const rooms = new Map<string, Promise<string>>()
const models = new Map<string, Promise<string>>()

/** The depth map of the empty room photo. */
export const roomDepthOf = (photoSrc: string) =>
  once(rooms, photoSrc, async () => {
    const photo = await (await fetch(photoSrc)).blob()
    return (await api.photoDepth(photo)).depth_url
  })

type Shell = { photo: string; depth: string }
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
    signal: AbortSignal.timeout(150_000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : "Couldn't prepare the room for 3D.")
  return { photo: body.image_url, depth: body.depth_url }
}

/**
 * The room the 3D models stand in: the finished render with the chosen pieces taken out, so a piece
 * the design replaced or removed is not left behind in 3D. Without a render, the person's own photo.
 */
export function roomShellOf(s: Session): Promise<Shell> {
  const pieces = shellPieces(s)
  const render = s.afterSrc
  const fromPhoto = () => roomDepthOf(s.beforeSrc).then((depth) => ({ photo: s.beforeSrc, depth }))
  if (!ours(render) || !pieces.length) return fromPhoto()
  // If the shell can't be made, the person's own photo still gives a room to look round.
  return once(shells, JSON.stringify([render, pieces]), () => askShell(render, pieces)).catch(fromPhoto)
}

/** A product's 3D model, from its shop photo. */
export const modelOf = (imageUrl: string) => once(models, imageUrl, async () => (await api.model3d(imageUrl)).glb_url)

/** Start everything the 3D room needs as soon as a room is finished, so it opens fast. */
export function prepare3D(s: Session) {
  if (!canView3D(s)) return
  void import('../components/room3d/Room3D').catch(() => {}) // the viewer's code, ahead of the click
  roomShellOf(s).catch(() => {})
  for (const p of s.products) if (p.placed !== false && p.thumb?.src) modelOf(p.thumb.src).catch(() => {})
}
