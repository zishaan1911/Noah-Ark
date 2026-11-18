import { Navigate, Route, Routes } from 'react-router'
import { RequireRole } from './components/RequireRole'
import { Shell } from './components/Shell'
import { CarePage } from './pages/care/CarePage'
import { CommandPage } from './pages/command/CommandPage'
import { LoginPage } from './pages/LoginPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/command"
        element={
          <RequireRole role="operator">
            <Shell>
              <CommandPage />
            </Shell>
          </RequireRole>
        }
      />
      <Route
        path="/care"
        element={
          <RequireRole role="maintainer">
            <Shell>
              <CarePage />
            </Shell>
          </RequireRole>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
