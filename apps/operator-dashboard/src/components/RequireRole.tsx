import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useSession } from '../hooks/useSession'
import { ROLE_HOME, type Role } from '../lib/roles'

// Hides views only. The API enforces roles with the Cognito authorizer.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { roles } = useSession()
  if (roles.length === 0) return <Navigate to="/login" replace />
  if (!roles.includes(role)) return <Navigate to={ROLE_HOME[roles[0]]} replace />
  return children
}
