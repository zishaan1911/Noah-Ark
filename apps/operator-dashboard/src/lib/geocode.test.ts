import { describe, expect, it } from 'vitest';
import { parseNominatim } from './geocode';

const SAMPLE = [
  {
    place_id: 1,
    lat: '5.7346',
    lon: '115.9302',
    display_name: 'Papar, Papar District, West Coast Division, Sabah, Malaysia',
  },
  {
    place_id: 2,
    lat: '5.9804',
    lon: '116.0735',
    display_name: 'Kota Kinabalu, West Coast Division, Sabah, Malaysia',
  },
];

describe('parseNominatim', () => {
  it('turns hits into short labels and points', () => {
    expect(parseNominatim(SAMPLE)).toEqual([
      { label: 'Papar, Papar District, West Coast Division', point: { lat: 5.7346, lon: 115.9302 } },
      { label: 'Kota Kinabalu, West Coast Division, Sabah', point: { lat: 5.9804, lon: 116.0735 } },
    ]);
  });

  it('gives [] for an empty or malformed result', () => {
    expect(parseNominatim([])).toEqual([]);
    expect(parseNominatim({ error: 'x' })).toEqual([]);
  });
});
