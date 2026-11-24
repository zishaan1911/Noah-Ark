import { describe, expect, it } from 'vitest';
import { missionFromText } from './partyrock';

// Shaped like widget 13 of partyrock/noah-ark-dispatch.md: a pending relief mission in a json code block.
const mission = {
  id: 'msn_01JDZ7Q4X9K2M5N8P3R6T0V1WY',
  mode: 'relief',
  droneId: 'ARK-117',
  createdAt: '2026-11-23T06:30:00Z',
  status: 'pending_approval',
  origin: { lat: 6.351, lon: 116.4305 },
  destination: { lat: 6.42, lon: 116.34 },
  landingType: 'water',
  payload: [
    { item: 'Water purification tablets', qty: 2, weightKg: 0.2 },
    { item: 'First aid kit', qty: 1, weightKg: 0.9 },
  ],
  payloadKg: 1.1,
  distanceKm: 12.6,
  etaMinutes: 14,
  aiRationale: 'Nearest available drone at Kota Belud; flood site needs a water landing.',
};

describe('missionFromText', () => {
  it('reads a mission from a json code block', () => {
    const text = 'Here is the mission:\n```json\n' + JSON.stringify(mission, null, 2) + '\n```';
    expect(missionFromText(text)).toEqual(mission);
  });

  it('ignores text without a valid mission', () => {
    expect(missionFromText('hello')).toBeNull();
    expect(missionFromText('{ not json }')).toBeNull();
    expect(missionFromText(JSON.stringify({ ...mission, payloadKg: 1.9 }))).toBeNull(); // sum mismatch
    expect(missionFromText(JSON.stringify({ ...mission, droneId: 'X' }))).toBeNull();
  });
});
