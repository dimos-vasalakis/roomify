import { useState } from 'react'
import { supabase } from '../api/supabase'
import { Mark } from '../components/shell/Mark'

type Mode = 'in' | 'up'

/** Email and password, so a demo account can be typed in on stage. */
export function LoginScreen() {
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || busy) return
    setBusy(true)
    setError(null)
    setNote(null)
    const { data, error: err } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password })
    setBusy(false)
    if (err) return setError(err.message === 'Invalid login credentials' ? 'That email and password do not match an account.' : err.message)
    if (mode === 'up' && !data.session) setNote('Check your inbox to confirm the email, then log in.')
  }

  const field =
    'h-11 w-full rounded-control border border-control bg-surface px-3 text-body placeholder:text-muted focus:border-ink focus:outline-none'

  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-4">
      <div className="w-full max-w-sm">
        <Mark />
        <h1 className="mt-8 text-title font-semibold tracking-[-0.01em]">{mode === 'in' ? 'Log in to your rooms' : 'Create an account'}</h1>
        <p className="mt-1 text-chrome text-muted">Your rooms, baskets and walk-ins are saved to your account.</p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-chrome font-medium">
              Email
            </label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-chrome font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </div>
          {error && (
            <p role="alert" className="flex items-center gap-2 text-chrome text-ink">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-negative" />
              {error}
            </p>
          )}
          {note && <p className="text-chrome text-ink">{note}</p>}
          <button type="submit" disabled={busy} className="press h-11 rounded-control bg-primary text-body font-medium text-surface disabled:bg-secondary disabled:text-muted">
            {busy ? 'One moment…' : mode === 'in' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-chrome text-muted">
          {mode === 'in' ? 'New here?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'in' ? 'up' : 'in')
              setError(null)
              setNote(null)
            }}
            className="font-medium text-ink underline underline-offset-2"
          >
            {mode === 'in' ? 'Create an account' : 'Log in'}
          </button>
        </p>
      </div>
    </main>
  )
}
