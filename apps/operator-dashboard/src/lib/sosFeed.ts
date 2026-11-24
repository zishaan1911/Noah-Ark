import type { SosRequest } from '@contracts';

/** Every SOS seen on `sos/<sosId>`, keyed by id. Re-publishes replace the earlier copy. */
export type SosFeed = Record<string, SosRequest>;

/** Returns a new feed with `sos` in place of any earlier copy of the same id. */
export function applySos(feed: SosFeed, sos: SosRequest): SosFeed {
  return { ...feed, [sos.id]: sos };
}

const createdMs = (s: SosRequest) => {
  const ms = Date.parse(s.createdAt);
  return Number.isFinite(ms) ? ms : 0;
};

/** Triaged SOS still waiting for a drone, newest first. Once assigned, it leaves this list. */
export function openSos(feed: SosFeed): SosRequest[] {
  return Object.values(feed)
    .filter((s) => s.status === 'triaged' && s.triage !== undefined)
    .sort((a, b) => createdMs(b) - createdMs(a));
}
