import { describe, expect, it } from 'vitest';
import { bearingDeg, destinationPoint, haversineKm, lerpAngle, parseLatLon } from './geo';

const PAPAR = { lat: 5.7346, lon: 115.9302 };
const KOTA_KINABALU = { lat: 5.9804, lon: 116.0735 };

describe('geo', () => {
  it('haversine Papar to Kota Kinabalu is about 31 km', () => {
    expect(Math.abs(haversineKm(PAPAR, KOTA_KINABALU) - 31)).toBeLessThan(1);
  });

  it('lerpAngle takes the shortest arc', () => {
    expect(lerpAngle(350, 10, 0.5)).toBe(0);
    expect(lerpAngle(10, 350, 0.5)).toBe(0);
    expect(lerpAngle(0, 90, 0.5)).toBe(45);
  });

  it('destinationPoint and bearing agree with haversine', () => {
    const p = destinationPoint(PAPAR, 90, 5000);
    expect(haversineKm(PAPAR, p)).toBeCloseTo(5, 3);
    expect(bearingDeg(PAPAR, p)).toBeCloseTo(90, 1);
  });

  it('parses "lat, lon" text', () => {
    expect(parseLatLon('5.73, 115.93')).toEqual({ lat: 5.73, lon: 115.93 });
    expect(parseLatLon('5.73 115.93')).toEqual({ lat: 5.73, lon: 115.93 });
    expect(parseLatLon('95, 10')).toBeNull();
    expect(parseLatLon('hello')).toBeNull();
  });
});
