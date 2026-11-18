// In-memory stand-in for the Ark Brain API and WebSocket feed, seeded from shared/examples/.
// shortcut: request bodies are not schema-validated here, the real API does that; add ajv if the mock hides bugs
import { http, HttpResponse, ws } from 'msw'
import type {
  Drone,
  DroneEvent,
  Geo,
  LiveUpdate,
  Mission,
  MissionRequest,
  SosReport,
  SosRequest,
} from '../../../../shared/generated/typescript/contracts'
import droneSeed from '../../../../shared/examples/drone/valid-available.json'
import eventSeed from '../../../../shared/examples/drone-event/valid-ack.json'
import missionSeed from '../../../../shared/examples/mission/valid-relief.json'
import sosNew from '../../../../shared/examples/sos-request/valid-new.json'
import sosTriaged from '../../../../shared/examples/sos-request/valid-triaged.json'
import waterLanding from '../../../../simulation/results/water_landing.json'
import { API_URL, LIVE_URL } from '../lib/api'
import { toTelemetry } from './replay'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const newId = (prefix: string) =>
  `${prefix}_${Array.from({ length: 26 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join('')}`

export function seed() {
  return {
    sos: [sosTriaged, sosNew] as SosRequest[],
    missions: [missionSeed] as Mission[],
    drones: [droneSeed] as Drone[],
    events: [eventSeed] as DroneEvent[],
  }
}
let db = seed()
export const resetDb = () => {
  db = seed()
}

const live = ws.link(LIVE_URL)
const push = (update: LiveUpdate) => live.broadcast(JSON.stringify(update))

const error = (status: number, code: string, message?: string) =>
  HttpResponse.json({ error: code, message }, { status })
const notFound = () => error(404, 'not_found')
const newestFirst = <T extends { createdAt?: string; ts?: string }>(items: T[]) =>
  [...items].sort((a, b) => (b.createdAt ?? b.ts ?? '').localeCompare(a.createdAt ?? a.ts ?? ''))

function km(a: Geo, b: Geo) {
  const rad = Math.PI / 180
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// Stands in for mission-planner (Bedrock): closest available drone, straight line, 12 m/s cruise.
function plan(req: MissionRequest): Mission | undefined {
  const destination = req.destination ?? db.sos.find((s) => s.id === req.sosRequestIds?.[0])?.report.location
  const drone = db.drones.find((d) => d.status === 'available')
  if (!destination || !drone) return undefined
  const payload = req.payload ?? []
  const distanceKm = Math.round(km(drone.home, destination) * 10) / 10
  return {
    id: newId('msn'),
    mode: req.mode,
    droneId: drone.id,
    createdAt: new Date().toISOString(),
    status: 'pending_approval',
    sosRequestIds: req.sosRequestIds,
    origin: drone.home,
    destination,
    landingType: req.landingType ?? 'ground',
    payload,
    payloadKg: Math.round(payload.reduce((sum, p) => sum + p.weightKg * p.qty, 0) * 100) / 100,
    distanceKm,
    etaMinutes: Math.round((distanceKm / 0.72) * 10) / 10,
    aiRationale: `Mock planner: ${drone.id} is the closest available drone, ${distanceKm} km away.`,
  } as Mission
}

function updateMission(mission: Mission, status: Mission['status']) {
  mission.status = status
  push({ kind: 'mission', data: mission })
  return mission
}

export const handlers = [
  http.post(`${API_URL}/sos`, async ({ request }) => {
    const sos = { id: newId('sos'), createdAt: new Date().toISOString(), status: 'new', report: await request.json() }
    db.sos.push(sos as SosRequest & { report: SosReport })
    push({ kind: 'sos', data: sos as SosRequest })
    return HttpResponse.json(sos, { status: 201 })
  }),
  http.get(`${API_URL}/sos`, ({ request }) => {
    const status = new URL(request.url).searchParams.get('status')
    return HttpResponse.json({ items: newestFirst(db.sos.filter((s) => !status || s.status === status)) })
  }),
  http.get(`${API_URL}/sos/:sosId`, ({ params }) => {
    const sos = db.sos.find((s) => s.id === params.sosId)
    return sos ? HttpResponse.json(sos) : notFound()
  }),

  http.post(`${API_URL}/missions`, async ({ request }) => {
    const mission = plan((await request.json()) as MissionRequest)
    if (!mission) return error(400, 'invalid_body', 'Need a destination or an SOS id, and an available drone.')
    db.missions.push(mission)
    push({ kind: 'mission', data: mission })
    return HttpResponse.json({ missionId: mission.id }, { status: 202 })
  }),
  http.get(`${API_URL}/missions`, ({ request }) => {
    const q = new URL(request.url).searchParams
    const items = db.missions.filter(
      (m) => (!q.get('status') || m.status === q.get('status')) && (!q.get('mode') || m.mode === q.get('mode')),
    )
    return HttpResponse.json({ items: newestFirst(items) })
  }),
  http.get(`${API_URL}/missions/:missionId`, ({ params }) => {
    const mission = db.missions.find((m) => m.id === params.missionId)
    return mission ? HttpResponse.json(mission) : notFound()
  }),
  http.post(`${API_URL}/missions/:missionId/approve`, ({ params }) => {
    const mission = db.missions.find((m) => m.id === params.missionId)
    if (!mission) return notFound()
    if (mission.status !== 'pending_approval') return error(409, 'wrong_status', `Mission is ${mission.status}.`)
    return HttpResponse.json(updateMission(mission, 'dispatched'))
  }),
  http.post(`${API_URL}/missions/:missionId/abort`, ({ params }) => {
    const mission = db.missions.find((m) => m.id === params.missionId)
    if (!mission) return notFound()
    if (['pending_approval', 'approved'].includes(mission.status))
      return HttpResponse.json(updateMission(mission, 'cancelled'), { status: 202 })
    if (['dispatched', 'in_flight'].includes(mission.status)) return HttpResponse.json(mission, { status: 202 })
    return error(409, 'wrong_status', `Mission is ${mission.status}.`)
  }),

  http.get(`${API_URL}/drones`, () => HttpResponse.json({ items: db.drones })),
  http.get(`${API_URL}/drones/:droneId`, ({ params }) => {
    const drone = db.drones.find((d) => d.id === params.droneId)
    return drone ? HttpResponse.json(drone) : notFound()
  }),
  http.get(`${API_URL}/drones/:droneId/telemetry`, ({ params }) => {
    const drone = db.drones.find((d) => d.id === params.droneId)
    if (!drone) return notFound()
    const start = new Date(Date.now() - waterLanding.sim_s * 1000)
    return HttpResponse.json({ items: toTelemetry(waterLanding, drone.id, drone.home, start) })
  }),
  http.get(`${API_URL}/drones/:droneId/events`, ({ params }) => {
    if (!db.drones.some((d) => d.id === params.droneId)) return notFound()
    return HttpResponse.json({ items: newestFirst(db.events.filter((e) => e.droneId === params.droneId)) })
  }),

  // Each new dashboard connection gets ARK-001 flying the SITL water landing, on a loop, at its real 10 Hz.
  live.addEventListener('connection', ({ client }) => {
    const drone = db.drones[0]
    let frames = toTelemetry(waterLanding, drone.id, drone.home, new Date())
    let i = 0
    const timer = setInterval(() => {
      if (i === frames.length) [frames, i] = [toTelemetry(waterLanding, drone.id, drone.home, new Date()), 0]
      client.send(JSON.stringify({ kind: 'telemetry', data: frames[i++] } satisfies LiveUpdate))
    }, 100)
    client.addEventListener('close', () => clearInterval(timer))
  }),
]
