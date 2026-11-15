/** Where the app gets its data. Live: the back end and Supabase login. Samples: local sample rooms. */

const env = import.meta.env

export const API_URL = (env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || ''
export const SUPABASE_URL = (env.VITE_SUPABASE_URL as string | undefined) || ''
export const SUPABASE_KEY = (env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || ''

/** `?replay=1` forces the local samples even when the back end is configured (demo fallback). */
const forceSamples = new URLSearchParams(location.search).has('replay')

/** `?demo=1` opens the app without login, for the stage: rooms stay in the browser, offers are real. */
export const DEMO = new URLSearchParams(location.search).has('demo')

export const LIVE = !!(API_URL && SUPABASE_URL && SUPABASE_KEY) && !forceSamples && !DEMO

/** Real offers from POST /offer whenever a back end is configured, with or without login. */
export const OFFERS = !!API_URL && !forceSamples

/**
 * Where a phone can open this app (the QR code). The page's own address, unless it is only
 * reachable from this computer: then VITE_PUBLIC_URL (for example http://192.168.1.20:5173).
 */
export const PUBLIC_URL = ((env.VITE_PUBLIC_URL as string | undefined) || location.origin).replace(/\/$/, '')
export const PHONE_CAN_REACH = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(PUBLIC_URL)
