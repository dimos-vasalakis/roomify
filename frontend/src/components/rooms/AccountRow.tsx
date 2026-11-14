import { LogOut } from 'lucide-react'
import { LIVE } from '../../api/config'
import { useAuth } from '../../auth/AuthGate'

/** Who is logged in, and the way out. Live mode only. */
export function AccountRow() {
  const { email, signOut } = useAuth()
  if (!LIVE || !email) return null
  return (
    <div className="flex shrink-0 items-center gap-2.5 px-2 py-3">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-small font-semibold text-ink uppercase">
        {email[0]}
      </span>
      <span className="min-w-0 flex-1 truncate text-small text-ink">{email}</span>
      <button
        type="button"
        onClick={() => void signOut()}
        aria-label="Log out"
        title="Log out"
        className="press grid size-8 place-items-center rounded-control text-muted hover:bg-active hover:text-ink"
      >
        <LogOut size={15} strokeWidth={1.75} />
      </button>
    </div>
  )
}
