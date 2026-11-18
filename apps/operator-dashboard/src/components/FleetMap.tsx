import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, type ExpressionSpecification, type GeoJSONSource } from 'maplibre-gl';
import type { FlyCall, Weather } from '@contracts';
import { hubsOf, type FleetState } from '../lib/fleet';
import { destinationPoint } from '../lib/geo';
import { BASE_STYLE_URL, EMPTY_FC, applyTheme, hideBuildingExtrusions } from '../lib/mapStyle';
import type { Theme } from '../lib/types';
import '../styles/map.css';

interface Props {
  state: FleetState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  theme: Theme;
  weather: Weather | null;
  radar: boolean;
}

const RADAR_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_REFRESH_MS = 10 * 60 * 1000;
const RADAR_SOURCE = 'fleet-radar';
const STORMS = 'fleet-storms';
const STORM_LABELS = 'fleet-storm-labels';
const STORM_POINTS = 48;

const key3 = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

const HUBS = 'fleet-hubs';
const ROUTES = 'fleet-routes';
const DESTS = 'fleet-dests';
const DRONES = 'fleet-drones';

const ACCENT = '#0A84FF';
const RED = '#E0604A';
const AMBER = '#F5A524';
const GREEN = '#34A853';
const GREY = '#8E8E93';

const modeColor: ExpressionSpecification = ['match', ['get', 'mode'], 'relief', RED, ACCENT];

type Coord = [number, number];
const point = (coords: Coord, properties: Record<string, string | number>) => ({
  type: 'Feature' as const,
  properties,
  geometry: { type: 'Point' as const, coordinates: coords },
});
const collection = <T,>(features: T[]) => ({ type: 'FeatureCollection' as const, features });

