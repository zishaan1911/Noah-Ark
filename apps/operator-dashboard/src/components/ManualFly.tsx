import { useState } from 'react';
import { MANUAL } from '../lib/manual';
import type { Stick } from '../lib/types';

interface Props {
  armed: boolean;
  airborne: boolean;
  active: boolean;
  stick: Stick;
  onToggle: (on: boolean) => void;
  onAfter: (cmd: 'hold' | 'rtl' | 'land') => void;
}

const LEGEND: { keys: string[]; label: string }[] = [
  { keys: ['W', 'A', 'S', 'D'], label: 'move' },
  { keys: ['Q', 'E'], label: 'yaw' },
  { keys: ['R', 'F'], label: 'up / down' },
  { keys: ['Shift'], label: 'boost' },
  { keys: ['Space'], label: 'stop' },
];

const AFTER: { cmd: 'hold' | 'rtl' | 'land'; label: string }[] = [
  { cmd: 'hold', label: 'Hold here' },
  { cmd: 'rtl', label: 'Return home' },
  { cmd: 'land', label: 'Land here' },
];

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

function Keycap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-current/20 bg-black/5 px-1.5 py-0.5 font-mono text-[11px]">
      {children}
    </kbd>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-sub">
      <span className="w-8">{label}</span>
      <div className="relative h-1.5 flex-1 rounded-full bg-black/10" role="presentation">
        <span className="absolute top-0 left-1/2 h-full w-px bg-current opacity-40" />
        <span
          className="absolute top-[-2px] size-2.5 rounded-full bg-amber-500"
          style={{ left: `calc(${50 + clamp(value) * 50}% - 5px)` }}
        />
      </div>
    </div>
  );
}

function StickPad({ stick }: { stick: Stick }) {
  const x = clamp(stick.rightMs / MANUAL.boostMs);
  const y = clamp(stick.forwardMs / MANUAL.boostMs);
  return (
    <svg viewBox="-30 -30 60 60" className="size-16 shrink-0" aria-hidden="true">
      <circle r="26" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
      <path d="M-26 0H26M0 -26V26" stroke="currentColor" strokeOpacity="0.15" />
      <circle cx={x * 22} cy={-y * 22} r="4.5" fill="#f59e0b" />
    </svg>
  );
}

export function ManualFly({ armed, airborne, active, stick, onToggle, onAfter }: Props) {
  const [ending, setEnding] = useState(false);

  function finish(cmd: 'hold' | 'rtl' | 'land') {
    setEnding(false);
    onAfter(cmd);
    onToggle(false);
  }

  if (!active) {
    const ready = armed && airborne;
    return (
      <section aria-label="Manual flight" className="glass flex flex-col gap-2 rounded-[22px] p-4">
        <button
          type="button"
          className="btn btn-quiet"
          aria-pressed={false}
          disabled={!ready}
          onClick={() => onToggle(true)}
        >
          Fly manually
        </button>
        {!ready && <span className="text-xs text-sub">Available once the drone is airborne</span>}
      </section>
    );
  }

  return (
    <section aria-label="Manual flight" className="glass flex flex-col gap-3 rounded-[22px] p-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-black">
          MANUAL
        </span>
        <button
          type="button"
          className="btn btn-quiet"
          aria-pressed={true}
          aria-expanded={ending}
          onClick={() => setEnding((v) => !v)}
        >
          End manual
        </button>
      </div>
      {ending && (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="After manual flight">
          {AFTER.map((a) => (
            <button key={a.cmd} type="button" className="btn btn-quiet" onClick={() => finish(a.cmd)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <StickPad stick={stick} />
        <div className="flex flex-1 flex-col gap-2">
          <Bar label="Up" value={stick.upMs / MANUAL.climbMs} />
          <Bar label="Yaw" value={stick.yawRateDegS / MANUAL.yawDegS} />
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-sub">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span className="flex gap-1">
              {l.keys.map((k) => (
                <Keycap key={k}>{k}</Keycap>
              ))}
            </span>
            {l.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
