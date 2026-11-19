import type { Geo } from '@contracts';
import { ARK1 } from './ark1';
import { haversineKm } from './geo';
import { planRoute, type ElevationSampler, type Plan, type ProfilePoint } from './planRoute';
import type { PayloadRow, Point } from './types';

// shortcut: the sector, outposts, threat zones and requests are exercise data in the app; they move to the
// mission-planner Lambda (and a geofence store) when defence mode is wired to the cloud.

export interface Outpost extends Point {
  id: string;
  name: string;
  kind: 'base' | 'fob' | 'op' | 'lz';
}

export interface ThreatZone extends Point {
  id: string;
  name: string;
  radiusKm: number;
}

export type Priority = 'flash' | 'immediate' | 'priority';

export interface ResupplyRequest {
  id: string;
  to: string; // outpost id
  priority: Priority;
  payload: PayloadRow[];
  /** Planned path from the main base: middle points bend the route around threat zones. */
  path: Point[];
}

/** The exercise sector: Darvel Bay, around Lahad Datu, eastern Sabah. The outposts are fictional. */
export const SECTOR = { center: { lat: 5.092, lon: 118.365 }, zoom: 11.2 };
/** Routes keep at least this far outside a threat zone's edge. */
export const ZONE_MARGIN_KM = 1;

export const OUTPOSTS: Outpost[] = [
  { id: 'base', name: 'MAIN BASE', kind: 'base', lat: 5.03, lon: 118.33 },
  { id: 'kestrel', name: 'FOB KESTREL', kind: 'fob', lat: 5.12, lon: 118.4 },
  { id: 'hill', name: 'OP HILL-412', kind: 'op', lat: 5.15, lon: 118.335 },
  { id: 'lahad', name: 'LZ LAHAD', kind: 'lz', lat: 5.06, lon: 118.25 },
  { id: 'segama', name: 'OP SEGAMA', kind: 'op', lat: 5.105, lon: 118.475 },
];

export const ZONES: ThreatZone[] = [
  { id: 'tz-alpha', name: 'TZ-ALPHA', lat: 5.09, lon: 118.36, radiusKm: 3.5 },
  { id: 'tz-bravo', name: 'TZ-BRAVO', lat: 5.1, lon: 118.47, radiusKm: 3 },
];

const BASE = OUTPOSTS[0];

// Blood O-neg: about 0.48 kg a unit with its cold pack. The live flight is the Ark-1 SITL airframe, so every
// request stays under Ark-1's 2 kg (Ark-1M carries 4 kg).
export const REQUESTS: ResupplyRequest[] = [
  {
    id: 'REQ-0412',
    to: 'kestrel',
    priority: 'flash',
    payload: [{ id: 1, item: 'Blood O-neg, cold pack', qty: 4, kgEach: 0.48 }],
    path: [BASE, { lat: 5.05, lon: 118.39 }, { lat: 5.09, lon: 118.405 }, { lat: 5.12, lon: 118.4 }],
  },
  {
    id: 'REQ-0413',
    to: 'hill',
    priority: 'immediate',
    payload: [
      { id: 1, item: 'Radio battery, Li-ion', qty: 1, kgEach: 1.1 },
      { id: 2, item: 'Field medical kit', qty: 1, kgEach: 0.8 },
    ],
    path: [BASE, { lat: 5.092, lon: 118.312 }, { lat: 5.15, lon: 118.335 }],
  },
  {
    id: 'REQ-0414',
    to: 'lahad',
    priority: 'priority',
    payload: [{ id: 1, item: 'Water, 1.5 L', qty: 1, kgEach: 1.5 }],
    path: [BASE, { lat: 5.06, lon: 118.25 }],
  },
  {
    id: 'REQ-0415',
    to: 'segama',
    priority: 'priority',
    payload: [{ id: 1, item: 'Medical kit', qty: 1, kgEach: 1.2 }],
    path: [], // the drop is inside TZ-BRAVO: held, no route
  },
];

export const outpost = (id: string) => OUTPOSTS.find((o) => o.id === id);

const KM_PER_DEG_LAT = 110.57;

/** Shortest distance in km from `c` to the segment a-b (flat earth around `c`; fine at sector scale). */
export function segmentKm(a: Point, b: Point, c: Point): number {
  const k = Math.cos((c.lat * Math.PI) / 180) * 111.32;
  const ax = (a.lon - c.lon) * k;
  const ay = (a.lat - c.lat) * KM_PER_DEG_LAT;
  const dx = (b.lon - c.lon) * k - ax;
  const dy = (b.lat - c.lat) * KM_PER_DEG_LAT - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Closest approach of a path to a zone's edge in km (negative: it enters the zone). */
export function clearanceKm(path: Point[], zone: ThreatZone): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, segmentKm(path[i - 1], path[i], zone));
  return best - zone.radiusKm;
}

export const pathKm = (path: Point[]) => path.slice(1).reduce((s, p, i) => s + haversineKm(path[i], p), 0);

/** The zone a point sits in, if any. */
export const zoneAt = (p: Point) => ZONES.find((z) => haversineKm(p, z) < z.radiusKm);

export interface DefencePlan extends Plan {
  /** Extra km over the straight line, from bending around threat zones. */
  detourKm: number;
  /** Closest approach to any threat zone's edge, km. */
  minClearanceKm: number;
}

/**
 * Terrain-following plan along a bent path: one planRoute per leg, joined. Each leg's waypoint altitudes are
 * relative to that leg's start ground, so they are shifted to the mission's start ground.
 */
export async function planPath(
  path: Point[],
  payloadKg: number,
  elevationAt: ElevationSampler,
): Promise<{ ok: true; plan: DefencePlan } | { ok: false; reason: string }> {
  if (path.length < 2) return { ok: false, reason: 'No route: the drop is inside a threat zone.' };
  const totalKm = pathKm(path);
  if (totalKm > ARK1.rangeOutKm) {
    return { ok: false, reason: `Route is ${totalKm.toFixed(1)} km. Ark-1 flies ${ARK1.rangeOutKm} km out.` };
  }
  const waypoints: Geo[] = [];
  const profile: ProfilePoint[] = [];
  let startGround = 0;
  let maxGround = -Infinity;
  let offsetKm = 0;
  for (let i = 1; i < path.length; i++) {
    const res = await planRoute({ start: path[i - 1], dest: path[i], payloadKg, elevationAt });
    if (!res.ok) return res;
    const leg = res.plan;
    if (i === 1) startGround = leg.startGroundAmslM;
    const shift = leg.startGroundAmslM - startGround;
    for (const w of leg.waypoints)
      waypoints.push({ ...w, altM: Math.round(((w.altM ?? 0) + shift) * 10) / 10 });
    for (const p of leg.profile) profile.push({ ...p, dKm: p.dKm + offsetKm });
    maxGround = Math.max(maxGround, leg.maxGroundAmslM);
    offsetKm += leg.distanceKm;
  }
  const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;
  return {
    ok: true,
    plan: {
      waypoints,
      distanceKm: round(totalKm, 2),
      etaMinutes: round((totalKm * 1000) / ARK1.cruiseMs / 60 + 1, 1),
      maxGroundAmslM: round(maxGround, 1),
      startGroundAmslM: round(startGround, 1),
      climbM: Math.max(...waypoints.map((w) => w.altM ?? 0)),
      profile,
      detourKm: round(totalKm - haversineKm(path[0], path[path.length - 1]), 2),
      minClearanceKm: round(Math.min(...ZONES.map((z) => clearanceKm(path, z))), 2),
    },
  };
}
