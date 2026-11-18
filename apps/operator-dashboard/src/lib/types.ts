export type View = 'map' | 'chase' | 'onboard';

export interface Point {
  lat: number;
  lon: number;
}

/** Drone pose used to move the cameras and the 3D model. Angles in degrees, altitude metres AMSL. */
export interface Pose extends Point {
  altAmslM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export interface PayloadRow {
  id: number;
  item: string;
  qty: number;
  kgEach: number;
}

/** Payload of `sim/<droneId>/status` (see shared/api/channels.md). */
export interface SimStatus {
  state: 'booting' | 'ready' | 'error';
  lat: number;
  lon: number;
  groundAmslM: number;
  windMs: number;
  windFromDeg: number;
  detail?: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The sim status has no JSON schema, so check the fields by hand. */
export function parseSimStatus(raw: unknown): SimStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.state !== 'booting' && r.state !== 'ready' && r.state !== 'error') return null;
  return {
    state: r.state,
    lat: isNum(r.lat) ? r.lat : NaN,
    lon: isNum(r.lon) ? r.lon : NaN,
    groundAmslM: isNum(r.groundAmslM) ? r.groundAmslM : NaN,
    windMs: isNum(r.windMs) ? r.windMs : NaN,
    windFromDeg: isNum(r.windFromDeg) ? r.windFromDeg : NaN,
    detail: typeof r.detail === 'string' ? r.detail : undefined,
  };
}
