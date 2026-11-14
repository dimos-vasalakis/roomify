import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { LIVE, SUPABASE_KEY, SUPABASE_URL } from './config'

/** Login only. All data goes through the back end, never straight to Supabase. */
export const supabase: SupabaseClient | null = LIVE
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
