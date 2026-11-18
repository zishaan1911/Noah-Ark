import { useState } from 'react';
import type { DroneApi } from '../hooks/useDrone';
import { ARK1 } from '../lib/ark1';
import { buildMission, payloadTotalKg } from '../lib/commands';
import { formatLatLon, parseLatLon } from '../lib/geo';
import { sendMission, type StepId, type StepStatus } from '../lib/flightOps';
import { planRoute, type Plan } from '../lib/planRoute';
import { elevationAt } from '../lib/terrain';
import type { PayloadRow, Point } from '../lib/types';
import { validateMission } from '../lib/validate';
import { windText } from './Header';
import { TerrainProfile } from './TerrainProfile';

export interface Review {
  plan: Plan;
  errors: string[];
}

export type PickTarget = 'start' | 'dest';

interface Props {
  droneId: string;
  drone: DroneApi;
  start: Point | null;
  dest: Point | null;
  picking: PickTarget | null;
  onPicking: (target: PickTarget | null) => void;
  onSetPoint: (target: PickTarget, p: Point) => void;
  review: Review | null;
  onReview: (r: Review | null) => void;
  /** Distance flown along the route in km, once flying. */
  liveKm: number | null;
}

type StepState = { status: StepStatus; detail?: string };
type Steps = Record<StepId, StepState>;

const INITIAL_STEPS: Steps = {
  position: { status: 'pending' },
  upload: { status: 'pending' },
  start: { status: 'pending' },
};
const STEP_LABEL: Record<StepId, string> = {
  position: 'Position the drone',
  upload: 'Upload mission',
  start: 'Start mission',
};

