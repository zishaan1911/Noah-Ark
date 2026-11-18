import { useEffect, useRef, useState } from 'react';
import type { DroneApi } from './useDrone';
import { MANUAL_KEYS, packet, smooth, stickFromKeys, ZERO_STICK } from '../lib/manual';
import type { Stick } from '../lib/types';
import { validateManual } from '../lib/validate';

interface Options {
  droneId: string;
  drone: DroneApi;
  enabled: boolean;
  issuedBy: string;
}

const TICK_MS = 100;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
}

/** Keyboard stick stream at 10 Hz on ark/<id>/manual while enabled. */
export function useManualControl({ droneId, drone, enabled, issuedBy }: Options): {
  stick: Stick;
  active: boolean;
} {
  const [stick, setStick] = useState<Stick>(ZERO_STICK);
  // publish identity can change each render; keep the latest without restarting the stream.
  const publishRef = useRef(drone.publish);
  useEffect(() => {
    publishRef.current = drone.publish;
  });

  useEffect(() => {
    if (!enabled) return;
    const pressed = new Set<string>();
    let current: Stick = ZERO_STICK;
    let seq = 0;
    const topic = `ark/${droneId}/manual`;

    const send = (s: Stick) => {
      const p = packet(droneId, seq++, s, issuedBy);
      const v = validateManual(p);
      if (!v.ok) return console.warn('Dropped invalid manual packet', v.errors);
      publishRef.current(topic, p, 0).catch(() => undefined); // QoS 0 stream: a lost packet is fine
    };

    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !MANUAL_KEYS.has(e.code)) return;
      e.preventDefault();
      pressed.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !MANUAL_KEYS.has(e.code)) return;
      e.preventDefault();
      pressed.delete(e.code);
    };
    const clear = () => pressed.clear();
    const onVisibility = () => {
      if (document.hidden) clear();
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', onVisibility);

    const timer = setInterval(() => {
      current = smooth(current, stickFromKeys(pressed), TICK_MS / 1000);
      send(current);
      setStick(current);
    }, TICK_MS);

    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', onVisibility);
      send(ZERO_STICK); // the drone holds after 1 s anyway
      setStick(ZERO_STICK);
    };
  }, [enabled, droneId, issuedBy]);

  return { stick, active: enabled };
}
