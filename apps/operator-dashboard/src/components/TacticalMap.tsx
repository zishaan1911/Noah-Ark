import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, type GeoJSONSource } from 'maplibre-gl';
import { OUTPOSTS, SECTOR, ZONES, type ResupplyRequest } from '../lib/defence';
import { destinationPoint } from '../lib/geo';
import { EMPTY_FC } from '../lib/mapStyle';
import { T, loadTacticalStyle } from '../lib/tacticalStyle';
import type { Point } from '../lib/types';
import '../styles/map.css';

interface Props {
  requests: ResupplyRequest[];
  selectedId: string | null;
  /** Flown path as [lon, lat]. */
  track: [number, number][];
  drone: (Point & { headingDeg: number }) | null;
}

type Coord = [number, number];
const coords = (path: Point[]): Coord[] => path.map((p) => [p.lon, p.lat]);
const fc = <T,>(features: T[]) => ({ type: 'FeatureCollection' as const, features });
const line = (c: Coord[], properties: Record<string, string | number> = {}) => ({
  type: 'Feature' as const,
  properties,
  geometry: { type: 'LineString' as const, coordinates: c },
});

function ring(center: Point, radiusKm: number): Coord[] {
  const pts: Coord[] = [];
  for (let i = 0; i <= 64; i++) {
    const p = destinationPoint(center, (i / 64) * 360, radiusKm * 1000);
    pts.push([p.lon, p.lat]);
  }
  return pts;
}

const ZONE_FC = fc(
  ZONES.map((z) => ({
    type: 'Feature' as const,
    properties: { label: `${z.name} · NO-FLY` },
    geometry: { type: 'Polygon' as const, coordinates: [ring(z, z.radiusKm)] },
  })),
);
const OUTPOST_FC = fc(
  OUTPOSTS.map((o) => ({
    type: 'Feature' as const,
    properties: { label: o.name, kind: o.kind },
    geometry: { type: 'Point' as const, coordinates: [o.lon, o.lat] as Coord },
  })),
);

const S = {
  zones: 'd-zones',
  outposts: 'd-outposts',
  routes: 'd-routes',
  track: 'd-track',
  drone: 'd-drone',
};

