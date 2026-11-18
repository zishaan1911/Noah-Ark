import type { Telemetry } from '@contracts';
import { haversineKm } from '../lib/geo';
import type { Point } from '../lib/types';

interface Props {
  droneId: string;
  telemetry: Telemetry | null;
  dest: Point | null;
  /** Terrain elevation under the drone (m AMSL), for altitude above ground. */
  groundM: number | null;
}

const fmt = (v: number | undefined, digits = 1, unit = '') =>
  v === undefined ? '—' : `${v.toFixed(digits)}${unit}`;

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-xl bg-card p-2.5">
      <span className="text-xs text-sub">{label}</span>
      <span className="font-mono text-base">{value}</span>
    </div>
  );
}

export function LiveCard({ droneId, telemetry: t, dest, groundM }: Props) {
  if (!t) {
    return (
      <section aria-label="Live flight">
        <span className="text-[13px] font-semibold text-accent-ink">{droneId} · no telemetry yet</span>
        <p className="m-0 mt-1 text-sm text-sub">Waiting for the drone to report in.</p>
      </section>
    );
  }
  const agl = t.altAmslM !== undefined && groundM !== null ? t.altAmslM - groundM : undefined;
  const toGoKm = dest ? haversineKm(t.position, dest) : undefined;
  const speed = t.groundSpeedMs ?? 0;
  const etaMin = toGoKm !== undefined && speed > 1 ? toGoKm / ((speed * 60) / 1000) : undefined;
  const batt = Math.max(0, Math.min(100, t.batteryPct));

  return (
    <section aria-label="Live flight" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-accent-ink">
            {droneId} · {t.armed ? 'armed' : 'disarmed'}
          </span>
          <span className="font-mono text-[22px] font-bold tracking-tight">{t.flightMode}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[28px] leading-none font-bold tracking-tight">
            {etaMin === undefined ? '—' : `${Math.max(1, Math.round(etaMin))} min`}
          </span>
          <span className="text-xs text-sub">
            {toGoKm === undefined ? 'no destination' : `${toGoKm.toFixed(1)} km to go`}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div
          role="meter"
          aria-label="Battery"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(batt)}
          className="h-1.5 rounded-sm bg-hair"
        >
          <div
            className={`h-1.5 rounded-sm ${batt < 25 ? 'bg-red' : 'bg-accent'}`}
            style={{ width: `${batt}%` }}
          />
        </div>
        <div className="flex justify-between font-mono text-xs text-sub">
          <span>Battery {Math.round(batt)}%</span>
          <span>{fmt(t.batteryVoltageV, 1, ' V')}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Cell label="Ground speed" value={fmt(t.groundSpeedMs, 1, ' m/s')} />
        <Cell label="Climb" value={fmt(t.climbRateMs, 1, ' m/s')} />
        <Cell label="Heading" value={t.headingDeg === undefined ? '—' : `${Math.round(t.headingDeg)}°`} />
        <Cell label="Alt home" value={fmt(t.position.altM, 0, ' m')} />
        <Cell label="Alt AGL" value={fmt(agl, 0, ' m')} />
        <Cell label="Pontoons" value={t.pontoons ?? '—'} />
      </div>
      <div className="flex justify-between font-mono text-xs text-sub">
        <span>
          Link {t.linkType ? t.linkType.toUpperCase() : '—'} {fmt(t.linkQuality, 2)}
        </span>
        <span>Alt AMSL {fmt(t.altAmslM, 0, ' m')}</span>
      </div>
    </section>
  );
}
