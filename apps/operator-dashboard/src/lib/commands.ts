import type { CommandType, DroneCommand, Mission, PayloadItem } from '@contracts';
import { OPERATOR } from './config';
import { newId } from './ids';
import type { Plan } from './planRoute';
import type { PayloadRow, Point } from './types';

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export const payloadTotalKg = (rows: PayloadRow[]) => round3(rows.reduce((s, r) => s + r.qty * r.kgEach, 0));

export function toPayloadItems(rows: PayloadRow[]): PayloadItem[] {
  return rows.map((r) => ({ item: r.item.trim(), qty: r.qty, weightKg: round3(r.qty * r.kgEach) }));
}

export interface MissionInput {
  droneId: string;
  start: Point;
  dest: Point;
  plan: Plan;
  payload: PayloadRow[];
  /** Default gdex; the defence terminal sends military resupply. */
  mode?: Mission['mode'];
  /** Default ground; a PartyRock mission may ask for water. */
  landingType?: Mission['landingType'];
  aiRationale?: string;
  /** The SOS requests this mission answers (from a PartyRock SOS). */
  sosRequestIds?: string[];
}

/** An approved mission: the operator pressing Send (or Authorise) is the approval. */
export function buildMission({
  droneId,
  start,
  dest,
  plan,
  payload,
  mode = 'gdex',
  landingType = 'ground',
  aiRationale,
  sosRequestIds,
}: MissionInput): Mission {
  const now = new Date().toISOString();
  const items = toPayloadItems(payload);
  return {
    id: newId('msn'),
    mode,
    droneId,
    createdAt: now,
    status: 'approved',
    ...(sosRequestIds?.length ? { sosRequestIds } : {}),
    origin: { lat: start.lat, lon: start.lon },
    destination: { lat: dest.lat, lon: dest.lon },
    waypoints: plan.waypoints,
    landingType,
    ...(aiRationale ? { aiRationale } : {}),
    payload: items as Mission['payload'],
    payloadKg: round3(items.reduce((s, p) => s + p.weightKg, 0)),
    distanceKm: plan.distanceKm,
    etaMinutes: plan.etaMinutes,
    approvedBy: OPERATOR,
    approvedAt: now,
  };
}

export function buildCommand(type: CommandType, droneId: string, mission?: Mission): DroneCommand {
  return {
    id: newId('cmd'),
    droneId,
    issuedAt: new Date().toISOString(),
    issuedBy: OPERATOR,
    type,
    ...(type === 'upload_mission' && mission ? { mission } : {}),
  };
}
