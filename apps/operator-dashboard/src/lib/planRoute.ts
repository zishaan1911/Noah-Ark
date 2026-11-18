import type { Geo } from '@contracts';
import { ARK1 } from './ark1';
import { bearingDeg, destinationPoint, haversineKm } from './geo';
import type { Point } from './types';

// shortcut: straight-line route planning in the browser, no no-fly zones or obstacles; it moves to the
// mission-planner Lambda with Amazon Location Service.

const SAMPLE_STEP_M = 100;
const CORRIDOR_M = 80;
const LEG_M = 1000;
const LOOKAHEAD_M = 300;
const MIN_ALT_M = 30;
const CLIMB_LAND_MIN = 1;

export type ElevationSampler = (lat: number, lon: number) => Promise<number>;

export interface PlanInput {
  start: Point;
  dest: Point;
  payloadKg: number;
  elevationAt: ElevationSampler;
}

export interface ProfilePoint {
  dKm: number;
  groundAmslM: number;
  flightAmslM: number;
}

export interface Plan {
  /** One per leg, at the leg's end. `altM` is relative to the start ground. */
  waypoints: Geo[];
  distanceKm: number;
  etaMinutes: number;
  maxGroundAmslM: number;
  startGroundAmslM: number;
  /** Highest waypoint above the start ground. */
  climbM: number;
  profile: ProfilePoint[];
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; reason: string };

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

export async function planRoute({ start, dest, payloadKg, elevationAt }: PlanInput): Promise<PlanResult> {
  if (!(payloadKg > 0)) return { ok: false, reason: 'Add a payload before planning.' };
  if (payloadKg > ARK1.maxPayloadKg) {
    const reason = `Payload ${payloadKg.toFixed(2)} kg is over the ${ARK1.maxPayloadKg} kg limit.`;
    return { ok: false, reason };
  }
  const distKm = haversineKm(start, dest);
  if (distKm > ARK1.rangeOutKm) {
    return {
      ok: false,
      reason: `Destination is ${distKm.toFixed(1)} km away. Ark-1 flies ${ARK1.rangeOutKm} km out and back.`,
    };
  }
  const distM = distKm * 1000;
  const bearing = bearingDeg(start, dest);

  // Ground samples every 100 m (and at the destination), centre line plus a corridor either side.
  const ds: number[] = [];
  for (let d = 0; d < distM; d += SAMPLE_STEP_M) ds.push(d);
  ds.push(distM);

  const rows = await Promise.all(
    ds.map(async (d) => {
      const c = d === distM ? dest : destinationPoint(start, bearing, d);
      const [centre, left, right] = await Promise.all([
        elevationAt(c.lat, c.lon),
        ...[bearing - 90, bearing + 90].map((b) => {
          const p = destinationPoint(c, b, CORRIDOR_M);
          return elevationAt(p.lat, p.lon);
        }),
      ]);
      return { d, centre, corridor: Math.max(centre, left, right) };
    }),
  );

  const startGround = rows[0]?.centre ?? 0;
  const maxGround = Math.max(...rows.map((r) => r.corridor));

  // Legs of at most 1 km; a waypoint's altitude clears the highest ground in its leg and the next 300 m.
  const legCount = Math.max(1, Math.ceil(distM / LEG_M));
  const waypoints: Geo[] = [];
  const knots: { d: number; amsl: number }[] = [{ d: 0, amsl: startGround }];
  for (let k = 1; k <= legCount; k++) {
    const from = (k - 1) * LEG_M;
    const end = Math.min(k * LEG_M, distM);
    const inReach = rows.filter((r) => r.d >= from && r.d <= end + LOOKAHEAD_M);
    const highest = Math.max(...inReach.map((r) => r.corridor));
    const altM = Math.max(MIN_ALT_M, round(highest + ARK1.clearanceM - startGround, 1));
    const p = k === legCount ? dest : destinationPoint(start, bearing, end);
    waypoints.push({ lat: round(p.lat, 6), lon: round(p.lon, 6), altM });
    knots.push({ d: end, amsl: startGround + altM });
  }

  const flightAt = (d: number) => {
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1];
      const b = knots[i];
      if (!a || !b || d > b.d) continue;
      return b.d === a.d ? b.amsl : a.amsl + ((b.amsl - a.amsl) * (d - a.d)) / (b.d - a.d);
    }
    return knots[knots.length - 1]?.amsl ?? startGround;
  };

  return {
    ok: true,
    plan: {
      waypoints,
      distanceKm: round(distKm, 2),
      etaMinutes: round(distM / ARK1.cruiseMs / 60 + CLIMB_LAND_MIN, 1),
      maxGroundAmslM: round(maxGround, 1),
      startGroundAmslM: round(startGround, 1),
      climbM: Math.max(...waypoints.map((w) => w.altM ?? 0)),
      profile: rows.map((r) => ({
        dKm: r.d / 1000,
        groundAmslM: r.centre,
        flightAmslM: flightAt(r.d),
      })),
    },
  };
}
