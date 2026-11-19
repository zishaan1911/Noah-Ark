import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { BASE_STYLE_URL, DEM_SOURCE, TERRARIUM_URL } from './mapStyle';

/** Phosphor-green palette of the defence terminal. */
export const T = {
  bg: '#040805',
  land: '#050b06',
  water: '#02150b',
  park: '#06120a',
  river: '#1f6b33',
  road: '#16391f',
  road2: '#22552f',
  border: '#2a8a44',
  label: '#3fb860',
  green: '#4dff7a',
  bright: '#b6ffc8',
  dim: '#36a556',
  line: '#1c4a28',
  amber: '#ffb000',
  red: '#ff6a55',
} as const;

const DROP = /building|aeroway|poi|housenumber|shield/;

function restyle(l: LayerSpecification): LayerSpecification | null {
  const id = l.id;
  if (l.type === 'fill-extrusion' || DROP.test(id)) return null;
  switch (l.type) {
    case 'background':
      return { ...l, paint: { 'background-color': T.land } };
    case 'fill': {
      const color = /water/.test(id)
        ? T.water
        : /park|wood|forest|grass|landcover|wetland|landuse/.test(id)
          ? T.park
          : T.land;
      return { ...l, paint: { 'fill-color': color } };
    }
    case 'line': {
      const width = l.paint?.['line-width'] ?? 1;
      if (/waterway|river|stream/.test(id))
        return { ...l, paint: { 'line-color': T.river, 'line-width': width } };
      if (/boundary|admin/.test(id))
        return { ...l, paint: { 'line-color': T.border, 'line-width': 1, 'line-dasharray': [3, 3] } };
      const major = /motorway|trunk|primary/.test(id);
      return { ...l, paint: { 'line-color': major ? T.road2 : T.road, 'line-width': width } };
    }
    case 'symbol': {
      if (!l.layout?.['text-field']) return null;
      const layout = {
        ...l.layout,
        'text-font': ['Noto Sans Regular'],
        'text-transform': 'uppercase' as const,
      };
      delete layout['icon-image'];
      return {
        ...l,
        layout: { ...layout, 'text-letter-spacing': 0.12 },
        paint: { 'text-color': T.label, 'text-halo-color': T.bg, 'text-halo-width': 1.4 },
      };
    }
    default:
      return null;
  }
}

/** The OpenFreeMap style recoloured as a green tactical map, with hillshade from the terrain tiles under the labels. */
export function toTactical(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map(restyle).filter((l): l is LayerSpecification => l !== null);
  const firstLabel = layers.findIndex((l) => l.type === 'symbol');
  const hill: LayerSpecification = {
    id: 'tactical-hillshade',
    type: 'hillshade',
    source: DEM_SOURCE,
    paint: {
      'hillshade-shadow-color': '#000000',
      'hillshade-highlight-color': '#1d6a32',
      'hillshade-accent-color': '#0c2a14',
      'hillshade-exaggeration': 0.75,
    },
  };
  layers.splice(firstLabel < 0 ? layers.length : firstLabel, 0, hill);
  return {
    ...style,
    sources: {
      ...style.sources,
      [DEM_SOURCE]: {
        type: 'raster-dem',
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 13,
        tiles: [TERRARIUM_URL],
      },
    },
    layers,
  };
}

export async function loadTacticalStyle(): Promise<StyleSpecification> {
  const r = await fetch(BASE_STYLE_URL);
  if (!r.ok) throw new Error(`Map style ${r.status}`);
  return toTactical((await r.json()) as StyleSpecification);
}
