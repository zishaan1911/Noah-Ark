import type { Map as MapLibreMap } from 'maplibre-gl';

/** OpenFreeMap: OpenStreetMap vector tiles, free and keyless. Tinted below to a calm, Apple Maps-like palette. */
export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const ROUTE_SOURCE = 'route';
export const TRACK_SOURCE = 'track';
export const DEM_SOURCE = 'dem';

const PALETTE = {
  land: '#F4F1EA',
  green: '#D3E8C6',
  water: '#AAD5F5',
  building: '#E6E2DA',
};

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/** Adds terrain, hillshade, the route and track lines and the sky, and tints the base map. Call once on `load`. */
export function addArkLayers(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers) {
    const id = layer.id;
    if (layer.type === 'background') map.setPaintProperty(id, 'background-color', PALETTE.land);
    if (layer.type !== 'fill') continue;
    if (/water|ocean|lake|river/.test(id)) map.setPaintProperty(id, 'fill-color', PALETTE.water);
    else if (/park|wood|forest|grass|landcover|nature|wetland/.test(id))
      map.setPaintProperty(id, 'fill-color', PALETTE.green);
    else if (/building/.test(id)) map.setPaintProperty(id, 'fill-color', PALETTE.building);
  }

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

  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: EMPTY });
  map.addSource(TRACK_SOURCE, { type: 'geojson', data: EMPTY });
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: round,
    paint: { 'line-color': '#FFFFFF', 'line-width': 10, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'route',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: round,
    paint: { 'line-color': '#0A84FF', 'line-width': 6 },
  });
  map.addLayer({
    id: 'track',
    type: 'line',
    source: TRACK_SOURCE,
    layout: round,
    paint: { 'line-color': '#7DB9F5', 'line-width': 6 },
  });

  map.setSky({
    'sky-color': '#8EC5FF',
    'horizon-color': '#EAF3FF',
    'fog-color': '#F4F7FA',
    'sky-horizon-blend': 0.5,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.5,
  });
}
