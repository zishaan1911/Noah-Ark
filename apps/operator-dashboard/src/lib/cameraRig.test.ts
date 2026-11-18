import { describe, expect, it } from 'vitest';
import {
  CHASE_DEFAULT,
  CHASE_LIMITS,
  GIMBAL_DEFAULT,
  chaseCamera,
  clampChase,
  dragChase,
  gimbalCamera,
  zoomChaseWheel,
} from './cameraRig';
import { haversineKm } from './geo';
import type { Pose } from './types';

const pose = (headingDeg: number): Pose => ({
  lat: 5.7346,
  lon: 115.9302,
  altAmslM: 100,
  headingDeg,
  pitchDeg: 0,
  rollDeg: 0,
});

describe('chaseCamera', () => {
  it('defaults to 14 m away at 18 degrees, behind the heading', () => {
    const p = pose(90);
    const { from, to } = chaseCamera(p, CHASE_DEFAULT);
    const horizM = haversineKm(from, to) * 1000;
    const upM = from.altAmslM - to.altAmslM;
    expect(Math.hypot(horizM, upM)).toBeCloseTo(14, 1);
    expect((Math.atan2(upM, horizM) * 180) / Math.PI).toBeCloseTo(18, 1);
    expect(from.lon).toBeLessThan(p.lon); // heading east, so the camera is west
  });

  it('puts the camera in front at a 180 degree yaw offset', () => {
    const p = pose(90);
    const { from } = chaseCamera(p, { ...CHASE_DEFAULT, yawOffsetDeg: 180 });
    expect(from.lon).toBeGreaterThan(p.lon);
  });

  it('keeps distance and elevation inside their limits', () => {
    for (const bad of [-1e9, 0, 1e9]) {
      const r = clampChase({ yawOffsetDeg: 0, elevDeg: bad, distM: bad });
      expect(r.elevDeg).toBeGreaterThanOrEqual(CHASE_LIMITS.elevMin);
      expect(r.elevDeg).toBeLessThanOrEqual(CHASE_LIMITS.elevMax);
      expect(r.distM).toBeGreaterThanOrEqual(CHASE_LIMITS.distMin);
      expect(r.distM).toBeLessThanOrEqual(CHASE_LIMITS.distMax);
    }
    expect(dragChase(CHASE_DEFAULT, 0, 1e6).elevDeg).toBe(CHASE_LIMITS.elevMax);
    expect(zoomChaseWheel(CHASE_DEFAULT, 1e6).distM).toBe(CHASE_LIMITS.distMax);
    expect(zoomChaseWheel(CHASE_DEFAULT, -1e6).distM).toBe(CHASE_LIMITS.distMin);
  });
});

describe('gimbalCamera', () => {
  it('bearing is heading plus pan wrapped to 0..360, pitch is 90 minus tilt', () => {
    const c = gimbalCamera(pose(350), { ...GIMBAL_DEFAULT, panDeg: 30, tiltDeg: 30 });
    expect(c.bearingDeg).toBeCloseTo(20, 6);
    expect(c.pitchDeg).toBe(60);
    expect(gimbalCamera(pose(10), { ...GIMBAL_DEFAULT, panDeg: -30 }).bearingDeg).toBeCloseTo(340, 6);
  });
});
