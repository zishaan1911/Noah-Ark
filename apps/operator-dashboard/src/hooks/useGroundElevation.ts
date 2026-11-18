import { useEffect, useState } from 'react';
import { elevationAt } from '../lib/terrain';

/** Terrain elevation (m AMSL) under a point, or null until known. Re-sampled about every 11 m of movement. */
export function useGroundElevation(lat: number | undefined, lon: number | undefined): number | null {
  const [ground, setGround] = useState<number | null>(null);
  const key = lat === undefined || lon === undefined ? null : `${lat.toFixed(4)},${lon.toFixed(4)}`;

  useEffect(() => {
    if (!key) return;
    const [la, lo] = key.split(',').map(Number);
    let cancelled = false;
    elevationAt(la ?? 0, lo ?? 0)
      .then((h) => {
        if (!cancelled) setGround(h);
      })
      .catch((err) => console.warn('Terrain lookup failed', err));
    return () => {
      cancelled = true;
    };
  }, [key]);

  return ground;
}
