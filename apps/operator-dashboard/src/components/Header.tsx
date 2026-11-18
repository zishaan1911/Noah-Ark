import { useEffect, useState } from 'react';
import type { MqttState } from '../hooks/useMqtt';
import { OPERATOR, OPERATOR_INITIALS } from '../lib/config';
import type { SimStatus, View } from '../lib/types';
import { ViewSwitch } from './ViewSwitch';

interface Props {
  droneId: string;
  view: View;
  onView: (v: View) => void;
  conn: MqttState;
  sim: SimStatus | null;
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

export function Header({ droneId, view, onView, conn, sim }: Props) {
  const ok = conn === 'connected';
  const simOk = sim?.state === 'ready';
  return (
    <header className="glass flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[18px] py-2 pr-3 pl-3.5">
      <div className="flex items-center gap-2.5">
        <div className="flex size-[30px] items-center justify-center rounded-lg bg-ink">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
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
        GDEX · <span className="font-mono">{droneId}</span>
      </span>
      <ViewSwitch view={view} onChange={onView} />
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-sub">
        <span className="flex items-center gap-1.5" role="status">
          <span className={`size-2 rounded-full ${ok ? 'bg-green' : 'bg-amber'}`} />
          {CONN_TEXT[conn]}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${simOk ? 'bg-green' : 'bg-amber'}`} />
          {simText(sim)}
        </span>
        <Clock />
        <span
          className="flex size-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white"
          role="img"
          aria-label={OPERATOR}
        >
          {OPERATOR_INITIALS}
        </span>
      </div>
    </header>
  );
}
