import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The dev mocks read contract examples and SITL runs from the repo.
  server: { fs: { allow: ['.', '../../shared', '../../simulation/results'] } },
  test: { environment: 'jsdom' },
})
