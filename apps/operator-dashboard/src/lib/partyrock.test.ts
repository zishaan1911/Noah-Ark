import { describe, expect, it } from 'vitest';
import { missionFromText, sosFromText } from './partyrock';

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
    expect(missionFromText(JSON.stringify({ ...mission, droneId: 'X' }))).toBeNull();
  });

  it('repairs a payloadKg that does not match the lines', () => {
    expect(missionFromText(JSON.stringify({ ...mission, payloadKg: 1.9 }))?.payloadKg).toBe(1.1);
  });

  it('repairs a bad id and createdAt', () => {
    const m = missionFromText(JSON.stringify({ ...mission, id: 'msn_123', createdAt: 'yesterday' }));
    expect(m?.id).toMatch(/^msn_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(Number.isNaN(Date.parse(m?.createdAt ?? ''))).toBe(false);
  });
});

// Shaped like the SOS app output: the sos-request schema with a triage block.
const sos = {
  id: 'sos_01JDZ7Q4X9K2M5N8P3R6T0V1WY',
  createdAt: '2026-11-23T06:30:00Z',
  status: 'triaged',
  report: { channel: 'app', location: { lat: 6.42, lon: 116.34 } },
  triage: { urgency: 5, needs: ['water'], summary: 'Flooded village.', waterLanding: true },
};

describe('sosFromText', () => {
  it('reads an SOS request from a json code block', () => {
    const text = 'Copy this:\n```json\n' + JSON.stringify(sos, null, 2) + '\n```';
    expect(sosFromText(text)).toEqual(sos);
  });

  it('repairs a bad id', () => {
    expect(sosFromText(JSON.stringify({ ...sos, id: 'sos_1' }))?.id).toMatch(/^sos_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('ignores an SOS without triage and garbage', () => {
    const untriaged: Partial<typeof sos> = { ...sos };
    delete untriaged.triage;
    expect(sosFromText(JSON.stringify(untriaged))).toBeNull();
    expect(sosFromText('hello')).toBeNull();
    expect(sosFromText('{ not json }')).toBeNull();
  });
});
