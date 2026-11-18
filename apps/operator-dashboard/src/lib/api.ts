// Typed client for shared/api/openapi.yaml. Without VITE_API_URL, dev runs against the mocks in src/mocks/.
import type {
  Drone,
  DroneEvent,
  Mission,
  MissionMode,
  MissionRequest,
  MissionStatus,
  SosReport,
  SosRequest,
  SosStatus,
  Telemetry,
} from '../../../../shared/generated/typescript/contracts'

export const API_URL: string = import.meta.env.VITE_API_URL ?? `${location.origin}/api`
export const LIVE_URL: string = import.meta.env.VITE_WS_URL ?? `${location.origin.replace(/^http/, 'ws')}/live`

export type Page<T> = { items: T[]; nextToken?: string }
type Query = Record<string, string | number | undefined>

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.status = status
    this.code = code
  }
}

// shortcut: no Authorization header yet, add the Cognito JWT when sign-in stops being a stub
async function call<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
  const url = new URL(API_URL + path)
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
  const res = await fetch(url, {
    method,
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'http_error', data.message)
  return data as T
}

const id = encodeURIComponent

export const api = {
  createSos: (report: SosReport) => call<SosRequest>('POST', '/sos', { body: report }),
  listSos: (q: { status?: SosStatus; limit?: number; nextToken?: string } = {}) =>
    call<Page<SosRequest>>('GET', '/sos', { query: q }),
  getSos: (sosId: string) => call<SosRequest>('GET', `/sos/${id(sosId)}`),

  requestMission: (req: MissionRequest) => call<{ missionId: string }>('POST', '/missions', { body: req }),
  listMissions: (q: { status?: MissionStatus; mode?: MissionMode; limit?: number; nextToken?: string } = {}) =>
    call<Page<Mission>>('GET', '/missions', { query: q }),
  getMission: (missionId: string) => call<Mission>('GET', `/missions/${id(missionId)}`),
  approveMission: (missionId: string) => call<Mission>('POST', `/missions/${id(missionId)}/approve`),
  abortMission: (missionId: string, reason?: string) =>
    call<Mission>('POST', `/missions/${id(missionId)}/abort`, { body: reason === undefined ? {} : { reason } }),

  listDrones: () => call<Page<Drone>>('GET', '/drones'),
  getDrone: (droneId: string) => call<Drone>('GET', `/drones/${id(droneId)}`),
  getTelemetry: (droneId: string, q: { from?: string; to?: string } = {}) =>
    call<Page<Telemetry>>('GET', `/drones/${id(droneId)}/telemetry`, { query: q }),
  listDroneEvents: (droneId: string, q: { missionId?: string; limit?: number; nextToken?: string } = {}) =>
    call<Page<DroneEvent>>('GET', `/drones/${id(droneId)}/events`, { query: q }),
}
