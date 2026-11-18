import { Navigate } from 'react-router'
import { useSession } from '../hooks/useSession'
import { ROLE_HOME, type Role } from '../lib/roles'

export function LoginPage() {
  const { roles, signIn } = useSession()
  if (roles.length > 0) return <Navigate to={ROLE_HOME[roles[0]]} replace />
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Noah&apos;s Ark staff sign-in</h1>
        <p className="text-sm text-slate-500">Dev sign-in: pick a role.</p>
        {(Object.keys(ROLE_HOME) as Role[]).map((role) => (
          <button
            key={role}
            onClick={() => signIn([role])}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-white capitalize hover:bg-slate-700"
          >
            {role}
          </button>
        ))}
      </div>
    </main>
  )
}
