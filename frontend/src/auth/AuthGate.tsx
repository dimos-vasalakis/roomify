import type { Session as AuthSession } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { LIVE } from '../api/config'
import { supabase } from '../api/supabase'
import { LoginScreen } from './LoginScreen'

type Auth = { email: string | null; signedIn: boolean; signOut: () => Promise<void> }

const AuthCtx = createContext<Auth>({ email: null, signedIn: !LIVE, signOut: async () => {} })

export const useAuth = () => useContext(AuthCtx)

/** Live mode: show the login screen until there is a Supabase session. Samples: always in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [checked, setChecked] = useState(!LIVE)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecked(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!LIVE) return <AuthCtx.Provider value={{ email: null, signedIn: true, signOut: async () => {} }}>{children}</AuthCtx.Provider>
  if (!checked) return <div className="min-h-dvh bg-ground" aria-busy="true" />
  if (!session) return <LoginScreen />

  return (
    <AuthCtx.Provider
      value={{
        email: session.user.email ?? null,
        signedIn: true,
        signOut: async () => {
          await supabase?.auth.signOut()
        },
      }}
    >
      {children}
    </AuthCtx.Provider>
  )
}
