import type { Drone, DroneStatus, Mission, Telemetry } from '@contracts';

export const MAX_MISSIONS = 200;

export interface FleetDrone {
  id: string;
  status: DroneStatus;
  home: { lat: number; lon: number };
  batteryPct: number;
  missionId?: string;
  lastSeenAt?: string;
  pos?: { lat: number; lon: number; headingDeg: number; altM: number; groundSpeedMs: number };
}

export interface FleetState {
  drones: Record<string, FleetDrone>;
  missions: Record<string, Mission>;
}

/** `fleet/stats`, retained. Not a schema; see `parseFleetStats`. */
export interface FleetStats {
  flying: number;
  queued: number;
  deliveredTotal: number;
  avgDeliveryMin: number;
  /** Order to drop within the promise, in sim time (the sim may run faster than the wall clock). */
  onTimePct: number;
  windMs: number;
  windFromDeg: number;
  speedup: number;
  /** Orders held back by the weather. */
  held?: number;
  weatherCalls?: { go: number; caution: number; no_go: number };
}

export interface Hub {
  lat: number;
  lon: number;
  drones: number;
}

export interface FleetKpis {
  flying: number;
  queued: number;
  delivered: number;
  avgDeliveryMin: number | null;
  /** 0 to 1: relief missions among the active (dispatched or in flight) ones. */
  reliefShare: number;
  /** 0 to 100, from fleet/stats; null until the sim reports it. */
  onTimePct: number | null;
}

export const emptyFleet = (): FleetState => ({ drones: {}, missions: {} });

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function applyTelemetry(state: FleetState, t: Telemetry): FleetState {
  const prev = state.drones[t.droneId];
  const pos = {
    lat: t.position.lat,
    lon: t.position.lon,
    headingDeg: t.headingDeg ?? prev?.pos?.headingDeg ?? 0,
    altM: t.altAmslM ?? t.position.altM ?? 0,
    groundSpeedMs: t.groundSpeedMs ?? 0,
  };
  const drone: FleetDrone = {
    id: t.droneId,
    status: prev?.status ?? (t.armed ? 'in_flight' : 'available'),
    home: prev?.home ?? { lat: t.position.lat, lon: t.position.lon },
    batteryPct: t.batteryPct,
    missionId: t.missionId ?? prev?.missionId,
    lastSeenAt: t.ts,
    pos,
  };
  return { ...state, drones: { ...state.drones, [t.droneId]: drone } };
}

export function applyDrone(state: FleetState, d: Drone): FleetState {
  const prev = state.drones[d.id];
  const drone: FleetDrone = {
    id: d.id,
    status: d.status,
    home: { lat: d.home.lat, lon: d.home.lon },
    batteryPct: d.batteryPct ?? prev?.batteryPct ?? 0,
    missionId: d.missionId,
    lastSeenAt: d.lastSeenAt ?? prev?.lastSeenAt,
    pos: prev?.pos,
  };
  return { ...state, drones: { ...state.drones, [d.id]: drone } };
}

const createdMs = (m: Mission) => {
  const ms = Date.parse(m.createdAt);
  return Number.isFinite(ms) ? ms : 0;
};

/** Keeps at most MAX_MISSIONS: the oldest delivered go first, then the oldest of the rest. */
function prune(missions: Record<string, Mission>): Record<string, Mission> {
  const all = Object.values(missions);
  if (all.length <= MAX_MISSIONS) return missions;
  const order = [...all].sort((a, b) => {
    const da = a.status === 'delivered' ? 0 : 1;
    const db = b.status === 'delivered' ? 0 : 1;
    return da - db || createdMs(a) - createdMs(b);
  });
  const next = { ...missions };
  for (const m of order.slice(0, all.length - MAX_MISSIONS)) delete next[m.id];
  return next;
}

export function applyMission(state: FleetState, m: Mission): FleetState {
  return { ...state, missions: prune({ ...state.missions, [m.id]: m }) };
}

/** Unique hubs from the drones' home points (rounded to 4 dp, about 11 m), with a drone count each. */
export function hubsOf(state: FleetState): Hub[] {
  const hubs = new Map<string, Hub>();
  for (const d of Object.values(state.drones)) {
    const lat = Number(d.home.lat.toFixed(4));
    const lon = Number(d.home.lon.toFixed(4));
    const key = `${lat},${lon}`;
    const hub = hubs.get(key);
    if (hub) hub.drones += 1;
    else hubs.set(key, { lat, lon, drones: 1 });
  }
  return [...hubs.values()].sort((a, b) => a.lat - b.lat || a.lon - b.lon);
}

export function kpis(state: FleetState, stats: FleetStats | null): FleetKpis {
  const missions = Object.values(state.missions);
  const delivered = missions.filter((m) => m.status === 'delivered');
  const active = missions.filter((m) => m.status === 'dispatched' || m.status === 'in_flight');

  return {
    flying: stats?.flying ?? Object.values(state.drones).filter((d) => d.status === 'in_flight').length,
    // orders still waiting for a drone live in the sim; without stats, count missions not yet airborne
    queued: stats?.queued ?? missions.filter((m) => m.status === 'dispatched').length,
    delivered: Math.max(delivered.length, stats?.deliveredTotal ?? 0),
    avgDeliveryMin: stats ? stats.avgDeliveryMin : null,
    reliefShare: active.length ? active.filter((m) => m.mode === 'relief').length / active.length : 0,
    onTimePct: stats ? Math.round(stats.onTimePct) : null,
  };
}

/** `fleet/stats` has no JSON schema, so check the fields by hand. Every number must be finite. */
export function parseFleetStats(raw: unknown): FleetStats | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const { flying, queued, deliveredTotal, avgDeliveryMin, onTimePct, windMs, windFromDeg, speedup } = r;
  if (
    !isNum(flying) ||
    !isNum(queued) ||
    !isNum(deliveredTotal) ||
    !isNum(avgDeliveryMin) ||
    !isNum(onTimePct) ||
    !isNum(windMs) ||
    !isNum(windFromDeg) ||
    !isNum(speedup)
  )
    return null;
  const stats: FleetStats = {
    flying,
    queued,
    deliveredTotal,
    avgDeliveryMin,
    onTimePct,
    windMs,
    windFromDeg,
    speedup,
  };
  if (isNum(r.held)) stats.held = r.held;
  const c = r.weatherCalls as Record<string, unknown> | null | undefined;
  if (typeof c === 'object' && c !== null && isNum(c.go) && isNum(c.caution) && isNum(c.no_go))
    stats.weatherCalls = { go: c.go, caution: c.caution, no_go: c.no_go };
  return stats;
}

export const fleetWindText = (s: FleetStats | null) =>
  s ? `Wind ${s.windMs.toFixed(1)} m/s from ${Math.round(s.windFromDeg)}°` : null;

/** Minimal shape check for a `kind: "drone"` live update (no exported ajv validator for it). */
export function isDrone(v: unknown): v is Drone {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  const home = d.home as Record<string, unknown> | null | undefined;
  return (
    typeof d.id === 'string' &&
    typeof d.status === 'string' &&
    typeof home === 'object' &&
    home !== null &&
    isNum(home.lat) &&
    isNum(home.lon)
  );
}
