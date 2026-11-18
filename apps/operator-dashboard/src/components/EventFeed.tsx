import type { DroneEvent } from '@contracts';

export const STAGES = ['outbound', 'landed', 'delivered', 'returning', 'home'] as const;
export type Stage = (typeof STAGES)[number] | 'aborted';

/** Walk the events oldest to newest and report where the delivery is. */
export function deliveryStage(events: DroneEvent[]): Stage | null {
  let stage: Stage | null = null;
  for (const e of [...events].reverse()) {
    if (e.type === 'mission_started' || e.type === 'takeoff')
      stage = stage === 'returning' ? stage : 'outbound';
    else if (e.type === 'landed') stage = stage === 'returning' ? 'home' : 'landed';
    else if (e.type === 'payload_released' || e.type === 'delivered') stage = 'delivered';
    else if (e.type === 'rtl') stage = 'returning';
    else if (e.type === 'aborted') stage = 'aborted';
  }
  return stage;
}

const SEVERITY: Record<DroneEvent['severity'], string> = {
  info: 'bg-accent',
  warning: 'bg-amber',
  critical: 'bg-red',
};

const label = (e: DroneEvent) => e.message ?? e.type.replace(/_/g, ' ');
const time = (ts: string) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The delivery state chips: outbound, landed, delivered, returning, home. */
export function StageChips({ stage }: { stage: Stage | null }) {
  const at = stage && stage !== 'aborted' ? STAGES.indexOf(stage) : -1;
  return (
    <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Delivery state">
      {STAGES.map((s, i) => (
        <li
          key={s}
          aria-current={s === stage ? 'step' : undefined}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            s === stage
              ? 'bg-action text-white'
              : i < at
                ? 'bg-green-tint text-green-ink'
                : 'bg-fill text-sub'
          }`}
        >
          {s}
        </li>
      ))}
      {stage === 'aborted' && (
        <li className="rounded-full bg-red-tint px-2.5 py-1 text-xs font-semibold text-red-ink">aborted</li>
      )}
    </ol>
  );
}

/** Renders inside the live sheet, so it has no card chrome and does not scroll on its own. */
export function EventFeed({ events }: { events: DroneEvent[] }) {
  const stage = deliveryStage(events);
  return (
    <section aria-label="Events" className="flex flex-col gap-2.5">
      <StageChips stage={stage} />
      {events.length === 0 ? (
        <p className="m-0 text-sm text-sub">No events yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Event feed">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-[13px]">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" aria-hidden="true">
                <span className={`block size-2 rounded-full ${SEVERITY[e.severity]}`} />
              </span>
              <span className="shrink-0 font-mono text-xs text-sub">{time(e.ts)}</span>
              <span className="min-w-0 break-words">
                <span className="sr-only">{e.severity}: </span>
                {label(e)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
