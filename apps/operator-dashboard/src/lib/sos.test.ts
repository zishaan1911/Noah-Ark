import type { SosRequest } from '@contracts';
import { describe, expect, it } from 'vitest';
import { nearestHub } from './hubs';
import { sosToMission, sosToOrder } from './sos';
import { validateMission, validateMissionRequest } from './validate';

const sos: SosRequest = {
  id: 'sos_01JDZ7Q4X9K2M5N8P3R6T0V1WY',
  createdAt: '2026-11-23T06:30:00Z',
  status: 'triaged',
  report: {
    channel: 'app',
    location: { lat: 6.42, lon: 116.34 },
    language: 'ms',
    rawMessage: 'Tolong, banjir di Kampung Tempasuk. Ubat insulin habis, ada bayi.',
  },
  triage: {
    urgency: 5,
    needs: ['medicine', 'water', 'baby_supplies'],
    peopleCount: 5,
    medicalConditions: ['diabetes, insulin finished'],
    summary: 'Flooded village, diabetic without insulin, infant present.',
    language: 'ms',
    waterLanding: true,
  },
};

describe('sosToMission', () => {
  it('builds a valid pending relief mission', () => {
    const m = sosToMission(sos, 'ARK-117');
    expect(validateMission(m).errors).toEqual([]);
    expect(m.id).toBe('msn_01JDZ7Q4X9K2M5N8P3R6T0V1WY');
    expect(m.status).toBe('pending_approval');
    expect(m.sosRequestIds).toEqual([sos.id]);
  });

  it('starts at the nearest hub', () => {
    const m = sosToMission(sos, 'ARK-117');
    expect(nearestHub(m.destination).name).toBe('Kota Belud');
    expect(m.origin).toEqual({ lat: 6.351, lon: 116.4305 });
  });

  it('lands on water only when triage says so', () => {
    expect(sosToMission(sos, 'ARK-117').landingType).toBe('water');
    const dry: SosRequest = { ...sos, triage: { urgency: 3, needs: ['food'], summary: 'x' } };
    expect(sosToMission(dry, 'ARK-117').landingType).toBe('ground');
  });
});

describe('sosToOrder', () => {
  it('passes the mission request schema', () => {
    const order = sosToOrder(sos);
    expect(validateMissionRequest(order).errors).toEqual([]);
    expect(order.urgency).toBe(5);
    expect(order.landingType).toBe('water');
  });
});
