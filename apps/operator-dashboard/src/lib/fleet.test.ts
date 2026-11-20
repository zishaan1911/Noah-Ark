import { describe, expect, it } from 'vitest';
import type { Drone, Mission, Telemetry } from '@contracts';
import {
  MAX_MISSIONS,
  applyDrone,
  healthText,
  applyMission,
  applyTelemetry,
  emptyFleet,
  isDrone,
  hubsOf,
  kpis,
  parseFleetStats,
} from './fleet';

const tel = (droneId: string, lat = 5.7, lon = 116.1): Telemetry => ({
  droneId,
  ts: '2026-01-01T00:00:00Z',
  position: { lat, lon },
  headingDeg: 90,
  groundSpeedMs: 12,
  armed: true,
  flightMode: 'AUTO',
  batteryPct: 80,
});

const drone = (id: string, lat: number, lon: number, status: Drone['status'] = 'available'): Drone => ({
  id,
  model: 'Ark-1',
  status,
  home: { lat, lon },
  maxPayloadKg: 2,
});

const mission = (id: string, status: Mission['status'], extra: Partial<Mission> = {}): Mission => ({
  id,
  mode: 'gdex',
  droneId: 'ARK-101',
  createdAt: '2026-01-01T00:00:00Z',
  status,
  origin: { lat: 5.7, lon: 116.1 },
  destination: { lat: 5.8, lon: 116.2 },
  landingType: 'drop',
  payload: [{ item: 'parcel', qty: 1, weightKg: 1 }],
  payloadKg: 1,
  ...extra,
});

describe('fleet state', () => {
  it('applyTelemetry on an unknown drone creates it with a position', () => {
    const s0 = emptyFleet();
    const s1 = applyTelemetry(s0, tel('ARK-101'));
    expect(s0.drones['ARK-101']).toBeUndefined();
    expect(s1.drones['ARK-101'].pos).toMatchObject({
      lat: 5.7,
      lon: 116.1,
      headingDeg: 90,
      groundSpeedMs: 12,
    });
    expect(s1.drones['ARK-101'].batteryPct).toBe(80);
  });

  it('applyDrone merges status without losing pos', () => {
    const s1 = applyTelemetry(emptyFleet(), tel('ARK-101'));
    const s2 = applyDrone(s1, drone('ARK-101', 5.6, 116.0, 'charging'));
    expect(s2.drones['ARK-101'].status).toBe('charging');
    expect(s2.drones['ARK-101'].pos?.lat).toBe(5.7);
    expect(s2.drones['ARK-101'].home).toEqual({ lat: 5.6, lon: 116.0 });
    expect(s2.drones['ARK-101'].batteryPct).toBe(80);
  });

  it('applyMission keeps at most 200 and drops delivered first', () => {
    let s = emptyFleet();
    for (let i = 0; i < MAX_MISSIONS; i++) {
      const status = i < 5 ? 'delivered' : 'in_flight';
      s = applyMission(
        s,
        mission(`m${i}`, status, { createdAt: new Date(1_000_000 + i * 1000).toISOString() }),
      );
    }
    expect(Object.keys(s.missions)).toHaveLength(MAX_MISSIONS);
    s = applyMission(s, mission('new', 'dispatched', { createdAt: '2026-06-01T00:00:00Z' }));
    expect(Object.keys(s.missions)).toHaveLength(MAX_MISSIONS);
    expect(s.missions['m0']).toBeUndefined();
    expect(s.missions['m1']).toBeDefined();
    expect(s.missions['new']).toBeDefined();
  });
});

describe('hubsOf', () => {
  it('dedupes homes to 4 dp and counts drones', () => {
    let s = emptyFleet();
    s = applyDrone(s, drone('ARK-101', 5.98041, 116.07351));
    s = applyDrone(s, drone('ARK-102', 5.98042, 116.07349));
    s = applyDrone(s, drone('ARK-103', 5.7346, 115.9302));
    const hubs = hubsOf(s);
    expect(hubs).toHaveLength(2);
    expect(hubs.find((h) => h.lat === 5.9804)?.drones).toBe(2);
    expect(hubs.find((h) => h.lat === 5.7346)?.drones).toBe(1);
  });
});

