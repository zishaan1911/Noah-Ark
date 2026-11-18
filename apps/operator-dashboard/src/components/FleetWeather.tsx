import { useEffect, useState } from 'react';
import type { FlyCall, Weather } from '@contracts';
import type { FleetStats } from '../lib/fleet';

interface Props {
  weather: Weather | null;
  stats: FleetStats | null;
  radar: boolean;
  onRadar: (on: boolean) => void;
}

export const CALL: Record<FlyCall, { label: string; cls: string }> = {
  go: { label: 'Go', cls: 'bg-green-tint text-green-ink' },
  caution: { label: 'Caution', cls: 'bg-amber-tint text-amber-ink' },
  no_go: { label: 'On hold', cls: 'bg-red-tint text-red-ink' },
};

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

function ago(updatedAt: string, now: number): string {
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return '';
  const min = Math.max(0, Math.round((now - ms) / 60000));
  return min < 1 ? 'just now' : `${min} min ago`;
}

const sourceName = (s: string) => (s.startsWith('open-meteo') ? 'Open-Meteo' : s);

/** Flying weather: a call per hub, the storm cells, orders held back, and the radar toggle. */
export function FleetWeather({ weather, stats, radar, onRadar }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const held = stats?.held ?? 0;
  return (
    <section aria-label="Flying weather" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold">Flying weather</h2>
        {weather && (
          <span className="text-xs text-sub">
            {sourceName(weather.source)} · {ago(weather.updatedAt, now)}
          </span>
        )}
      </div>

      {!weather ? (
        <p role="status" className="m-0 py-1 text-sm text-sub">
          Waiting for weather…
        </p>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {weather.hubs.map((h) => (
              <li key={h.name} className="flex flex-col gap-0.5 border-b border-hair py-1.5 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold">{h.name}</span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${CALL[h.call].cls}`}
                  >
                    {CALL[h.call].label}
                  </span>
                </div>
                <div className="text-xs text-sub">
                  wind {h.windMs.toFixed(1)} m/s · gust {h.gustMs.toFixed(1)} · rain {h.rainMmH.toFixed(1)}{' '}
                  mm/h
                </div>
                {h.reason && <p className="m-0 text-xs leading-snug text-sub">{h.reason}</p>}
              </li>
            ))}
          </ul>
          {weather.storms.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {weather.storms.map((s) => (
                <li key={s.id} className="text-xs text-sub">
                  {s.id} · {s.radiusKm.toFixed(0)} km · {s.rainMmH.toFixed(0)} mm/h
                  {s.movingToDeg !== undefined && s.speedMs !== undefined
                    ? ` · moving ${compass(s.movingToDeg)} ${s.speedMs.toFixed(0)} m/s`
                    : ''}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {held > 0 && (
        <p role="status" className="m-0 text-[13px] font-medium text-amber-ink">
          {held} {held === 1 ? 'order' : 'orders'} waiting for weather
        </p>
      )}

      <button
        type="button"
        aria-pressed={radar}
        onClick={() => onRadar(!radar)}
        className={`btn self-start ${radar ? 'btn-primary' : 'btn-quiet'}`}
      >
        Rain radar
      </button>
    </section>
  );
}
