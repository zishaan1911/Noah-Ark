// Turns an ArduPilot SITL run from simulation/results/ into Telemetry, placed around the drone's home.
import type { Geo, Telemetry } from '../../../../shared/generated/typescript/contracts'

export type SitlRun = { track_cols: string[]; track: number[][]; world: { shore_n: number } }

const M_PER_DEG_LAT = 111_320

export function toTelemetry(run: SitlRun, droneId: string, home: Geo, start: Date): Telemetry[] {
  const col = Object.fromEntries(run.track_cols.map((name, i) => [name, i]))
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((home.lat * Math.PI) / 180)
  return run.track.map((row) => {
    const [n, e, d] = [row[col.n], row[col.e], row[col.d]]
    const [left, right] = [row[col.infl_L], row[col.infl_R]]
    const volts = row[col.v_bus]
    return {
      droneId,
      ts: new Date(start.getTime() + row[col.t] * 1000).toISOString(),
      position: { lat: home.lat + n / M_PER_DEG_LAT, lon: home.lon + e / mPerDegLon, altM: -d },
      headingDeg: (row[col.yaw] + 360) % 360,
      armed: row[col.thrust_n] > 0,
      flightMode: 'AUTO',
      // shortcut: linear 12S pack estimate (3.3-4.2 V/cell), use the OCV curve from hardware/ if the gauge matters
      batteryPct: Math.round(Math.min(100, Math.max(0, ((volts / 12 - 3.3) / 0.9) * 100)) * 10) / 10,
      batteryVoltageV: volts,
      onWater: n > run.world.shore_n && row[col.skid_h] < 0.3,
      pontoons: left >= 1 && right >= 1 ? 'inflated' : left > 0 || right > 0 ? 'inflating' : 'stowed',
      linkType: 'lte',
    }
  })
}
