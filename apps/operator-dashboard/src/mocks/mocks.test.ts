import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import waterLanding from '../../../../simulation/results/water_landing.json'
import { api, ApiError } from '../lib/api'
import { handlers, resetDb } from './handlers'
import { toTelemetry } from './replay'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => resetDb())
afterAll(() => server.close())

describe('mock API', () => {
  it('lists the seeded SOS requests newest first', async () => {
    const { items } = await api.listSos()
    expect(items.length).toBeGreaterThan(0)
    expect(items.map((s) => s.createdAt)).toEqual(
      items
        .map((s) => s.createdAt)
        .sort()
        .reverse(),
    )
  })

  it('plans a mission for an SOS, approves it once, then refuses a second approve', async () => {
    const [sos] = (await api.listSos()).items
    const { missionId } = await api.requestMission({ mode: 'relief', sosRequestIds: [sos.id] })
    expect(missionId).toMatch(/^msn_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect((await api.getMission(missionId)).status).toBe('pending_approval')
    expect((await api.approveMission(missionId)).status).toBe('dispatched')
    await expect(api.approveMission(missionId)).rejects.toMatchObject({ status: 409, code: 'wrong_status' })
  })

  it('returns a typed 404', async () => {
    const err = await api.getDrone('ARK-999').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, code: 'not_found' })
  })
})

describe('SITL replay', () => {
  const home = { lat: 4.6012, lon: 101.0777 }
  const frames = toTelemetry(waterLanding, 'ARK-001', home, new Date('2026-11-18T00:00:00Z'))

  it('starts at home and ends floating on inflated pontoons over the river', () => {
    expect(frames).toHaveLength(waterLanding.track.length)
    expect(frames[0].position.lat).toBeCloseTo(home.lat, 4)
    const last = frames.at(-1)
    expect(last).toMatchObject({ onWater: true, pontoons: 'inflated' })
    // 100 m north of home is about 0.0009 degrees of latitude.
    expect(last?.position.lat).toBeCloseTo(home.lat + 100 / 111_320, 4)
  })

  it('keeps the battery in range', () => {
    expect(frames.every((f) => f.batteryPct >= 0 && f.batteryPct <= 100)).toBe(true)
  })
})
