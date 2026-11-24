import { haversineKm } from './geo';
import type { Point } from './types';

// Mirrors simulation/ark_fleet/network.py.
export const HUBS = [
  { name: 'Kota Kinabalu', lat: 5.9804, lon: 116.0735 },
  { name: 'Papar', lat: 5.7346, lon: 115.9302 },
  { name: 'Beaufort', lat: 5.3473, lon: 115.7455 },
  { name: 'Keningau', lat: 5.3378, lon: 116.1602 },
  { name: 'Kota Belud', lat: 6.351, lon: 116.4305 },
  { name: 'Ranau', lat: 5.9538, lon: 116.664 },
] as const;

export type Hub = (typeof HUBS)[number];

export function nearestHub(p: Point): Hub {
  let best: Hub = HUBS[0];
  let bestKm = Infinity;
  for (const h of HUBS) {
    const km = haversineKm(p, h);
    if (km < bestKm) {
      best = h;
      bestKm = km;
    }
  }
  return best;
}
