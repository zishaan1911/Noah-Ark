import { describe, expect, it } from 'vitest';
import type { SosRequest } from '@contracts';
import { applySos, openSos, type SosFeed } from './sosFeed';

const sos = (
  id: string,
  createdAt: string,
  status: SosRequest['status'] = 'triaged',
  withTriage = true,
): SosRequest => ({
  id,
  createdAt,
  status,
  report: { channel: 'app', location: { lat: 6.42, lon: 116.34 } },
  ...(withTriage ? { triage: { urgency: 4, needs: ['water'], summary: 'Flooded village.' } } : {}),
});

describe('applySos', () => {
  it('replaces an earlier copy of the same id without touching the old feed', () => {
    const first = applySos({}, sos('sos_a', '2026-11-23T06:00:00Z'));
    const second = applySos(first, sos('sos_a', '2026-11-23T06:00:00Z', 'assigned'));
    expect(Object.keys(second)).toEqual(['sos_a']);
    expect(second['sos_a'].status).toBe('assigned');
    expect(first['sos_a'].status).toBe('triaged');
  });
});

describe('openSos', () => {
  it('keeps only triaged SOS with triage, newest first', () => {
    let feed: SosFeed = {};
    feed = applySos(feed, sos('sos_old', '2026-11-23T06:00:00Z'));
    feed = applySos(feed, sos('sos_new', '2026-11-23T07:00:00Z'));
    feed = applySos(feed, sos('sos_untriaged', '2026-11-23T08:00:00Z', 'triaged', false));
    feed = applySos(feed, sos('sos_fresh', '2026-11-23T09:00:00Z', 'new', false));
    expect(openSos(feed).map((s) => s.id)).toEqual(['sos_new', 'sos_old']);
  });

  it('drops an SOS once it is assigned', () => {
    let feed: SosFeed = applySos({}, sos('sos_a', '2026-11-23T06:00:00Z'));
    expect(openSos(feed)).toHaveLength(1);
    feed = applySos(feed, sos('sos_a', '2026-11-23T06:00:00Z', 'assigned'));
    expect(openSos(feed)).toEqual([]);
  });
});
