import { useEffect, useRef } from 'react'
import type { LiveUpdate } from '../../../../shared/generated/typescript/contracts'
import { LIVE_URL } from '../lib/api'

// shortcut: no reconnect and no `token` query parameter yet, add both with Cognito sign-in
export function useLiveUpdates(onUpdate: (update: LiveUpdate) => void) {
  const handler = useRef(onUpdate)
  useEffect(() => {
    handler.current = onUpdate
  })
  useEffect(() => {
    const socket = new WebSocket(LIVE_URL)
    socket.onmessage = (e) => handler.current(JSON.parse(e.data) as LiveUpdate)
    return () => socket.close()
  }, [])
}