function PointField({
  label,
  point,
  active,
  onToggle,
  onSet,
}: {
  label: string;
  point: Point | null;
  active: boolean;
  onToggle: () => void;
  onSet: (p: Point) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && parseLatLon(draft) === null;
  const commit = () => {
    if (draft === null) return;
    const p = parseLatLon(draft);
    if (p) {
      onSet(p);
      setDraft(null);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={active}
          className={`btn w-28 shrink-0 ${active ? 'btn-primary' : 'btn-quiet'}`}
        >
          {active ? 'Click map…' : label}
        </button>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${label} as latitude, longitude`}
          aria-invalid={bad}
          placeholder="lat, lon"
          value={draft ?? (point ? formatLatLon(point) : '')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="min-h-11 min-w-0 flex-1 rounded-xl border-0 bg-fill px-3 font-mono text-[13px] text-ink outline-none"
        />
      </div>
      {bad && (
        <span className="text-xs text-red-ink" role="alert">
          Use "lat, lon", for example 5.73, 115.93
        </span>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
  };
  if (status === 'done')
    return (
      <svg aria-hidden="true" {...common} stroke="#1E7B3A">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  if (status === 'failed')
    return (
      <svg aria-hidden="true" {...common} stroke="#B23A26">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  if (status === 'active')
    return (
      <svg aria-hidden="true" {...common} stroke="#0A66D1" className="motion-safe:animate-spin">
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
    );
  return (
    <svg aria-hidden="true" {...common} stroke="#8E8E93">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

const nextRowId = (rows: PayloadRow[]) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function DeliveryPlanner({
  droneId,
  drone,
  start,
  dest,
  picking,
  onPicking,
  onSetPoint,
  review,
  onReview,
  liveKm,
}: Props) {
  const [rows, setRows] = useState<PayloadRow[]>([{ id: 1, item: 'GDEX parcel', qty: 1, kgEach: 1.2 }]);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Steps>(INITIAL_STEPS);
  const [sending, setSending] = useState(false);

  const total = payloadTotalKg(rows);
  const over = total > ARK1.maxPayloadKg;
  const rowsOk = rows.length > 0 && rows.every((r) => r.item.trim() && r.qty >= 1 && r.kgEach > 0);
  const canPlan = !!start && !!dest && rowsOk && !over && !planning && !sending;
  const sent = Object.values(steps).some((s) => s.status !== 'pending');
  const canSend = !!review && review.errors.length === 0 && !sending && drone.conn === 'connected';

  const editRows = (next: PayloadRow[]) => {
    setRows(next);
    setPlanError(null);
    onReview(null);
  };
  const patchRow = (id: number, patch: Partial<PayloadRow>) =>
    editRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function plan() {
    if (!start || !dest) return;
    setPlanning(true);
    setPlanError(null);
    setSteps(INITIAL_STEPS);
    try {
      const res = await planRoute({ start, dest, payloadKg: total, elevationAt });
      if (!res.ok) {
        onReview(null);
        setPlanError(res.reason);
        return;
      }
      const draft = buildMission({ droneId, start, dest, plan: res.plan, payload: rows });
      onReview({ plan: res.plan, errors: validateMission(draft).errors });
    } catch (err) {
      onReview(null);
      setPlanError(`Could not read the terrain: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPlanning(false);
    }
  }

  async function send() {
    if (!start || !dest || !review) return;
    // A fresh mission per attempt: new id and timestamps, so a retry is never mistaken for the last try.
    const mission = buildMission({ droneId, start, dest, plan: review.plan, payload: rows });
    const check = validateMission(mission);
    if (!check.ok) {
      onReview({ plan: review.plan, errors: check.errors });
      return;
    }
    setSteps(INITIAL_STEPS);
    setSending(true);
    drone.clearTrack();
    try {
      await sendMission(drone, droneId, mission, (id, status, detail) =>
        setSteps((s) => ({ ...s, [id]: { status, detail } })),
      );
    } catch {
      // The failed step already shows the message.
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-label="Plan a delivery" className="glass flex flex-col gap-3.5 rounded-[22px] p-4">
      <h2 className="m-0 text-[17px] font-semibold tracking-tight">Plan a delivery</h2>

      <div className="flex flex-col gap-2">
        <PointField
          label="Start"
          point={start}
          active={picking === 'start'}
          onToggle={() => onPicking(picking === 'start' ? null : 'start')}
          onSet={(p) => onSetPoint('start', p)}
        />
        <PointField
          label="Destination"
          point={dest}
          active={picking === 'dest'}
          onToggle={() => onPicking(picking === 'dest' ? null : 'dest')}
          onSet={(p) => onSetPoint('dest', p)}
        />
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-semibold text-sub">Payload · qty × kg each</legend>
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_2.75rem] items-center gap-2">
            <input
              type="text"
              aria-label="Item"
              value={r.item}
              onChange={(e) => patchRow(r.id, { item: e.target.value })}
              className="min-h-11 w-full min-w-0 rounded-xl border-0 bg-fill px-3 text-sm text-ink outline-none"
            />
            <label className="flex items-center gap-1 text-xs text-sub">
              <span className="sr-only">Quantity</span>×
              <input
                type="number"
                min={1}
                step={1}
                value={r.qty}
                onChange={(e) => patchRow(r.id, { qty: Math.floor(num(e.target.value)) })}
                className="min-h-11 w-14 rounded-xl border-0 bg-fill px-2 font-mono text-[13px] text-ink outline-none"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-sub">
              <span className="sr-only">Kilograms each</span>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={r.kgEach}
                onChange={(e) => patchRow(r.id, { kgEach: num(e.target.value) })}
                className="min-h-11 w-16 rounded-xl border-0 bg-fill px-2 font-mono text-[13px] text-ink outline-none"
              />
            </label>
            <button
              type="button"
              aria-label={`Remove ${r.item || 'item'}`}
              disabled={rows.length === 1}
              onClick={() => editRows(rows.filter((x) => x.id !== r.id))}
              className="btn btn-quiet w-11 shrink-0 px-0"
            >
              <svg
                aria-hidden="true"
                className="mx-auto"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              >
                <path d="M6 12h12" />
              </svg>
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => editRows([...rows, { id: nextRowId(rows), item: '', qty: 1, kgEach: 0.5 }])}
          >
            Add item
          </button>
          <span
            className={`font-mono text-[13px] ${over ? 'font-semibold text-red-ink' : 'text-sub'}`}
            role="status"
          >
            {total.toFixed(2)} / {ARK1.maxPayloadKg.toFixed(1)} kg max
            {over && ' · too heavy'}
          </span>
        </div>
      </fieldset>

      <button type="button" className="btn btn-primary" disabled={!canPlan} onClick={plan}>
        {planning ? 'Reading terrain…' : 'Plan route'}
      </button>
      {planError && (
        <div className="rounded-xl bg-red-tint p-3 text-[13px] leading-snug text-red-ink" role="alert">
          {planError}
        </div>
      )}

      {review && (
        <div className="flex flex-col gap-3" aria-label="Route review" role="group">
          <dl className="m-0 grid grid-cols-3 gap-2">
            {[
              ['Distance', `${review.plan.distanceKm.toFixed(1)} km`],
              ['ETA', `${Math.round(review.plan.etaMinutes)} min`],
              ['Payload', `${total.toFixed(1)} kg`],
              ['Max ground', `${Math.round(review.plan.maxGroundAmslM)} m`],
              ['Climb', `${Math.round(review.plan.climbM)} m`],
              ['Waypoints', `${review.plan.waypoints.length}`],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col rounded-xl bg-white p-2.5">
                <dt className="text-xs text-sub">{k}</dt>
                <dd className="m-0 font-mono text-base">{v}</dd>
              </div>
            ))}
          </dl>
          <TerrainProfile profile={review.plan.profile} liveKm={liveKm} />
          {review.errors.length > 0 && (
            <ul
              className="m-0 list-disc rounded-xl bg-red-tint py-3 pr-3 pl-7 text-[13px] text-red-ink"
              role="alert"
            >
              {review.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-primary" disabled={!canSend} onClick={send}>
            {sending ? 'Sending…' : `Send to ${droneId}`}
          </button>
          {drone.conn !== 'connected' && (
            <span className="text-xs text-sub">Waiting for the MQTT broker.</span>
          )}
        </div>
      )}

      {sent && (
        <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Send progress" aria-live="polite">
          {(Object.keys(STEP_LABEL) as StepId[]).map((id) => {
            const s = steps[id];
            const wind = id === 'position' && s.status === 'active' ? windText(drone.sim) : null;
            return (
              <li key={id} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5">
                  <StepIcon status={s.status} />
                </span>
                <span className="flex flex-col">
                  <span className={s.status === 'failed' ? 'font-semibold text-red-ink' : 'font-medium'}>
                    {id === 'position' && s.status === 'active' ? 'Positioning drone (sim)…' : STEP_LABEL[id]}
                  </span>
                  {wind && <span className="text-xs text-sub">{wind}</span>}
                  {s.detail && <span className="text-[13px] text-red-ink">{s.detail}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
