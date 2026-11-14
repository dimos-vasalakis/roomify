import type { Session as AuthSession } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEMO, LIVE } from '../api/config'
import { supabase } from '../api/supabase'
import { Landing } from '../components/landing/Landing'
import { LoginScreen, type Mode } from './LoginScreen'

/** Sample mode skips login; remember per tab that the landing page was passed. */
const SAMPLE_KEY = 'roomify.entered'
const sampleEntered = () => {
  try {
    return sessionStorage.getItem(SAMPLE_KEY) === '1'
  } catch {
    return false
  }
}

type Auth = { email: string | null; signedIn: boolean; signOut: () => Promise<void> }

const AuthCtx = createContext<Auth>({ email: null, signedIn: !LIVE, signOut: async () => {} })

export const useAuth = () => useContext(AuthCtx)

/** Live mode: show the login screen until there is a Supabase session. Samples: always in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [checked, setChecked] = useState(!LIVE)
  const [login, setLogin] = useState<Mode | null>(null)
  const [entered, setEntered] = useState(() => DEMO || sampleEntered())

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecked(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!LIVE) {
    if (!entered) {
      const enterApp = () => {
        try {
          sessionStorage.setItem(SAMPLE_KEY, '1')
        } catch {
          // private window: the landing page simply shows again next time
        }
        setEntered(true)
      }
      return <Landing onLogIn={enterApp} />
    }
    return <AuthCtx.Provider value={{ email: null, signedIn: true, signOut: async () => {} }}>{children}</AuthCtx.Provider>
  }
  if (!checked) return <div className="min-h-dvh bg-ground" aria-busy="true" />
  if (!session) {
    if (!login) return <Landing onLogIn={() => setLogin('in')} onSignUp={() => setLogin('up')} />
    return <LoginScreen key={login} initialMode={login} onBack={() => setLogin(null)} />
  }

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
