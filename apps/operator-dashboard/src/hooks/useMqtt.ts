import { useCallback, useEffect, useRef, useState } from 'react';
import mqtt, { type MqttClient } from 'mqtt'; // the browser ESM bundle has only a default export
import { MQTT_KEY } from '../lib/config';

export type MqttState = 'connecting' | 'connected' | 'reconnecting';

export interface MqttApi {
  state: MqttState;
  /** Publish a JSON payload. Rejects if the broker is not connected. */
  publish: (topic: string, payload: unknown, qos?: 0 | 1) => Promise<void>;
}

const decoder = new TextDecoder();

/** One mqtt.js client over WebSocket: connects, subscribes to `topics` (QoS 1) on every (re)connect. */
export function useMqtt(
  url: string,
  topics: readonly string[],
  onMessage: (topic: string, payload: unknown) => void,
): MqttApi {
  const [state, setState] = useState<MqttState>('connecting');
  const clientRef = useRef<MqttClient | null>(null);
  const onMessageRef = useRef(onMessage);
  const topicsKey = topics.join('|');

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const client = mqtt.connect(url, {
      clientId: `ark-command-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 2000,
      connectTimeout: 10_000,
      clean: true,
      ...(MQTT_KEY && { username: 'operator', password: MQTT_KEY }),
    });
    clientRef.current = client;
    client.on('connect', () => {
      setState('connected');
      client.subscribe(topicsKey.split('|'), { qos: 1 });
    });
    client.on('reconnect', () => setState('reconnecting'));
    client.on('close', () => setState((s) => (s === 'connecting' ? s : 'reconnecting')));
    client.on('error', (err) => console.warn('MQTT error', err.message));
    client.on('message', (topic, buf) => {
      try {
        onMessageRef.current(topic, JSON.parse(decoder.decode(buf)));
      } catch (err) {
        console.warn(`Dropped a non-JSON message on ${topic}`, err);
      }
    });
    return () => {
      clientRef.current = null;
      client.end(true);
    };
  }, [url, topicsKey]);

  const publish = useCallback(async (topic: string, payload: unknown, qos: 0 | 1 = 1) => {
    const client = clientRef.current;
    if (!client || !client.connected) throw new Error('Not connected to the broker');
    await client.publishAsync(topic, JSON.stringify(payload), { qos });
  }, []);

  return { state, publish };
}
