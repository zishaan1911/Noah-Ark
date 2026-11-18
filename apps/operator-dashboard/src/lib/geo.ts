import type { Point } from './types';

const R_EARTH_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const normDeg = (d: number) => ((d % 360) + 360) % 360;

/** Great-circle distance in km. */
export function haversineKm(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return (2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))) / 1000;
}

/** Initial bearing from a to b, degrees clockwise from north, 0 to <360. */
export function bearingDeg(a: Point, b: Point): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return normDeg(deg(Math.atan2(y, x)));
}

/** The point `distM` metres from `from` along `bearing` (degrees). */
export function destinationPoint(from: Point, bearing: number, distM: number): Point {
  const d = distM / R_EARTH_M;
  const b = rad(bearing);
  const lat1 = rad(from.lat);
  const lon1 = rad(from.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/** Interpolate two angles along the shortest arc. Result is 0 to <360. */
export function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return normDeg(a + delta * t);
}

/** Parse "5.73, 115.93" (comma, semicolon or space separated). */
export function parseLatLon(text: string): Point | null {
  const parts = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export const formatLatLon = (p: Point) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
