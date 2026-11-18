import { createContext, useContext, useState, type ReactNode } from 'react'
import { rolesFromGroups, type Role } from '../lib/roles'

// shortcut: dev sign-in keeps the chosen Cognito groups in sessionStorage, swap for the Cognito user pool once infra/ has one
const KEY = 'ark.devGroups'

type Session = { roles: Role[]; signIn: (groups: string[]) => void; signOut: () => void }

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<string[]>(() => JSON.parse(sessionStorage.getItem(KEY) ?? '[]'))
  const save = (next: string[]) => {
    sessionStorage.setItem(KEY, JSON.stringify(next))
    setGroups(next)
  }
  return (
    <SessionContext value={{ roles: rolesFromGroups(groups), signIn: save, signOut: () => save([]) }}>
      {children}
    </SessionContext>
  )
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession needs a SessionProvider')
  return session
}