describe('kpis', () => {
  it('counts flying, queued, delivered; on time comes from the sim', () => {
    let s = emptyFleet();
    s = applyDrone(s, drone('ARK-101', 5.7, 116.1, 'in_flight'));
    s = applyDrone(s, drone('ARK-102', 5.7, 116.1, 'available'));
    s = applyMission(s, mission('a', 'dispatched', { mode: 'relief' }));
    s = applyMission(s, mission('b', 'in_flight'));
    s = applyMission(s, mission('c', 'delivered'));
    s = applyMission(s, mission('d', 'delivered'));
    const k = kpis(s, null);
    expect(k.flying).toBe(1);
    expect(k.queued).toBe(1);
    expect(k.delivered).toBe(2);
    expect(k.avgDeliveryMin).toBeNull();
    expect(k.reliefShare).toBe(0.5);
    expect(k.onTimePct).toBeNull();
    const stats = {
      flying: 5,
      queued: 7,
      deliveredTotal: 40,
      avgDeliveryMin: 12.4,
      onTimePct: 92.6,
      windMs: 3,
      windFromDeg: 90,
      speedup: 4,
    };
    const k2 = kpis(s, stats);
    expect(k2.queued).toBe(7);
    expect(k2.delivered).toBe(40);
    expect(k2.onTimePct).toBe(93);
  });
});

describe('parseFleetStats', () => {
  const ok = {
    flying: 3,
    queued: 2,
    deliveredTotal: 10,
    avgDeliveryMin: 7.5,
    onTimePct: 90,
    windMs: 3.1,
    windFromDeg: 225,
    speedup: 4,
  };

  it('accepts a complete object', () => {
    expect(parseFleetStats(ok)).toEqual(ok);
  });

  it('rejects non-finite numbers and non-objects', () => {
    expect(parseFleetStats({ ...ok, windMs: NaN })).toBeNull();
    expect(parseFleetStats({ ...ok, speedup: Infinity })).toBeNull();
    expect(parseFleetStats({ ...ok, flying: '3' })).toBeNull();
    expect(parseFleetStats({ ...ok, onTimePct: undefined })).toBeNull();
    expect(parseFleetStats(null)).toBeNull();
    expect(parseFleetStats('stats')).toBeNull();
  });
});

describe('health', () => {
  const checkedAt = '2026-11-20T09:41:05Z';

  it('counts grounded and to-inspect drones', () => {
    let s = emptyFleet();
    s = applyDrone(s, {
      ...drone('ARK-101', 5.7, 116.1, 'maintenance'),
      health: { state: 'ground', fault: 'bearing_wear', checkedAt },
    });
    s = applyDrone(s, {
      ...drone('ARK-102', 5.7, 116.1, 'in_flight'),
      health: { state: 'watch', fault: 'weak_cell', checkedAt },
    });
    s = applyDrone(s, { ...drone('ARK-103', 5.7, 116.1), health: { state: 'ok', fault: 'none', checkedAt } });
    const k = kpis(s, null);
    expect(k.maintenance).toBe(1);
    expect(k.watch).toBe(1);
  });

  it('says what is wrong and how long is left', () => {
    expect(healthText({ state: 'ground', fault: 'bearing_wear', rulH: 6.2, checkedAt })).toBe(
      'Bearing wear · ~6 h left',
    );
    expect(healthText({ state: 'watch', fault: 'unknown', checkedAt })).toBe('Unusual flight');
    expect(healthText({ state: 'ok', fault: 'none', checkedAt })).toBeNull();
    expect(healthText(undefined)).toBeNull();
  });

  it('drops a drone update with a malformed verdict', () => {
    expect(
      isDrone({ ...drone('ARK-101', 5.7, 116.1), health: { state: 'broken', fault: 'x', checkedAt } }),
    ).toBe(false);
    expect(
      isDrone({ ...drone('ARK-101', 5.7, 116.1), health: { state: 'watch', fault: 'seal_leak', checkedAt } }),
    ).toBe(true);
  });
});
