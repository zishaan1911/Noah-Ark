import { useCallback, useMemo, useRef, useState } from 'react';
import type { DroneEvent, Telemetry } from '@contracts';
import { parseSimStatus, type SimStatus } from '../lib/types';
import { validateEvent, validateTelemetry } from '../lib/validate';
import { useMqtt, type MqttState } from './useMqtt';

const MAX_EVENTS = 200;
const MAX_TRACK = 4000;

/** What the drone has told us so far. Read inside `waitFor` checks; events are newest first. */
export interface DroneSnapshot {
  telemetry: Telemetry | null;
  sim: SimStatus | null;
  events: DroneEvent[];
}

export interface DroneApi {
  conn: MqttState;
  telemetry: Telemetry | null;
  events: DroneEvent[];
  sim: SimStatus | null;
  /** Flown path as [lon, lat], from armed telemetry. */
  track: [number, number][];
  clearTrack: () => void;
  /** The latest values right now, for use in event handlers (not during render). */
  snapshot: () => DroneSnapshot;
  publish: (topic: string, payload: unknown, qos?: 0 | 1) => Promise<void>;
  /** Resolves with the first non-undefined value `check` returns; `check` may throw to fail the wait. */
  waitFor: <T>(check: (s: DroneSnapshot) => T | undefined, timeoutMs: number) => Promise<T>;
}

/** The latest validated telemetry, events and sim status for one drone. */
export function useDrone(droneId: string, mqttUrl: string): DroneApi {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [events, setEvents] = useState<DroneEvent[]>([]);
  const [sim, setSim] = useState<SimStatus | null>(null);
  const [track, setTrack] = useState<[number, number][]>([]);
  const latest = useRef<DroneSnapshot>({ telemetry: null, sim: null, events: [] });
  const waiters = useRef(new Set<() => void>());

  const topics = useMemo(
    () => [`ark/${droneId}/telemetry`, `ark/${droneId}/events`, `sim/${droneId}/status`],
    [droneId],
  );

  const onMessage = useCallback(
    (topic: string, raw: unknown) => {
      if (topic === `ark/${droneId}/telemetry`) {
        const v = validateTelemetry(raw);
        if (!v.ok) return console.warn('Dropped invalid telemetry', v.errors);
        const t = raw as Telemetry;
        if (t.droneId !== droneId) return;
        latest.current.telemetry = t;
        setTelemetry(t);
        if (t.armed) {
          setTrack((tr) => [...tr.slice(-(MAX_TRACK - 1)), [t.position.lon, t.position.lat]]);
        }
      } else if (topic === `ark/${droneId}/events`) {
        const v = validateEvent(raw);
        if (!v.ok) return console.warn('Dropped invalid event', v.errors);
        const e = raw as DroneEvent;
        if (e.droneId !== droneId || latest.current.events.some((x) => x.id === e.id)) return;
        latest.current.events = [e, ...latest.current.events].slice(0, MAX_EVENTS);
        setEvents(latest.current.events);
      } else if (topic === `sim/${droneId}/status`) {
        const s = parseSimStatus(raw);
        if (!s) return console.warn('Dropped invalid sim status', raw);
        latest.current.sim = s;
        setSim(s);
      }
      for (const w of [...waiters.current]) w();
    },
    [droneId],
  );

  const { state, publish } = useMqtt(mqttUrl, topics, onMessage);

  const waitFor = useCallback(
    <T>(check: (s: DroneSnapshot) => T | undefined, timeoutMs: number) =>
      new Promise<T>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          waiters.current.delete(attempt);
        };
        const attempt = () => {
          try {
            const v = check(latest.current);
            if (v === undefined) return;
            done();
            resolve(v);
          } catch (err) {
            done();
            reject(err);
          }
        };
        const timer = setTimeout(() => {
          done();
          reject(new Error('Timed out waiting for the drone'));
        }, timeoutMs);
        waiters.current.add(attempt);
        attempt();
      }),
    [],
  );

  const clearTrack = useCallback(() => setTrack([]), []);
  const snapshot = useCallback(() => latest.current, []);

  return { conn: state, telemetry, events, sim, track, clearTrack, snapshot, publish, waitFor };
}
