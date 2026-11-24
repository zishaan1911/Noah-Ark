import { useState } from 'react';
import type { MissionRequest, SosRequest } from '@contracts';
import { formatLatLon } from '../lib/geo';
import { nearestHub } from '../lib/hubs';
import { kitFor } from '../lib/kit';
import { sosToOrder } from '../lib/sos';
import { validateMissionRequest } from '../lib/validate';

interface Props {
  /** A triaged SOS request from PartyRock. */
  sos: SosRequest;
  connected: boolean;
  /** Publishes the order on fleet/orders; rejects if the broker is not reachable. */
  onDispatch: (order: MissionRequest) => Promise<void>;
  onDismiss: () => void;
}

const MAX_KG = 2;

const urgencyCls = (u: number) =>
  u >= 4 ? 'bg-red-tint text-red-ink' : u === 3 ? 'bg-amber-tint text-amber-ink' : 'bg-fill text-sub';

type Phase = 'idle' | 'sending' | 'queued';

/** The SOS that PartyRock triaged, with the kit the drone would carry and one button to hand it to the dispatcher. */
export function SosInbox({ sos, connected, onDispatch, onDismiss }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const triage = sos.triage;
  if (!triage) return null;

  const kit = kitFor(triage);
  const kg = kit.reduce((s, p) => s + p.weightKg, 0);
  const where = sos.report.location;
  const people = triage.peopleCount ?? sos.report.peopleCount;

  async function dispatch() {
    setError(null);
    const order = sosToOrder(sos);
    const check = validateMissionRequest(order);
    if (!check.ok) {
      setError(check.errors.join('; '));
      return;
    }
    setPhase('sending');
    try {
      await onDispatch(order);
      setPhase('queued');
    } catch (err) {
      setPhase('idle');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section aria-label="Incoming SOS" className="flex flex-col gap-2.5 rounded-xl bg-fill p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[15px] font-semibold">Incoming SOS</h2>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${urgencyCls(triage.urgency)}`}>
          Urgency {triage.urgency}
        </span>
        {people !== undefined && (
          <span className="ml-auto text-xs text-sub">
            {people} {people === 1 ? 'person' : 'people'}
          </span>
        )}
      </div>

      <p className="m-0 text-[13px] leading-snug">{triage.summary}</p>

      <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Needs">
        {triage.needs.map((n) => (
          <li key={n} className="rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-sub">
            {n.replace(/_/g, ' ')}
          </li>
        ))}
        {triage.waterLanding && (
          <li className="rounded-full bg-accent-tint px-2 py-0.5 text-[11px] font-semibold text-accent-ink">
            Water landing
          </li>
        )}
      </ul>

      {triage.medicalConditions && triage.medicalConditions.length > 0 && (
        <p className="m-0 text-xs text-sub">Medical: {triage.medicalConditions.join(', ')}</p>
      )}

      <p className="m-0 font-mono text-xs text-sub">
        {formatLatLon(where)}
        <span className="font-sans"> · nearest hub {nearestHub(where).name}</span>
      </p>

      <div className="flex flex-col gap-1">
        <ul className="m-0 flex list-none flex-col p-0">
          {kit.map((p) => (
            <li key={p.item} className="flex justify-between gap-2 text-xs">
              <span>
                {p.item} × {p.qty}
              </span>
              <span className="font-mono text-sub">{p.weightKg.toFixed(2)} kg</span>
            </li>
          ))}
        </ul>
        <span className="self-end font-mono text-xs text-sub">
          {kg.toFixed(2)} / {MAX_KG.toFixed(2)} kg
        </span>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={!connected || phase !== 'idle'}
        onClick={() => void dispatch()}
      >
        {phase === 'sending' ? 'Sending…' : 'Dispatch to fleet'}
      </button>
      {phase === 'queued' && (
        <p role="status" className="m-0 rounded-xl bg-green-tint p-2.5 text-[13px] text-green-ink">
          Queued. The dispatcher picks the drone; watch the Dispatcher feed.
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 rounded-xl bg-red-tint p-2.5 text-[13px] text-red-ink">
          {error}
        </p>
      )}
      {!connected && phase === 'idle' && (
        <span className="text-xs text-sub">Waiting for the MQTT broker.</span>
      )}
      <button type="button" className="btn btn-quiet" onClick={onDismiss}>
        Dismiss
      </button>
    </section>
  );
}
