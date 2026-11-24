import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mission, SosRequest, Telemetry, Weather } from '@contracts';
import { MQTT_URL } from '../lib/config';
import {
  applyDrone,
  applyMission,
  applyTelemetry,
  emptyFleet,
  isDrone,
  parseFleetStats,
  type FleetState,
  type FleetStats,
} from '../lib/fleet';
import { validateMission, validateSosRequest, validateTelemetry, validateWeather } from '../lib/validate';
import { applySos, type SosFeed } from '../lib/sosFeed';
import { useMqtt, type MqttApi, type MqttState } from './useMqtt';

const TOPICS = ['ark/+/telemetry', 'fleet/live', 'fleet/stats', 'fleet/weather', 'sos/+'] as const;
const FLUSH_MS = 500;
const TELEMETRY_TOPIC = /^ark\/[^/]+\/telemetry$/;
const SOS_TOPIC = /^sos\/[^/]+$/;

export interface FleetApi {
  conn: MqttState;
  state: FleetState;
  stats: FleetStats | null;
  weather: Weather | null;
  sos: SosFeed;
  publish: MqttApi['publish'];
}

/** The whole fleet over MQTT. Messages pile up in a ref and reach React at most every 500 ms. */
export function useFleet(): FleetApi {
  const [state, setState] = useState<FleetState>(emptyFleet);
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [sos, setSos] = useState<SosFeed>({});
  const latest = useRef<{
    state: FleetState;
    stats: FleetStats | null;
    weather: Weather | null;
    sos: SosFeed;
    dirty: boolean;
  }>({
    state,
    stats: null,
    weather: null,
    sos: {},
    dirty: false,
  });

  const onMessage = useCallback((topic: string, raw: unknown) => {
    const cur = latest.current;
    if (TELEMETRY_TOPIC.test(topic)) {
      const v = validateTelemetry(raw);
      if (!v.ok) return console.warn('Dropped invalid telemetry', v.errors);
      cur.state = applyTelemetry(cur.state, raw as Telemetry);
    } else if (SOS_TOPIC.test(topic)) {
      const v = validateSosRequest(raw);
      if (!v.ok) return console.warn('Dropped invalid SOS', v.errors);
      cur.sos = applySos(cur.sos, raw as SosRequest);
    } else if (topic === 'fleet/live') {
      const msg = raw as { kind?: unknown; data?: unknown } | null;
      if (msg?.kind === 'drone') {
        if (!isDrone(msg.data)) return console.warn('Dropped invalid drone update', msg.data);
        cur.state = applyDrone(cur.state, msg.data);
      } else if (msg?.kind === 'mission') {
        const v = validateMission(msg.data);
        if (!v.ok) return console.warn('Dropped invalid mission update', v.errors);
        cur.state = applyMission(cur.state, msg.data as Mission);
      } else {
        return; // other kinds are not part of the fleet feed
      }
    } else if (topic === 'fleet/stats') {
      const s = parseFleetStats(raw);
      if (!s) return console.warn('Dropped invalid fleet stats', raw);
      cur.stats = s;
    } else if (topic === 'fleet/weather') {
      const v = validateWeather(raw);
      if (!v.ok) return console.warn('Dropped invalid weather', v.errors);
      cur.weather = raw as Weather;
    } else {
      return;
    }
    cur.dirty = true;
  }, []);

  const { state: conn, publish } = useMqtt(MQTT_URL, TOPICS, onMessage);

  useEffect(() => {
    const id = setInterval(() => {
      const cur = latest.current;
      if (!cur.dirty) return;
      cur.dirty = false;
      setState(cur.state);
      setStats(cur.stats);
      setWeather(cur.weather);
      setSos(cur.sos);
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  return { conn, state, stats, weather, sos, publish };
}
