import { describe, expect, it } from 'vitest';
import { ARK1 } from './ark1';
import { payloadTotalKg } from './commands';
import {
  OUTPOSTS,
  REQUESTS,
  ZONES,
  ZONE_MARGIN_KM,
  clearanceKm,
  outpost,
  pathKm,
  planPath,
  segmentKm,
  zoneAt,
} from './defence';

const routed = REQUESTS.filter((r) => r.path.length > 1);

describe('exercise data', () => {
  it('every routed request starts at the base, ends at its outpost and clears every zone', () => {
    const base = OUTPOSTS[0];
    for (const r of routed) {
      expect(r.path[0]).toEqual(base);
      const to = outpost(r.to);
      expect(to).toBeDefined();
      expect(r.path[r.path.length - 1]).toMatchObject({ lat: to?.lat, lon: to?.lon });
      for (const z of ZONES) expect(clearanceKm(r.path, z)).toBeGreaterThanOrEqual(ZONE_MARGIN_KM);
    }
  });

  it('a route bends only where the straight line is blocked', () => {
    for (const r of routed) {
      const direct = [r.path[0], r.path[r.path.length - 1]];
      const blocked = ZONES.some((z) => clearanceKm(direct, z) < ZONE_MARGIN_KM);
      expect(blocked).toBe(r.path.length > 2);
    }
  });

  it('requests fit the live Ark-1 airframe', () => {
    for (const r of REQUESTS) expect(payloadTotalKg(r.payload)).toBeLessThanOrEqual(ARK1.maxPayloadKg);
    for (const r of routed) expect(pathKm(r.path)).toBeLessThanOrEqual(ARK1.rangeOutKm);
  });

  it('the held request has its drop inside a zone and no route', () => {
    const held = REQUESTS.filter((r) => r.path.length === 0);
    expect(held).toHaveLength(1);
    const to = outpost(held[0].to);
    expect(to && zoneAt(to)?.id).toBe('tz-bravo');
  });
});

describe('segmentKm', () => {
  it('is the perpendicular distance in the middle and the end distance past the ends', () => {
    const c = { lat: 5, lon: 118 };
    expect(segmentKm({ lat: 4.99, lon: 117.99 }, { lat: 4.99, lon: 118.01 }, c)).toBeCloseTo(1.1057, 3);
    expect(segmentKm({ lat: 5, lon: 118.01 }, { lat: 5, lon: 118.02 }, c)).toBeCloseTo(1.109, 2);
  });
});

describe('planPath', () => {
  // ground rises 100 m for every 0.09 deg north of the base
  const elev = async (lat: number) => Math.max(0, ((lat - 5.03) / 0.09) * 100);

  it('joins the legs, keeps terrain clearance everywhere and reports the detour', async () => {
    const r = routed.find((x) => x.id === 'REQ-0412');
    if (!r) throw new Error('missing REQ-0412');
    const res = await planPath(r.path, payloadTotalKg(r.payload), elev);
    if (!res.ok) throw new Error(res.reason);
    const { plan } = res;
    expect(plan.distanceKm).toBeCloseTo(pathKm(r.path), 1);
    expect(plan.detourKm).toBeGreaterThan(1);
    expect(plan.minClearanceKm).toBeGreaterThanOrEqual(ZONE_MARGIN_KM);
    const last = plan.waypoints[plan.waypoints.length - 1];
    expect(last).toMatchObject({ lat: 5.12, lon: 118.4 });
    for (const w of plan.waypoints) {
      const ground = await elev(w.lat);
      expect(plan.startGroundAmslM + (w.altM ?? 0)).toBeGreaterThanOrEqual(ground + ARK1.clearanceM - 1);
    }
  });

  it('refuses a held request', async () => {
    const res = await planPath([], 1, elev);
    expect(res.ok).toBe(false);
  });
});
