import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Theme } from './types';

/** OpenFreeMap: OpenStreetMap vector tiles, free and keyless. Tinted below to a calm, Apple Maps-like palette. */
export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const ROUTE_SOURCE = 'route';
export const TRACK_SOURCE = 'track';
export const DEM_SOURCE = 'dem';

const LIGHT = { land: '#F4F1EA', green: '#D3E8C6', water: '#AAD5F5', building: '#E6E2DA' };
const DARK = {
  land: '#1C1F24',
  green: '#22302A',
  water: '#1D3245',
  building: '#2A2E35',
  otherFill: '#23272D',
  road: '#3A3F48',
  roadMajor: '#4A505B',
  casing: '#15171B',
  label: '#C8CDD4',
  halo: '#1C1F24',
};
const SKY = {
  light: {
    'sky-color': '#8EC5FF',
    'horizon-color': '#EAF3FF',
    'fog-color': '#F4F7FA',
    'sky-horizon-blend': 0.5,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.5,
  },
  dark: {
    'sky-color': '#1B2433',
    'horizon-color': '#2A3547',
    'fog-color': '#1C1F24',
    'sky-horizon-blend': 0.5,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.5,
  },
};

// Layers this file adds; applyTheme handles them by name, never by the base-style regexes.
const OWN_LAYERS = new Set(['hillshade', 'route-casing', 'route', 'track', 'fleet-storm-label']);

export const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };
export const lineFeature = (coords: [number, number][]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: coords },
});

type PaintName = Parameters<MapLibreMap['setPaintProperty']>[1];
type PaintValue = Parameters<MapLibreMap['setPaintProperty']>[2];

// The style's own paint values, read before the first change so Light can restore them exactly.
const originals = new WeakMap<MapLibreMap, Map<string, PaintValue>>();

/** Dark gets `dark`; Light gets `light` if given, else the style's original value. */
function paint(
  map: MapLibreMap,
  id: string,
  prop: PaintName,
  theme: Theme,
  dark: PaintValue,
  light?: PaintValue,
) {
  let saved = originals.get(map);
  if (!saved) {
    saved = new Map();
    originals.set(map, saved);
  }
  const key = `${id}|${prop}`;
  if (!saved.has(key)) saved.set(key, map.getPaintProperty(id, prop));
  map.setPaintProperty(id, prop, theme === 'dark' ? dark : (light ?? (saved.get(key) as PaintValue)));
}

/** The 3D building boxes hide the 3D drone and the view; the 2D footprints stay. */
export function hideBuildingExtrusions(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'fill-extrusion') map.setLayoutProperty(layer.id, 'visibility', 'none');
  }
}

/** The route (with its casing) and the flown track; `widthScale` shrinks them for the minimap. */
export function addRouteLayers(map: MapLibreMap, widthScale = 1): void {
  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: EMPTY_FC });
  map.addSource(TRACK_SOURCE, { type: 'geojson', data: EMPTY_FC });
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: round,
    paint: { 'line-color': '#FFFFFF', 'line-width': 10 * widthScale, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'route',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: round,
    paint: { 'line-color': '#0A84FF', 'line-width': 6 * widthScale },
  });
  map.addLayer({
    id: 'track',
    type: 'line',
    source: TRACK_SOURCE,
    layout: round,
    paint: { 'line-color': '#7DB9F5', 'line-width': 6 * widthScale },
  });
}

/**
 * Recolours the base style in place (no style reload, so the toggle is instant): Light is the calm Apple Maps-like
 * tint, Dark the Apple Maps dark-like palette. Safe to call again on every theme change.
 */
export function applyTheme(map: MapLibreMap, theme: Theme): void {
  const dark = theme === 'dark';
  for (const { id, type } of map.getStyle().layers) {
    if (OWN_LAYERS.has(id)) continue;
    if (type === 'background') {
      paint(map, id, 'background-color', theme, DARK.land, LIGHT.land);
    } else if (type === 'fill') {
      if (/water|ocean|lake|river/.test(id)) paint(map, id, 'fill-color', theme, DARK.water, LIGHT.water);
      else if (/park|wood|forest|grass|landcover|nature|wetland/.test(id))
        paint(map, id, 'fill-color', theme, DARK.green, LIGHT.green);
      else if (/building/.test(id)) paint(map, id, 'fill-color', theme, DARK.building, LIGHT.building);
      else paint(map, id, 'fill-color', theme, DARK.otherFill); // pale landuse would glare on dark
    } else if (type === 'line') {
      if (/casing/.test(id)) paint(map, id, 'line-color', theme, DARK.casing);
      else if (/waterway/.test(id)) paint(map, id, 'line-color', theme, DARK.water);
      else if (/motorway|trunk|primary|secondary/.test(id))
        paint(map, id, 'line-color', theme, DARK.roadMajor);
      else if (/road|street|path|tunnel|bridge|highway|minor|service/.test(id))
        paint(map, id, 'line-color', theme, DARK.road);
    } else if (type === 'symbol') {
      paint(map, id, 'text-color', theme, DARK.label);
      paint(map, id, 'text-halo-color', theme, DARK.halo);
    }
  }
  if (map.getLayer('hillshade')) {
    map.setPaintProperty('hillshade', 'hillshade-shadow-color', dark ? '#000000' : '#9AA39A');
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', dark ? 0.15 : 0.25);
  }
  if (map.getLayer('route-casing')) {
    map.setPaintProperty('route-casing', 'line-color', dark ? '#1C1F24' : '#FFFFFF');
  }
  map.setSky(dark ? SKY.dark : SKY.light);
}

/** Adds terrain, hillshade, the route and track lines and the sky; hides 3D buildings. Call once on `load`. */
export function addArkLayers(map: MapLibreMap): void {
  hideBuildingExtrusions(map);

  // The same AWS terrain tiles the drone simulation stands on, so the 3D ground matches the physics.
  map.addSource(DEM_SOURCE, {
    type: 'raster-dem',
    tiles: [TERRARIUM_URL],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 15,
  });
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  map.addLayer(
    {
      id: 'hillshade',
      type: 'hillshade',
      source: DEM_SOURCE,
      paint: { 'hillshade-exaggeration': 0.25, 'hillshade-shadow-color': '#9AA39A' },
    },
    firstSymbol,
  );

  addRouteLayers(map);
  applyTheme(map, 'light'); // MapView re-applies the real theme straight after
}
