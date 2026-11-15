import { api } from '../api/client'
import { API_URL } from '../api/config'

const FAL = /^https:\/\/([a-z0-9-]+\.)*fal\.media\//i

/** Only our own renders have a depth map: the back end refuses any other link. */
export const canView3D = (src: string | null | undefined): src is string => !!API_URL && !!src && FAL.test(src)

const maps = new Map<string, Promise<string>>()

/** The render's depth map link, asked for once per render. A failure is forgotten so it can be tried again. */
export function depthOf(src: string): Promise<string> {
  let map = maps.get(src)
  if (!map) {
    map = api.depth(src).then((d) => d.depth_url)
    map.catch(() => maps.delete(src))
    maps.set(src, map)
  }
  return map
}
