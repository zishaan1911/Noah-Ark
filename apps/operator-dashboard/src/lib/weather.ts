import type { FlyCall } from '@contracts';

// shortcut: limits duplicated from backend/functions/dispatch-agent/weather.py, move behind an API with the weather service
const NO_GO = { windMs: 12, gustMs: 15, rainMmH: 30 };
const CAUTION = { windMs: 8, gustMs: 11, rainMmH: 10 };

export interface PointWeather {
  windMs: number;
  gustMs: number;
  windFromDeg: number;
  rainMmH: number;
  weatherCode: number;
}

/** go, caution or no_go for one place, with the first reason that decided it. */
export function flyCall(w: { windMs: number; gustMs: number; rainMmH: number; weatherCode?: number }): {
  call: FlyCall;
  reason: string;
} {
  if (w.weatherCode !== undefined && w.weatherCode >= 95 && w.weatherCode <= 99)
    return { call: 'no_go', reason: 'Thunderstorm at the destination' };
  if (w.windMs > NO_GO.windMs)
    return { call: 'no_go', reason: `Wind ${w.windMs.toFixed(1)} m/s is above 12 m/s` };
  if (w.gustMs > NO_GO.gustMs)
    return { call: 'no_go', reason: `Gusts ${w.gustMs.toFixed(1)} m/s are above 15 m/s` };
  if (w.rainMmH > NO_GO.rainMmH)
    return { call: 'no_go', reason: `Rain ${w.rainMmH.toFixed(1)} mm/h is above 30 mm/h` };
  if (w.windMs > CAUTION.windMs)
    return { call: 'caution', reason: `Wind ${w.windMs.toFixed(1)} m/s is above 8 m/s` };
  if (w.gustMs > CAUTION.gustMs)
    return { call: 'caution', reason: `Gusts ${w.gustMs.toFixed(1)} m/s are above 11 m/s` };
  if (w.rainMmH > CAUTION.rainMmH)
    return { call: 'caution', reason: `Rain ${w.rainMmH.toFixed(1)} mm/h is above 10 mm/h` };
  return { call: 'go', reason: 'Calm enough to fly' };
}

/** Cruise minutes at ground speed. Wind FROM d blows toward d + 180, so a wind from the track direction is a headwind. */
export function windAdjustedMinutes(
  distanceKm: number,
  trackDeg: number,
  windMs: number,
  windFromDeg: number,
  airspeedMs = 17,
): number {
  const along = windMs * Math.cos(((windFromDeg + 180 - trackDeg) * Math.PI) / 180);
  const ground = Math.max(3, airspeedMs + along);
  return (distanceKm * 1000) / ground / 60;
}

/** Current weather at a point from Open-Meteo. Throws on any failure. */
export async function fetchPointWeather(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<PointWeather> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code&wind_speed_unit=ms';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  const body = (await res.json()) as { current?: Record<string, unknown> };
  const c = body.current;
  const num = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Open-Meteo sent an unexpected reply');
    return v;
  };
  if (!c) throw new Error('Open-Meteo sent an unexpected reply');
  return {
    windMs: num(c.wind_speed_10m),
    gustMs: num(c.wind_gusts_10m),
    windFromDeg: num(c.wind_direction_10m),
    rainMmH: num(c.precipitation),
    weatherCode: num(c.weather_code),
  };
}
