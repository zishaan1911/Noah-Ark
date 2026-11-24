import type { Mission, MissionRequest, SosRequest, SosTriage } from '@contracts';
import { nearestHub } from './hubs';
import { kitFor } from './kit';

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const triageOf = (sos: SosRequest): SosTriage => {
  if (!sos.triage) throw new Error(`SOS ${sos.id} has no triage`);
  return sos.triage;
};

/** A pending relief mission for the live drone. Pure (no clock, no random) so it can run in render. */
export function sosToMission(sos: SosRequest, droneId: string): Mission {
  const triage = triageOf(sos);
  const where = sos.report.location;
  const hub = nearestHub(where);
  const payload = kitFor(triage) as Mission['payload'];
  return {
    id: `msn_${sos.id.slice(4)}`,
    mode: 'relief',
    droneId,
    createdAt: sos.createdAt,
    status: 'pending_approval',
    sosRequestIds: [sos.id],
    origin: { lat: hub.lat, lon: hub.lon },
    destination: where,
    landingType: triage.waterLanding ? 'water' : 'ground',
    payload,
    payloadKg: round3(payload.reduce((s, p) => s + p.weightKg, 0)),
    aiRationale: `Urgency ${triage.urgency}: ${triage.summary}`.slice(0, 2000),
  };
}

/** An order for the fleet dispatcher, which picks the drone. */
export function sosToOrder(sos: SosRequest): MissionRequest {
  const triage = triageOf(sos);
  return {
    mode: 'relief',
    sosRequestIds: [sos.id],
    destination: sos.report.location,
    payload: kitFor(triage),
    landingType: triage.waterLanding ? 'water' : 'ground',
    urgency: triage.urgency,
    notes: triage.summary,
  };
}
