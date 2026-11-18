import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { useSession } from '../hooks/useSession'
import { ROLE_HOME } from '../lib/roles'

const TITLE = { operator: 'Ark Command', maintainer: 'Ark Care' } as const

export function Shell({ children }: { children: ReactNode }) {
  const { roles, signOut } = useSession()
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
        <span className="font-semibold">Noah&apos;s Ark</span>
        <nav className="flex gap-3 text-sm">
          {roles.map((role) => (
            <NavLink
              key={role}
              to={ROLE_HOME[role]}
              className={({ isActive }) => (isActive ? 'font-medium' : 'text-slate-500')}
            >
              {TITLE[role]}
            </NavLink>
          ))}
        </nav>
        <button onClick={signOut} className="ml-auto text-sm text-slate-500 hover:text-slate-900">
          Sign out
        </button>
      </header>
      <main className="p-4">{children}</main>
    </div>
  )
}
