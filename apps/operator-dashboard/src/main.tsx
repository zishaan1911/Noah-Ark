import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { SessionProvider } from './hooks/useSession'
import './index.css'

// Dev without VITE_API_URL runs on the mocks; the import keeps MSW and the SITL track out of production builds.
if (import.meta.env.DEV && !import.meta.env.VITE_API_URL) await (await import('./mocks/browser')).startMocks()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
