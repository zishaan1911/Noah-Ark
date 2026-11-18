import { useEffect, useState } from 'react';
import type { MqttState } from '../hooks/useMqtt';
import { OPERATOR, OPERATOR_INITIALS } from '../lib/config';
import type { SimStatus, Theme, View } from '../lib/types';
import { ViewSwitch } from './ViewSwitch';

interface Props {
  droneId: string;
  view: View;
  onView: (v: View) => void;
  conn: MqttState;
  sim: SimStatus | null;
  theme: Theme;
  onToggleTheme: () => void;
  /** Which page this header sits on; default 'gdex'. */
  page?: 'gdex' | 'fleet';
  /** Fleet page: drones seen so far. */
  fleetCount?: number;
  /** Fleet page: the wind line from `fleet/stats`, shown in place of the sim text. */
  fleetWind?: string | null;
}

const PAGES = [
  { id: 'gdex', label: 'Drone', hash: '' },
  { id: 'fleet', label: 'Fleet', hash: '#/fleet' },
] as const;

function PageSwitch({ page }: { page: 'gdex' | 'fleet' }) {
  return (
    <nav aria-label="Page" className="flex gap-0.5 rounded-xl bg-fill p-0.5">
      {PAGES.map((p) => {
        const on = p.id === page;
        return (
          <button
            key={p.id}
            type="button"
            aria-current={on ? 'page' : undefined}
            onClick={() => {
              location.hash = p.hash;
            }}
            className={`min-h-11 min-w-16 cursor-pointer rounded-[10px] border-0 px-3 text-sm font-semibold transition-colors ${
              on ? 'bg-(--glass-solid) text-ink shadow-sm' : 'bg-transparent text-sub'
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </nav>
  );
}

const CONN_TEXT: Record<MqttState, string> = {
  connected: 'MQTT connected',
  connecting: 'MQTT connecting',
  reconnecting: 'MQTT reconnecting',
};

export const windText = (sim: SimStatus | null) =>
  sim && Number.isFinite(sim.windMs) && Number.isFinite(sim.windFromDeg)
    ? `Wind ${sim.windMs.toFixed(1)} m/s from ${Math.round(sim.windFromDeg)}°`
    : null;

function simText(sim: SimStatus | null): string {
  if (!sim) return 'Sim offline';
  if (sim.state === 'booting') return 'Sim booting';
  if (sim.state === 'error') return 'Sim error';
  return ['Sim ready', windText(sim)].filter(Boolean).join(' · ');
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className="font-mono" dateTime={now.toISOString()}>
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </time>
  );
}

function ThemeButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Dark theme"
      aria-pressed={dark}
      className="btn btn-quiet flex size-11 items-center justify-center p-0"
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {dark ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}

export function Header({
  droneId,
  view,
  onView,
  conn,
  sim,
  theme,
  onToggleTheme,
  page = 'gdex',
  fleetCount = 0,
  fleetWind = null,
}: Props) {
  const ok = conn === 'connected';
  const fleet = page === 'fleet';
  const simOk = fleet ? fleetWind !== null : sim?.state === 'ready';
  const simLabel = fleet ? (fleetWind ?? 'Sim offline') : simText(sim);
  return (
    <header className="glass flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[18px] py-2 pr-3 pl-3.5">
      <div className="flex items-center gap-2.5">
        <div className="flex size-[30px] items-center justify-center rounded-lg bg-ink text-(--glass-solid)">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 15c2 2 4 2 6 0s4-2 6 0 4 2 6 0" />
            <path d="M6 12l6-8 6 8" />
            <path d="M12 4v8" />
          </svg>
        </div>
        <span className="text-[15px] font-semibold">Ark Command</span>
      </div>
      <span className="flex min-h-9 items-center gap-2 rounded-full bg-amber-tint px-3 text-[13px] font-semibold text-amber-ink">
        <span className="size-[7px] rounded-full bg-amber" />
        {fleet ? (
          `Fleet · ${fleetCount} drones`
        ) : (
          <>
            GDEX · <span className="font-mono">{droneId}</span>
          </>
        )}
      </span>
      <PageSwitch page={page} />
      {!fleet && <ViewSwitch view={view} onChange={onView} />}
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-sub">
        <span className="flex items-center gap-1.5" role="status">
          <span className={`size-2 rounded-full ${ok ? 'bg-green' : 'bg-amber'}`} />
          {CONN_TEXT[conn]}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${simOk ? 'bg-green' : 'bg-amber'}`} />
          {simLabel}
        </span>
        <Clock />
        <ThemeButton theme={theme} onToggle={onToggleTheme} />
        <span
          className="flex size-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-(--glass-solid)"
          role="img"
          aria-label={OPERATOR}
        >
          {OPERATOR_INITIALS}
        </span>
      </div>
    </header>
  );
}
