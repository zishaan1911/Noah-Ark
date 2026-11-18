import { describe, expect, it } from 'vitest';
import { destinationPoint, haversineKm } from './geo';
import { planRoute, type ElevationSampler } from './planRoute';
import type { Point } from './types';

const START: Point = { lat: 5.7346, lon: 115.9302 };
const eastOf = (km: number) => destinationPoint(START, 90, km * 1000);
const flat =
  (m: number): ElevationSampler =>
  async () =>
    m;
/** Ground height as a function of the distance from START in metres. */
const byDistance =
  (height: (d: number) => number): ElevationSampler =>
  async (lat, lon) =>
    height(haversineKm(START, { lat, lon }) * 1000);

async function plan(distKm: number, elevationAt: ElevationSampler, payloadKg = 1.2) {
  return planRoute({ start: START, dest: eastOf(distKm), payloadKg, elevationAt });
}

describe('planRoute', () => {
  it('flies flat ground at 60 m with waypoints at most 1 km apart', async () => {
    const res = await plan(8, flat(100));
    if (!res.ok) throw new Error(res.reason);
    expect(res.plan.waypoints).toHaveLength(8);
    expect(res.plan.waypoints.every((w) => w.altM === 60)).toBe(true);
    let prev: Point = START;
    for (const w of res.plan.waypoints) {
      expect(haversineKm(prev, w)).toBeLessThanOrEqual(1.001);
      prev = w;
    }
    expect(res.plan.distanceKm).toBeCloseTo(8, 1);
    expect(res.plan.etaMinutes).toBeCloseTo(8000 / 17 / 60 + 1, 1);
  });

  it('climbs before a 400 m ridge halfway along', async () => {
    const ridge = byDistance((d) => (d >= 4950 && d <= 5600 ? 400 : 0));
    const res = await plan(10, ridge);
    if (!res.ok) throw new Error(res.reason);
    const w = res.plan.waypoints;
    expect(w[0]?.altM).toBe(60);
    expect(w[4]?.altM).toBeGreaterThanOrEqual(460); // leg ending at 5 km sees the ridge
    expect(w[5]?.altM).toBeGreaterThanOrEqual(460);
    expect(res.plan.maxGroundAmslM).toBeGreaterThanOrEqual(400);
  });

  it('never goes below 30 m', async () => {
    const valley = byDistance((d) => (d < 100 ? 500 : 0)); // start on a hill, flat low ground after
    const res = await plan(6, valley);
    if (!res.ok) throw new Error(res.reason);
    expect(res.plan.waypoints.every((w) => (w.altM ?? 0) >= 30)).toBe(true);
    expect(res.plan.waypoints.at(-1)?.altM).toBe(30);
  });

  it('rejects 25 km', async () => {
    const res = await plan(25, flat(0));
    expect(res.ok).toBe(false);
  });

  it('rejects a payload of 2.1 kg', async () => {
    const res = await plan(5, flat(0), 2.1);
    expect(res.ok).toBe(false);
  });
});
