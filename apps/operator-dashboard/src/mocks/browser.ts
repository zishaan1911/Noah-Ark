import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const startMocks = () => setupWorker(...handlers).start({ onUnhandledFrame: 'bypass' })
