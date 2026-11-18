import type { ReactNode } from 'react';
import type { Telemetry } from '@contracts';
import { normDeg } from '../lib/geo';
import type { Stick } from '../lib/types';

interface Props {
  telemetry: Telemetry | null;
  groundM: number | null;
  manual?: boolean;
  stick?: Stick;
}

const TAPE_W = 600;
const PX_PER_DEG = 10;
const CARDINAL: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
const LADDER = [-20, -10, 0, 10, 20];
const LADDER_PX = 6;

function HeadingTape({ heading }: { heading: number }) {
  const ticks: ReactNode[] = [];
  for (let k = Math.floor((heading - 32) / 5); k <= Math.ceil((heading + 32) / 5); k++) {
    const deg = k * 5;
    const x = TAPE_W / 2 + (((deg - heading + 540) % 360) - 180) * PX_PER_DEG;
    const major = k % 2 === 0;
    const norm = normDeg(deg);
    ticks.push(
      <g key={k}>
        <line x1={x} x2={x} y1={major ? 22 : 28} y2={36} stroke="#fff" strokeWidth="1.5" />
        {major && (
          <text
            x={x}
            y={16}
            textAnchor="middle"
            fontSize="13"
            fill="#fff"
            fontFamily="JetBrains Mono, monospace"
          >
            {CARDINAL[norm] ?? String(norm).padStart(3, '0')}
          </text>
        )}
      </g>,
    );
  }
  return (
    <svg
      viewBox={`0 0 ${TAPE_W} 52`}
      className="mx-auto block w-full max-w-xl"
      aria-hidden="true"
      style={{ filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.85))' }}
    >
      {ticks}
      <path d={`M${TAPE_W / 2 - 6} 48 L${TAPE_W / 2} 38 L${TAPE_W / 2 + 6} 48 Z`} fill="#fff" />
    </svg>
  );
}

function Horizon({ pitch, roll }: { pitch: number; roll: number }) {
  return (
    <svg
      viewBox="-160 -110 320 220"
      className="absolute inset-0 m-auto h-[46%] max-h-80 w-auto"
      aria-hidden="true"
      style={{ filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.85))' }}
    >
      <g transform={`rotate(${-roll})`}>
        <g transform={`translate(0 ${pitch * LADDER_PX})`}>
          {LADDER.map((a) => (
            <g key={a} stroke="#fff" strokeWidth="1.5">
              <line
                x1={a === 0 ? -90 : -40}
                x2={a === 0 ? -20 : -14}
                y1={-a * LADDER_PX}
                y2={-a * LADDER_PX}
              />
              <line x1={a === 0 ? 20 : 14} x2={a === 0 ? 90 : 40} y1={-a * LADDER_PX} y2={-a * LADDER_PX} />
            </g>
          ))}
        </g>
      </g>
      <g stroke="#fff" strokeWidth="2" fill="none">
        <path d="M-14 0 H-4 M4 0 H14 M0 -4 V4" />
      </g>
    </svg>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] tracking-wide opacity-80">{label}</span>
      <span className="text-lg leading-tight">{value}</span>
    </div>
  );
}

export function OnboardHud({ telemetry: t, groundM, manual = false, stick }: Props) {
  const heading = t?.headingDeg ?? 0;
  const agl = t?.altAmslM !== undefined && groundM !== null ? t.altAmslM - groundM : undefined;
  return (
    <div className="hud-text pointer-events-none absolute inset-0 z-[5]">
      <div className="absolute top-3 left-3 flex items-center gap-2 text-xs lg:top-24">
        <span className="size-2 rounded-full bg-[#ff453a]" aria-hidden="true" />
        CAM 1 · 30° ↓ · REC
        {manual && (
          <span className="rounded bg-amber-500 px-1.5 py-0.5 font-bold tracking-wide text-black">
            MANUAL
          </span>
        )}
      </div>
      <div className="absolute inset-x-0 top-10 px-4 lg:top-[88px]">
        <div className="mx-auto w-fit text-center text-sm">
          {String(Math.round(normDeg(heading))).padStart(3, '0')}°
        </div>
        <HeadingTape heading={heading} />
      </div>
      <Horizon pitch={t?.pitchDeg ?? 0} roll={t?.rollDeg ?? 0} />
      <div className="absolute bottom-12 left-3 flex flex-col gap-2 lg:left-[408px]">
        <Readout label="ALT AGL" value={agl === undefined ? '—' : `${Math.round(agl)} m`} />
        <Readout label="ALT AMSL" value={t?.altAmslM === undefined ? '—' : `${Math.round(t.altAmslM)} m`} />
      </div>
      <div className="absolute right-3 bottom-12 flex flex-col items-end gap-2 lg:right-[408px]">
        <Readout
          label="GND SPEED"
          value={t?.groundSpeedMs === undefined ? '—' : `${t.groundSpeedMs.toFixed(1)} m/s`}
        />
        <Readout label="BATT" value={t ? `${Math.round(t.batteryPct)}%` : '—'} />
        <Readout label="MODE" value={t?.flightMode ?? '—'} />
      </div>
      {manual && stick && (
        <div className="absolute inset-x-0 bottom-12 text-center text-xs">
          FWD {stick.forwardMs.toFixed(1)} · RIGHT {stick.rightMs.toFixed(1)} · UP {stick.upMs.toFixed(1)} m/s
          · YAW {Math.round(stick.yawRateDegS)}°/s
        </div>
      )}
      <p className="absolute inset-x-0 bottom-3 m-0 px-3 text-center text-[11px] opacity-90">
        Synthetic camera: street map on a 30 m elevation model
      </p>
    </div>
  );
}
