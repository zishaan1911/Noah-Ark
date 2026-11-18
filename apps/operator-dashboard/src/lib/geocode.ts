import type { Point } from './types';

export interface Place {
  label: string;
  point: Point;
}

// Sabah and Sarawak: left, top, right, bottom (lon, lat). A bias only, `bounded=0` still finds other places.
const VIEWBOX = '109.5,7.4,119.3,0.8';

interface NominatimHit {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
}

/** Shorten "Papar, Papar District, Sabah, Malaysia" to its first 3 parts. */
const shorten = (name: string) =>
  name
    .split(',')
    .slice(0, 3)
    .map((s) => s.trim())
    .join(', ');

export function parseNominatim(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  const out: Place[] = [];
  for (const h of raw as NominatimHit[]) {
    const lat = Number(h?.lat);
    const lon = Number(h?.lon);
    if (typeof h?.display_name !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ label: shorten(h.display_name), point: { lat, lon } });
  }
  return out.slice(0, 6);
}

// shortcut: Nominatim (free, 1 req/s), move to Amazon Location Service search for production.
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6' +
    `&q=${encodeURIComponent(q)}&viewbox=${VIEWBOX}&bounded=0&accept-language=en`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return parseNominatim(await res.json());
}
