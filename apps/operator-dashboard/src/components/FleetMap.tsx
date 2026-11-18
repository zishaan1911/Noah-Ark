import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, type ExpressionSpecification, type GeoJSONSource } from 'maplibre-gl';
import { hubsOf, type FleetState } from '../lib/fleet';
import { BASE_STYLE_URL, EMPTY_FC, applyTheme, hideBuildingExtrusions } from '../lib/mapStyle';
import type { Theme } from '../lib/types';
import '../styles/map.css';

interface Props {
  state: FleetState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  theme: Theme;
}

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
export function FleetMap({ state, selectedId, onSelect, theme }: Props) {
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
    return {
      hubs: collection(
        hubs.map((h) => point([h.lon, h.lat], { count: h.drones, label: `Hub · ${h.drones}` })),
      ),
      routes: collection(
        active.map((m) => ({
          type: 'Feature' as const,
          properties: { mode: m.mode },
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [m.origin.lon, m.origin.lat],
              [m.destination.lon, m.destination.lat],
            ] as Coord[],
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
  }, [state, hubs]);

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
      for (const id of [HUBS, ROUTES, DESTS, DRONES]) map.addSource(id, { type: 'geojson', data: EMPTY_FC });
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
      [HUBS, data.hubs],
      [ROUTES, data.routes],
      [DESTS, data.dests],
      [DRONES, data.drones],
    ];
    for (const [id, fc] of sources) (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
  }, [ready, data]);

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
