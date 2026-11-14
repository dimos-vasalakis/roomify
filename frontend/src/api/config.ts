/** Where the app gets its data. Live: the back end and Supabase login. Samples: local sample rooms. */

const env = import.meta.env

export const API_URL = (env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || ''
export const SUPABASE_URL = (env.VITE_SUPABASE_URL as string | undefined) || ''
export const SUPABASE_KEY = (env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || ''

/** `?replay=1` forces the local samples even when the back end is configured (demo fallback). */
const forceSamples = new URLSearchParams(location.search).has('replay')

export const LIVE = !!(API_URL && SUPABASE_URL && SUPABASE_KEY) && !forceSamples
