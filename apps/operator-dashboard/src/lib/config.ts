// `||`: CI passes an empty string when the MQTT_URL variable is unset.
export const MQTT_URL = import.meta.env.VITE_MQTT_URL || 'ws://localhost:9101';

/**
 * Operator password for the public broker. Open the dashboard once with `?key=<password>`: it is kept in
 * this browser and removed from the address bar. Without it the public broker lets the dashboard watch only.
 */
export const MQTT_KEY = readKey();

function readKey(): string | undefined {
  try {
    const url = new URL(window.location.href);
    const key = url.searchParams.get('key');
    if (key) {
      localStorage.setItem('ark-mqtt-key', key);
      url.searchParams.delete('key');
      window.history.replaceState(null, '', url);
      return key;
    }
    return localStorage.getItem('ark-mqtt-key') ?? undefined;
  } catch {
    return undefined; // no window (tests) or storage blocked
  }
}
export const DRONE_ID = import.meta.env.VITE_DRONE_ID ?? 'ARK-006';
export const OPERATOR = 'Zishaan Ahmed';
export const OPERATOR_INITIALS = 'ZA';
/** Papar, Sabah: where the map opens. */
export const PAPAR = { lat: 5.7346, lon: 115.9302 };
