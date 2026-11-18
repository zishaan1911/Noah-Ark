import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { SessionProvider } from './hooks/useSession'
import { rolesFromGroups } from './lib/roles'

function renderAt(path: string, groups: string[]) {
  sessionStorage.setItem('ark.devGroups', JSON.stringify(groups))
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe('rolesFromGroups', () => {
  it('keeps only known groups, operator first', () => {
    expect(rolesFromGroups(['maintainer', 'admins', 'operator'])).toEqual(['operator', 'maintainer'])
    expect(rolesFromGroups([])).toEqual([])
  })
})

describe('role routing', () => {
  it('sends a signed-out user to sign-in', () => {
    renderAt('/command', [])
    expect(screen.getByText(/staff sign-in/)).toBeTruthy()
  })

  it('shows operators Ark Command', () => {
    renderAt('/command', ['operator'])
    expect(screen.getByRole('heading', { name: 'Ark Command' })).toBeTruthy()
  })

  it('sends a maintainer away from Ark Command to Ark Care', () => {
    renderAt('/command', ['maintainer'])
    expect(screen.getByRole('heading', { name: 'Ark Care' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Ark Command' })).toBeNull()
  })
})