/** A flat fleet overview. Everything is a GeoJSON layer (24+ drones), updated from props, never per frame. */
export function FleetMap({ state, selectedId, onSelect, theme, weather, radar }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const themeRef = useRef(theme);
  const onSelectRef = useRef(onSelect);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    themeRef.current = theme;
    onSelectRef.current = onSelect;
  }, [theme, onSelect]);

  const hubs = useMemo(() => hubsOf(state), [state]);

  const data = useMemo(() => {
    const active = Object.values(state.missions).filter(
      (m) => m.status === 'dispatched' || m.status === 'in_flight',
    );
    const calls = new Map<string, FlyCall>((weather?.hubs ?? []).map((w) => [key3(w.lat, w.lon), w.call]));
    return {
      hubs: collection(
        hubs.map((h) => {
          const call = calls.get(key3(h.lat, h.lon));
          return point([h.lon, h.lat], {
            count: h.drones,
            call: call ?? '',
            label: `Hub · ${h.drones}${call === 'no_go' ? ' · on hold' : ''}`,
          });
        }),
      ),
      storms: collection(
        (weather?.storms ?? []).map((s) => {
          const centre = { lat: s.lat, lon: s.lon };
          const ring: Coord[] = [];
          for (let i = 0; i < STORM_POINTS; i++) {
            const p = destinationPoint(centre, (i * 360) / STORM_POINTS, s.radiusKm * 1000);
            ring.push([p.lon, p.lat]);
          }
          ring.push(ring[0]);
          return {
            type: 'Feature' as const,
            properties: { id: s.id },
            geometry: { type: 'Polygon' as const, coordinates: [ring] },
          };
        }),
      ),
      stormLabels: collection(
        (weather?.storms ?? []).map((s) =>
          point([s.lon, s.lat], {
            label: `${s.id} · ${Math.round(s.rainMmH)} mm/h${s.thunder ? ' ⚡' : ''}`,
          }),
        ),
      ),
      routes: collection(
        active.map((m) => ({
          type: 'Feature' as const,
          properties: { mode: m.mode },
          geometry: {
            type: 'LineString' as const,
            coordinates: [m.origin, ...(m.waypoints ?? []), m.destination].map((p): Coord => [p.lon, p.lat]),
          },
        })),
      ),
      dests: collection(active.map((m) => point([m.destination.lon, m.destination.lat], { mode: m.mode }))),
      drones: collection(
        Object.values(state.drones).map((d) => {
          const at = d.pos ?? d.home;
          return point([at.lon, at.lat], { id: d.id, status: d.status });
        }),
      ),
    };
  }, [state, hubs, weather]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new MapLibreMap({
      container,
      style: BASE_STYLE_URL,
      center: [116.15, 5.75],
      zoom: 8.6,
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on('load', () => {
      hideBuildingExtrusions(map);
      for (const id of [STORMS, STORM_LABELS, HUBS, ROUTES, DESTS, DRONES])
        map.addSource(id, { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'fleet-storm-fill',
        type: 'fill',
        source: STORMS,
        paint: { 'fill-color': RED, 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: 'fleet-storm-line',
        type: 'line',
        source: STORMS,
        paint: { 'line-color': RED, 'line-width': 2, 'line-dasharray': [2, 2] },
      });
      map.addLayer({
        id: 'fleet-hub-ring',
        type: 'circle',
        source: HUBS,
        paint: {
          'circle-radius': 15,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 3,
          'circle-stroke-color': [
            'match',
            ['get', 'call'],
            'go',
            GREEN,
            'caution',
            AMBER,
            'no_go',
            RED,
            'rgba(0,0,0,0)',
          ],
        },
      });
      map.addLayer({
        id: 'fleet-hubs',
        type: 'circle',
        source: HUBS,
        paint: {
          'circle-radius': 9,
          'circle-color': '#1C1C1E',
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'fleet-hub-label',
        type: 'symbol',
        source: HUBS,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-offset': [0, 1.6],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#1C1C1E', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 },
      });
      map.addLayer({
        id: 'fleet-storm-label',
        type: 'symbol',
        source: STORM_LABELS,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#B23A26', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 },
      });
      map.addLayer({
        id: 'fleet-routes',
        type: 'line',
        source: ROUTES,
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': modeColor,
          'line-width': 3,
          'line-dasharray': [1.5, 1.5],
          'line-opacity': 0.95,
        },
      });
      map.addLayer({
        id: 'fleet-dests',
        type: 'circle',
        source: DESTS,
        paint: { 'circle-radius': 4, 'circle-color': modeColor, 'circle-opacity': 0.9 },
      });
      map.addLayer({
        id: 'fleet-selected',
        type: 'circle',
        source: DRONES,
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': 15,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': ACCENT,
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: 'fleet-drones',
        type: 'circle',
        source: DRONES,
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'match',
            ['get', 'status'],
            ['in_flight', 'assigned'],
            ACCENT,
            'charging',
            AMBER,
            'available',
            GREEN,
            GREY,
          ],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
        },
      });
      map.on('click', DRONES, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') onSelectRef.current(id);
      });
      map.on('mouseenter', DRONES, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', DRONES, () => (map.getCanvas().style.cursor = ''));
      applyTheme(map, themeRef.current);
      setReady(true);
    });
    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) applyTheme(map, theme);
  }, [ready, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const sources: [string, Parameters<GeoJSONSource['setData']>[0]][] = [
      [STORMS, data.storms],
      [STORM_LABELS, data.stormLabels],
      [HUBS, data.hubs],
      [ROUTES, data.routes],
      [DESTS, data.dests],
      [DRONES, data.drones],
    ];
    for (const [id, fc] of sources) (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
  }, [ready, data]);

  // Rain radar: newest past frame from RainViewer, refreshed every 10 min, removed when switched off.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !radar) return;
    let cancelled = false;
    const remove = () => {
      if (map.getLayer(RADAR_SOURCE)) map.removeLayer(RADAR_SOURCE);
      if (map.getSource(RADAR_SOURCE)) map.removeSource(RADAR_SOURCE);
    };
    const load = async () => {
      try {
        const res = await fetch(RADAR_INDEX);
        if (!res.ok) throw new Error(`RainViewer answered ${res.status}`);
        const index = (await res.json()) as { host?: string; radar?: { past?: { path?: string }[] } };
        const path = index.radar?.past?.at(-1)?.path;
        if (!index.host || !path) throw new Error('RainViewer sent no radar frames');
        if (cancelled) return;
        remove();
        map.addSource(RADAR_SOURCE, {
          type: 'raster',
          tiles: [`${index.host}${path}/256/{z}/{x}/{y}/2/1_1.png`],
          tileSize: 256,
          maxzoom: 7, // the free API stops at zoom 7; MapLibre overscales
          attribution: 'Radar © RainViewer',
        });
        map.addLayer(
          { id: RADAR_SOURCE, type: 'raster', source: RADAR_SOURCE, paint: { 'raster-opacity': 0.6 } },
          'fleet-storm-fill',
        );
      } catch (err) {
        if (!cancelled) console.warn('Rain radar unavailable', err);
      }
    };
    void load();
    const id = setInterval(() => void load(), RADAR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      try {
        remove();
      } catch {
        // the map was already torn down with the page
      }
    };
  }, [ready, radar]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) map.setFilter('fleet-selected', ['==', ['get', 'id'], selectedId ?? '']);
  }, [ready, selectedId]);

  // Fit the hubs once, when they first show up.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || fitted.current || hubs.length < 2) return;
    fitted.current = true;
    const wide = window.innerWidth >= 1024;
    const lons = hubs.map((h) => h.lon);
    const lats = hubs.map((h) => h.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      {
        padding: { top: 100, bottom: 60, left: wide ? 420 : 40, right: wide ? 340 : 40 },
        maxZoom: 10,
        duration: 0,
      },
    );
  }, [ready, hubs]);

  return <div ref={containerRef} className="size-full" />;
}