/** The green tactical map of the exercise sector: zones, outposts, planned routes, the flown track and the drone. */
export function TacticalMap({ requests, selectedId, track, drone }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: MapLibreMap | null = null;
    let cancelled = false;
    loadTacticalStyle()
      .then((style) => {
        if (cancelled) return;
        map = new MapLibreMap({
          container,
          style,
          center: [SECTOR.center.lon, SECTOR.center.lat],
          zoom: SECTOR.zoom,
          pixelRatio: Math.min(devicePixelRatio, 1.5),
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        const m = map;
        m.on('load', () => {
          for (const id of Object.values(S)) m.addSource(id, { type: 'geojson', data: EMPTY_FC });
          (m.getSource(S.zones) as GeoJSONSource).setData(ZONE_FC);
          (m.getSource(S.outposts) as GeoJSONSource).setData(OUTPOST_FC);
          m.addLayer({
            id: 'd-zone-fill',
            type: 'fill',
            source: S.zones,
            paint: { 'fill-color': T.red, 'fill-opacity': 0.14 },
          });
          m.addLayer({
            id: 'd-zone-edge',
            type: 'line',
            source: S.zones,
            paint: { 'line-color': T.red, 'line-width': 2, 'line-dasharray': [3, 2] },
          });
          m.addLayer({
            id: 'd-routes',
            type: 'line',
            source: S.routes,
            layout: { 'line-cap': 'round' },
            paint: {
              'line-color': ['match', ['get', 'kind'], 'selected', T.green, 'direct', T.red, T.dim],
              'line-width': ['match', ['get', 'kind'], 'selected', 3, 1.5],
              'line-dasharray': [3, 2],
              'line-opacity': ['match', ['get', 'kind'], 'other', 0.55, 0.95],
            },
          });
          m.addLayer({
            id: 'd-track',
            type: 'line',
            source: S.track,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': T.bright, 'line-width': 2.5 },
          });
          m.addLayer({
            id: 'd-outposts',
            type: 'circle',
            source: S.outposts,
            paint: {
              'circle-radius': ['match', ['get', 'kind'], 'base', 7, 5],
              'circle-color': T.bg,
              'circle-stroke-color': ['match', ['get', 'kind'], 'base', T.bright, T.green],
              'circle-stroke-width': 2,
            },
          });
          const label = {
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-letter-spacing': 0.08,
            'text-offset': [0, 1.3] as [number, number],
            'text-anchor': 'top' as const,
          };
          m.addLayer({
            id: 'd-outpost-labels',
            type: 'symbol',
            source: S.outposts,
            layout: { ...label, 'text-field': ['get', 'label'] },
            paint: { 'text-color': T.bright, 'text-halo-color': T.bg, 'text-halo-width': 2 },
          });
          m.addLayer({
            id: 'd-zone-labels',
            type: 'symbol',
            source: S.zones,
            layout: { ...label, 'text-field': ['get', 'label'], 'text-offset': [0, 0] },
            paint: { 'text-color': '#ff8a78', 'text-halo-color': T.bg, 'text-halo-width': 2 },
          });
          m.addLayer({
            id: 'd-drone-halo',
            type: 'circle',
            source: S.drone,
            paint: {
              'circle-radius': 14,
              'circle-color': T.green,
              'circle-opacity': 0.18,
              'circle-blur': 0.4,
            },
          });
          m.addLayer({
            id: 'd-drone',
            type: 'circle',
            source: S.drone,
            paint: {
              'circle-radius': 6,
              'circle-color': T.bright,
              'circle-stroke-color': T.green,
              'circle-stroke-width': 2,
            },
          });
          m.addLayer({
            id: 'd-drone-label',
            type: 'symbol',
            source: S.drone,
            layout: {
              ...label,
              'text-field': ['get', 'label'],
              'text-anchor': 'left',
              'text-offset': [1.2, 0],
              'text-allow-overlap': true,
            },
            paint: { 'text-color': T.bright, 'text-halo-color': T.bg, 'text-halo-width': 2 },
          });
          setReady(true);
        });
      })
      .catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      setReady(false);
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  const routes = useMemo(() => {
    const features = [];
    for (const r of requests) {
      if (r.path.length < 2) continue;
      const selected = r.id === selectedId;
      features.push(line(coords(r.path), { kind: selected ? 'selected' : 'other' }));
      if (selected && r.path.length > 2)
        features.push(line(coords([r.path[0], r.path[r.path.length - 1]]), { kind: 'direct' }));
    }
    return fc(features);
  }, [requests, selectedId]);

  useEffect(() => {
    if (ready) (mapRef.current?.getSource(S.routes) as GeoJSONSource | undefined)?.setData(routes);
  }, [ready, routes]);

  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource(S.track) as GeoJSONSource | undefined)?.setData(
      track.length > 1 ? fc([line(track)]) : EMPTY_FC,
    );
  }, [ready, track]);

  useEffect(() => {
    if (!ready) return;
    const src = mapRef.current?.getSource(S.drone) as GeoJSONSource | undefined;
    src?.setData(
      drone
        ? fc([
            {
              type: 'Feature' as const,
              properties: { label: `LIVE ▸ ${Math.round(drone.headingDeg).toString().padStart(3, '0')}°` },
              geometry: { type: 'Point' as const, coordinates: [drone.lon, drone.lat] as Coord },
            },
          ])
        : EMPTY_FC,
    );
  }, [ready, drone]);

  return (
    <div className="relative size-full" style={{ background: T.bg }}>
      <div ref={containerRef} className="size-full" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: 'inset 0 0 80px rgba(0,0,0,0.85)' }}
      />
      {failed && (
        <p
          role="status"
          className="absolute inset-x-4 top-4 m-0 p-2 text-xs"
          style={{ color: T.amber, background: T.bg }}
        >
          MAP UNAVAILABLE · {failed}
        </p>
      )}
    </div>
  );
}
