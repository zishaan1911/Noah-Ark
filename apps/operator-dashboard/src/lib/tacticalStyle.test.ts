import type { StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { DEM_SOURCE } from './mapStyle';
import { T, toTactical } from './tacticalStyle';

const style: StyleSpecification = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://example.invalid/tiles.json' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#00f' },
    },
    { id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building' },
    { id: 'road_primary', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    {
      id: 'poi_r1',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'poi',
      layout: { 'text-field': 'x' },
    },
    {
      id: 'place_town',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      layout: { 'text-field': '{name}', 'icon-image': 'dot' },
    },
  ],
};

describe('toTactical', () => {
  const out = toTactical(style);
  const byId = Object.fromEntries(out.layers.map((l) => [l.id, l]));

  it('drops buildings and POIs and recolours the rest green', () => {
    expect(byId['building-3d']).toBeUndefined();
    expect(byId['poi_r1']).toBeUndefined();
    expect(byId['water']).toMatchObject({ paint: { 'fill-color': T.water } });
    expect(byId['road_primary']).toMatchObject({ paint: { 'line-color': T.road2 } });
  });

  it('puts the hillshade under the labels and adds the terrain source', () => {
    const ids = out.layers.map((l) => l.id);
    expect(ids.indexOf('tactical-hillshade')).toBe(ids.indexOf('place_town') - 1);
    expect(out.sources[DEM_SOURCE]).toMatchObject({ type: 'raster-dem', encoding: 'terrarium' });
  });

  it('labels are uppercase text with no icon', () => {
    const label = byId['place_town'];
    expect(label.type).toBe('symbol');
    if (label.type !== 'symbol') return;
    expect(label.layout?.['text-transform']).toBe('uppercase');
    expect(label.layout && 'icon-image' in label.layout).toBe(false);
  });
});
