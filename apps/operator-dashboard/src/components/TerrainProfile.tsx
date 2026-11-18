import type { ProfilePoint } from '../lib/planRoute';

interface Props {
  profile: ProfilePoint[];
  /** Distance flown along the route in km, drawn as a hairline once the drone is flying. */
  liveKm?: number | null;
}

const W = 340;
const H = 120;
const PAD = { l: 34, r: 8, t: 8, b: 20 };

export function TerrainProfile({ profile, liveKm }: Props) {
  if (profile.length < 2) return null;
  const maxKm = profile[profile.length - 1]?.dKm || 1;
  const all = profile.flatMap((p) => [p.groundAmslM, p.flightAmslM]);
  const lo = Math.floor((Math.min(...all) - 10) / 10) * 10;
  const hi = Math.ceil((Math.max(...all) + 20) / 10) * 10;
  const x = (km: number) => PAD.l + (km / maxKm) * (W - PAD.l - PAD.r);
  const y = (m: number) => PAD.t + (1 - (m - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = (key: 'groundAmslM' | 'flightAmslM') =>
    profile.map((p, i) => `${i ? 'L' : 'M'}${x(p.dKm).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  const ground = line('groundAmslM');
  const area = `${ground} L${x(maxKm).toFixed(1)} ${H - PAD.b} L${x(0).toFixed(1)} ${H - PAD.b} Z`;
  const live = liveKm ?? -1;
  const showLive = live >= 0 && live <= maxKm;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Terrain profile over ${maxKm.toFixed(1)} km: ground ${lo} to ${hi} metres, flight line above it`}
      className="w-full rounded-xl bg-card"
    >
      <path d={area} fill="var(--color-terrain)" />
      <path d={ground} fill="none" stroke="var(--color-terrain-line)" strokeWidth="1.2" />
      <path
        d={line('flightAmslM')}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {showLive && (
        <line x1={x(live)} x2={x(live)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink)" strokeWidth="1" />
      )}
      <g fontFamily="JetBrains Mono, monospace" fontSize="9" fill="var(--color-sub)">
        <text x={PAD.l - 4} y={y(hi) + 8} textAnchor="end">
          {hi} m
        </text>
        <text x={PAD.l - 4} y={y(lo)} textAnchor="end">
          {lo} m
        </text>
        <text x={x(0)} y={H - 6}>
          0 km
        </text>
        <text x={x(maxKm)} y={H - 6} textAnchor="end">
          {maxKm.toFixed(1)} km
        </text>
      </g>
    </svg>
  );
}
