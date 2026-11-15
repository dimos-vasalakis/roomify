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

/** A product's 3D model, from its shop photo. */
export const modelOf = (imageUrl: string) => once(models, imageUrl, async () => (await api.model3d(imageUrl)).glb_url)

/** Start everything the 3D room needs as soon as a room is finished, so it opens fast. */
export function prepare3D(s: Session) {
  if (!canView3D(s)) return
  void import('../components/room3d/Room3D').catch(() => {}) // the viewer's code, ahead of the click
  roomDepthOf(s.beforeSrc).catch(() => {})
  for (const p of s.products) if (p.placed !== false && p.thumb?.src) modelOf(p.thumb.src).catch(() => {})
}
