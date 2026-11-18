import type { Mission, MissionMode, MissionStatus } from '@contracts';
import { formatLatLon } from '../lib/geo';

const MAX_VISIBLE = 12;

const MODE: Record<MissionMode, { label: string; cls: string }> = {
  gdex: { label: 'GDEX', cls: 'bg-amber-tint text-amber-ink' },
  relief: { label: 'Relief', cls: 'bg-red-tint text-red-ink' },
  military: { label: 'Defence', cls: 'bg-fill text-sub' },
};

const STATUS_CLS: Partial<Record<MissionStatus, string>> = {
  dispatched: 'bg-amber-tint text-amber-ink',
  in_flight: 'bg-accent-tint text-accent-ink',
  delivered: 'bg-green-tint text-green-ink',
};

const createdMs = (m: Mission) => {
  const ms = Date.parse(m.createdAt);
  return Number.isFinite(ms) ? ms : 0;
};

function Row({ m }: { m: Mission }) {
  const mode = MODE[m.mode];
  const trip = [
    m.distanceKm !== undefined ? `${m.distanceKm.toFixed(1)} km` : null,
    m.etaMinutes !== undefined ? `${Math.round(m.etaMinutes)} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="flex flex-col gap-1 border-b border-hair py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${mode.cls}`}>{mode.label}</span>
        <span className="font-mono text-[13px] font-semibold">{m.droneId}</span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLS[m.status] ?? 'bg-fill text-sub'}`}
        >
          {m.status.replace(/_/g, ' ')}
        </span>
      </div>
      <div className="font-mono text-xs text-sub">
        {formatLatLon(m.destination)}
        {trip && <span className="font-sans"> · {trip}</span>}
      </div>
      {m.aiRationale && <p className="m-0 text-[13px] leading-snug text-sub">{m.aiRationale}</p>}
    </li>
  );
}

/** Newest-first missions with the dispatcher's reason for each pick. */
export function DispatchFeed({ missions }: { missions: Record<string, Mission> }) {
  const recent = Object.values(missions)
    .sort((a, b) => createdMs(b) - createdMs(a))
    .slice(0, MAX_VISIBLE);
  return (
    <section aria-label="Dispatcher" className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold">Dispatcher</h2>
        <span className="text-xs text-sub">AI picks the drone; every pick explained</span>
      </div>
      {recent.length === 0 ? (
        <p className="m-0 py-2 text-sm text-sub">No missions yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {recent.map((m) => (
            <Row key={m.id} m={m} />
          ))}
        </ul>
      )}
    </section>
  );
}
