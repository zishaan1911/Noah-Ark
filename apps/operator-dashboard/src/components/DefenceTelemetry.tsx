import type { Telemetry } from '@contracts';

interface Props {
  telemetry: Telemetry | null;
  /** Telemetry older than this many seconds reads as stale. */
  staleAfterS?: number;
  now: number;
}

const fmt = (v: number | undefined, digits = 0) =>
  v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits);
const pad3 = (v: number | undefined) => (v === undefined ? '—' : Math.round(v).toString().padStart(3, '0'));

function Readout({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <div style={{ border: '1px solid var(--dt-line)', padding: '8px 12px' }}>
      <div className="dt-label">{label}</div>
      <div className="dt-big" style={{ fontSize: 44, color: tone }}>
        {value}
        {unit && <span style={{ fontSize: 22 }}> {unit}</span>}
      </div>
    </div>
  );
}

/** Pitch moves the horizon, roll tilts it; the aircraft symbol stays fixed (an inside-out indicator). */
function Attitude({ pitch, roll }: { pitch: number; roll: number }) {
  const px = Math.max(-40, Math.min(40, pitch)) * 1.6;
  return (
    <div
      role="img"
      aria-label={`Pitch ${pitch.toFixed(0)} degrees, roll ${roll.toFixed(0)} degrees`}
      style={{ position: 'relative', height: 150, border: '1px solid var(--dt-dim)', overflow: 'hidden' }}
    >
      <div
        style={{
          position: 'absolute',
          left: '-30%',
          right: '-30%',
          top: '50%',
          transform: `translateY(${px}px) rotate(${-roll}deg)`,
          transformOrigin: '50% 0',
        }}
      >
        <div style={{ borderTop: '2px solid var(--dt-green)' }} />
        {[-20, -10, 10, 20].map((d) => (
          <div
            key={d}
            style={{
              position: 'absolute',
              left: '50%',
              top: d * 1.6,
              width: d % 20 === 0 ? 60 : 36,
              marginLeft: d % 20 === 0 ? -30 : -18,
              borderTop: '1px solid var(--dt-dim)',
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 84,
          marginLeft: -42,
          borderTop: '3px solid var(--dt-bright)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 8,
          height: 8,
          margin: '-3px 0 0 -4px',
          background: 'var(--dt-bright)',
        }}
      />
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--dt-dim)' }}>{label}</span>
      <span style={{ color: tone }}>{value}</span>
    </li>
  );
}

/** Live flight telemetry from the drone, in the defence terminal's look. */
export function DefenceTelemetry({ telemetry: t, staleAfterS = 5, now }: Props) {
  if (!t) {
    return (
      <p role="status" style={{ margin: 0, padding: 12, color: 'var(--dt-amber)' }}>
        NO TELEMETRY · START THE SIM WITH DOCKER COMPOSE UP
      </p>
    );
  }
  const ageS = (now - Date.parse(t.ts)) / 1000;
  const stale = Number.isFinite(ageS) && ageS > staleAfterS;
  const battTone = t.batteryPct < 25 ? 'var(--dt-red)' : t.batteryPct < 40 ? 'var(--dt-amber)' : undefined;
  const maxMotor = t.motorTempC ? Math.max(...t.motorTempC) : undefined;
  const vib = t.vibration ? Math.hypot(...t.vibration) : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 }}>
      {stale && (
        <p role="status" style={{ margin: 0, color: 'var(--dt-amber)' }}>
          TELEMETRY STALE · LAST {Math.round(ageS)} S AGO
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <Readout label="ALT ABOVE HOME" value={fmt(t.position.altM)} unit="M" />
        <Readout label="GROUND SPEED" value={fmt(t.groundSpeedMs, 1)} unit="M/S" />
        <Readout label="HEADING" value={pad3(t.headingDeg)} unit="°" />
        <Readout label="CLIMB" value={fmt(t.climbRateMs, 1)} unit="M/S" />
        <Readout label="PACK" value={fmt(t.batteryPct)} unit="%" tone={battTone} />
        <Readout label="BUS" value={fmt(t.batteryVoltageV, 1)} unit="V" />
      </div>
      <Attitude pitch={t.pitchDeg ?? 0} roll={t.rollDeg ?? 0} />
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--dt-dim)' }}>
        <span>PITCH {fmt(t.pitchDeg)}°</span>
        <span>ROLL {fmt(t.rollDeg)}°</span>
        <span>AMSL {fmt(t.altAmslM)} M</span>
      </div>
      <ul
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}
      >
        <Row
          label="MODE"
          value={`${t.flightMode}${t.armed ? ' · ARMED' : ' · SAFE'}`}
          tone={t.armed ? 'var(--dt-bright)' : undefined}
        />
        <Row
          label="PONTOONS"
          value={(t.pontoons ?? 'stowed').toUpperCase() + (t.onWater ? ' · ON WATER' : '')}
          tone={t.pontoons === 'failed' ? 'var(--dt-red)' : undefined}
        />
        <Row
          label="MOTORS MAX"
          value={maxMotor === undefined ? '—' : `${maxMotor.toFixed(0)} °C`}
          tone={maxMotor !== undefined && maxMotor > 80 ? 'var(--dt-amber)' : undefined}
        />
        <Row
          label="VIBRATION"
          value={vib === undefined ? '—' : `${vib.toFixed(1)} M/S²`}
          tone={vib !== undefined && vib > 30 ? 'var(--dt-amber)' : undefined}
        />
        <Row
          label="RAIN"
          value={t.rainIntensity === undefined ? '—' : `${t.rainIntensity.toFixed(1)} MM/H`}
        />
        <Row
          label="LINK"
          value={`${(t.linkType ?? 'lte').toUpperCase()}${t.linkQuality === undefined ? '' : ` · ${Math.round(t.linkQuality * 100)}%`}`}
        />
        <Row label="POSITION" value={`${t.position.lat.toFixed(5)}, ${t.position.lon.toFixed(5)}`} />
      </ul>
    </div>
  );
}
