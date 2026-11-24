import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { DroneEvent, Mission } from '@contracts';
import type { DroneApi } from '../hooks/useDrone';
import { ARK1 } from '../lib/ark1';
import { buildMission, payloadTotalKg } from '../lib/commands';
import { bearingDeg, parseLatLon } from '../lib/geo';
import { sendMission, type StepId, type StepStatus } from '../lib/flightOps';
import { planRoute, type Plan } from '../lib/planRoute';
import { elevationAt } from '../lib/terrain';
import type { PayloadRow, PickTarget, Point } from '../lib/types';
import { validateMission } from '../lib/validate';
import { fetchPointWeather, flyCall, windAdjustedMinutes, type PointWeather } from '../lib/weather';
import { CALL } from './FleetWeather';
import { deliveryStage, StageChips } from './EventFeed';
import { windText } from './Header';
import { TerrainProfile } from './TerrainProfile';

export type { PickTarget };

export interface Review {
  plan: Plan;
  errors: string[];
}

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
  /** Chase and Onboard views: only the flying summary, about 300 px wide. */
  compact: boolean;
  /** A mission copied from the PartyRock dispatch app; the card loads and plans it. */
  incoming: Mission | null;
}

/** What an imported mission keeps when the card rebuilds it for the live drone. */
const fromFields = (m: Mission | null) =>
  m ? { mode: m.mode, landingType: m.landingType, aiRationale: m.aiRationale } : {};

type StepState = { status: StepStatus; detail?: string };
type Steps = Record<StepId, StepState>;
type Phase = 'idle' | 'sending' | 'flying';
type DestWeather = { status: 'loading' } | { status: 'failed' } | { status: 'ok'; w: PointWeather };

/** What was sent, kept so the flying card survives the operator touching the map. */
interface Flight {
  plan: Plan;
  dest: Point;
  /** Newest event id when the mission was sent: older events belong to earlier flights. */
  baselineId: string | undefined;
}

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

// shortcut: at most 4 payload rows so the card never needs an inner scroll, raise it if a mission needs more.
const MAX_ROWS = 4;
const nextRowId = (rows: PayloadRow[]) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const shortLabel = (p: Point) => `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m >= 1 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

const ICON = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PointRow({
  caption,
  point,
  active,
  onToggle,
  onSet,
}: {
  caption: string;
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
    if (p) onSet(p);
    if (p || draft.trim() === '') setDraft(null);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-[5.5rem] shrink-0 text-[13px] font-semibold text-sub">{caption}</span>
        {draft === null ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
            {point ? shortLabel(point) : 'Not set'}
          </span>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            ref={(el) => el?.focus()}
            aria-label={`${caption} as latitude, longitude`}
            aria-invalid={bad}
            placeholder="lat, lon"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setDraft(null);
            }}
            className="min-h-11 min-w-0 flex-1 rounded-xl border-0 bg-fill px-3 font-mono text-[13px] text-ink outline-none"
          />
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={active}
          aria-label={active ? `Click the map to set ${caption}` : `Pick ${caption} on the map`}
          className={`btn flex size-11 shrink-0 items-center justify-center p-0 ${active ? 'btn-primary' : 'btn-quiet'}`}
        >
          <svg aria-hidden="true" {...ICON}>
            <circle cx="12" cy="12" r="7" />
            <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setDraft(point ? `${point.lat}, ${point.lon}` : '')}
          aria-label={`Edit ${caption} as text`}
          className="btn btn-quiet flex size-11 shrink-0 items-center justify-center p-0"
        >
          <svg aria-hidden="true" {...ICON}>
            <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1z" />
          </svg>
        </button>
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
  const common = { ...ICON, strokeWidth: 2.4 };
  if (status === 'done')
    return (
      <svg aria-hidden="true" {...common} stroke="var(--color-green-ink)">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  if (status === 'failed')
    return (
      <svg aria-hidden="true" {...common} stroke="var(--color-red-ink)">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  if (status === 'active')
    return (
      <svg aria-hidden="true" {...common} stroke="var(--color-accent)" className="motion-safe:animate-spin">
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
    );
  return (
    <svg aria-hidden="true" {...common} stroke="var(--color-sub)">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-xl bg-card p-2.5">
      <dt className="text-xs text-sub">{label}</dt>
      <dd className="m-0 font-mono text-base">{value}</dd>
    </div>
  );
}

/** The card's height follows its content with a critically damped ease, so stage changes resize smoothly. */
function Resizing({ stageKey, children }: { stageKey: string; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    setH(el.offsetHeight);
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      style={{ height: h }}
      className="overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
    >
      <div ref={inner}>
        <div key={stageKey} className="stage-in flex flex-col gap-3.5">
          {children}
        </div>
      </div>
    </div>
  );
}

export function DeliveryCard({
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
  compact,
  incoming,
}: Props) {
  const [rows, setRows] = useState<PayloadRow[]>([{ id: 1, item: 'GDEX parcel', qty: 1, kgEach: 1.2 }]);
  const [from, setFrom] = useState<Mission | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Steps>(INITIAL_STEPS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [flight, setFlight] = useState<Flight | null>(null);
  const sending = phase === 'sending' && Object.values(steps).some((s) => s.status === 'active');
  // Flying weather at the destination, fetched when the review opens (and again if the destination changes).
  // Each result is keyed by its destination, so a stale one reads as loading without a reset in the effect.
  const wxKey = review && dest ? `${dest.lat},${dest.lon}` : null;
  const [wx, setWx] = useState<{ key: string; result: DestWeather } | null>(null);
  useEffect(() => {
    if (!wxKey) return;
    const [lat, lon] = wxKey.split(',').map(Number);
    const ctl = new AbortController();
    fetchPointWeather(lat, lon, ctl.signal)
      .then((w) => setWx({ key: wxKey, result: { status: 'ok', w } }))
      .catch(() => {
        if (!ctl.signal.aborted) setWx({ key: wxKey, result: { status: 'failed' } });
      });
    return () => ctl.abort();
  }, [wxKey]);
  const destWeather: DestWeather = wx && wx.key === wxKey ? wx.result : { status: 'loading' };
  const call = destWeather.status === 'ok' ? flyCall(destWeather.w) : null;
  const held = call?.call === 'no_go';

  const total = payloadTotalKg(rows);
  const over = total > ARK1.maxPayloadKg;
  const rowsOk = rows.length > 0 && rows.every((r) => r.item.trim() && r.qty >= 1 && r.kgEach > 0);
  const canPlan = !!start && !!dest && rowsOk && !over && !planning;
  const canSend = !!review && review.errors.length === 0 && !sending && drone.conn === 'connected';
  const canSendNow = canSend && !held;

  // Events from this flight only.
  const baseIdx = flight?.baselineId ? drone.events.findIndex((e) => e.id === flight.baselineId) : -1;
  const fresh: DroneEvent[] = baseIdx >= 0 ? drone.events.slice(0, baseIdx) : drone.events;
  const stage = deliveryStage(fresh);
  const finished = phase === 'flying' && (stage === 'home' || stage === 'aborted');

  const editRows = (next: PayloadRow[]) => {
    setRows(next);
    setPlanError(null);
    onReview(null);
  };
  const patchRow = (id: number, patch: Partial<PayloadRow>) =>
    editRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // A PartyRock mission fills the card and plans at once; one that lands mid-flight waits until the card is idle.
  const imported = useRef<string | null>(null);
  useEffect(() => {
    if (!incoming || phase !== 'idle' || imported.current === incoming.id) return;
    imported.current = incoming.id;
    const next = incoming.payload.map((p, i) => ({
      id: i + 1,
      item: p.item,
      qty: p.qty,
      kgEach: p.weightKg / p.qty,
    }));
    onSetPoint('start', incoming.origin);
    onSetPoint('dest', incoming.destination);
    setRows(next);
    setFrom(incoming);
    void plan(incoming.origin, incoming.destination, next, incoming);
    // plan and onSetPoint are recreated each render; the id guard makes this run once per mission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, phase]);

  async function plan(s = start, d = dest, r = rows, src = from) {
    if (!s || !d) return;
    setPlanning(true);
    setPlanError(null);
    setSteps(INITIAL_STEPS);
    try {
      const res = await planRoute({ start: s, dest: d, payloadKg: payloadTotalKg(r), elevationAt });
      if (!res.ok) {
        onReview(null);
        setPlanError(res.reason);
        return;
      }
      const draft = buildMission({
        droneId,
        start: s,
        dest: d,
        plan: res.plan,
        payload: r,
        ...fromFields(src),
      });
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
    const mission = buildMission({
      droneId,
      start,
      dest,
      plan: review.plan,
      payload: rows,
      ...fromFields(from),
    });
    const check = validateMission(mission);
    if (!check.ok) {
      onReview({ plan: review.plan, errors: check.errors });
      return;
    }
    setSteps(INITIAL_STEPS);
    setFlight({ plan: review.plan, dest, baselineId: drone.snapshot().events[0]?.id });
    setPhase('sending');
    drone.clearTrack();
    try {
      await sendMission(drone, droneId, mission, (id, status, detail) =>
        setSteps((s) => ({ ...s, [id]: { status, detail } })),
      );
      setPhase('flying');
    } catch {
      // The failed step already shows the message; the card stays on the steps for Retry / Edit.
    }
  }

  const backToPlan = () => {
    setFrom(null);
    setPhase('idle');
    setSteps(INITIAL_STEPS);
    setFlight(null);
    onReview(null);
  };

  const failed = Object.values(steps).some((s) => s.status === 'failed');
  const key =
    phase === 'idle'
      ? review
        ? 'review'
        : 'plan'
      : phase === 'sending'
        ? 'sending'
        : finished
          ? 'done'
          : 'flying';

  if (compact && key !== 'flying' && key !== 'done') return null;

  const f = flight;
  const t = drone.telemetry;
  let body: ReactNode = null;

  if (key === 'plan') {
    body = (
      <>
        <h2 className="m-0 text-[17px] font-semibold tracking-tight">Plan a delivery</h2>
        <div className="flex flex-col gap-1">
          <PointRow
            caption="Start"
            point={start}
            active={picking === 'start'}
            onToggle={() => onPicking(picking === 'start' ? null : 'start')}
            onSet={(p) => onSetPoint('start', p)}
          />
          <PointRow
            caption="Destination"
            point={dest}
            active={picking === 'dest'}
            onToggle={() => onPicking(picking === 'dest' ? null : 'dest')}
            onSet={(p) => onSetPoint('dest', p)}
          />
          <p className="m-0 text-xs text-sub">Search, click the map, or drag the pins</p>
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
                <svg aria-hidden="true" className="mx-auto" {...ICON} width={16} height={16}>
                  <path d="M6 12h12" />
                </svg>
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn btn-quiet"
              disabled={rows.length >= MAX_ROWS}
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

        <button type="button" className="btn btn-primary" disabled={!canPlan} onClick={() => void plan()}>
          {planning ? 'Reading terrain…' : 'Plan route'}
        </button>
        {planError && (
          <div className="rounded-xl bg-red-tint p-3 text-[13px] leading-snug text-red-ink" role="alert">
            {planError}
          </div>
        )}
      </>
    );
  } else if (key === 'review' && review) {
    body = (
      <>
        <h2 className="m-0 text-[17px] font-semibold tracking-tight">Review route</h2>
        {from && (
          <div className="flex flex-col gap-1 rounded-xl bg-fill p-2.5" aria-label="From PartyRock">
            <span className="text-[13px] font-semibold">
              From PartyRock · {from.mode} · {from.landingType} landing
            </span>
            <span className="text-xs text-sub">
              AI picked {from.droneId}; the live sim flies it as {droneId}.
              {from.aiRationale ? ` ${from.aiRationale}` : ''}
            </span>
          </div>
        )}
        <dl className="m-0 grid grid-cols-3 gap-2">
          <Stat label="Distance" value={`${review.plan.distanceKm.toFixed(1)} km`} />
          <Stat label="ETA" value={`${Math.round(review.plan.etaMinutes)} min`} />
          <Stat label="Climb" value={`${Math.round(review.plan.climbM)} m`} />
        </dl>
        <TerrainProfile profile={review.plan.profile} liveKm={null} />
        <div className="flex flex-col gap-1 rounded-xl bg-fill p-2.5" aria-label="Flying weather">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">Flying weather</span>
            {call && (
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${CALL[call.call].cls}`}
              >
                {CALL[call.call].label}
              </span>
            )}
          </div>
          {destWeather.status === 'loading' && (
            <span className="text-xs text-sub">Checking the weather…</span>
          )}
          {destWeather.status === 'failed' && <span className="text-xs text-sub">Weather unavailable</span>}
          {destWeather.status === 'ok' && start && dest && (
            <>
              <span className="text-xs text-sub">
                wind {destWeather.w.windMs.toFixed(1)} m/s from {Math.round(destWeather.w.windFromDeg)}° ·
                gust {destWeather.w.gustMs.toFixed(0)} · rain {destWeather.w.rainMmH.toFixed(0)} mm/h
              </span>
              <span className="text-xs text-sub">
                ETA with wind:{' '}
                {Math.round(
                  windAdjustedMinutes(
                    review.plan.distanceKm,
                    bearingDeg(start, dest),
                    destWeather.w.windMs,
                    destWeather.w.windFromDeg,
                  ),
                )}{' '}
                min
              </span>
              {held && call && (
                <span id="wx-hold-reason" className="text-[13px] font-semibold text-red-ink" role="alert">
                  {call.reason}
                </span>
              )}
            </>
          )}
        </div>
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
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSendNow}
            aria-describedby={held ? 'wx-hold-reason' : undefined}
            onClick={send}
          >
            Send to {droneId}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => onReview(null)}>
            Edit
          </button>
          {drone.conn !== 'connected' && (
            <span className="text-xs text-sub">Waiting for the MQTT broker.</span>
          )}
        </div>
      </>
    );
  } else if (key === 'sending') {
    body = (
      <>
        <h2 className="m-0 text-[17px] font-semibold tracking-tight">Sending to {droneId}</h2>
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Send progress" aria-live="polite">
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
        {failed && (
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={!canSend} onClick={send}>
              Retry
            </button>
            <button type="button" className="btn btn-quiet flex-1" onClick={backToPlan}>
              Edit
            </button>
          </div>
        )}
      </>
    );
  } else if (key === 'flying' && f) {
    const totalKm = f.plan.distanceKm || 1;
    const flown = liveKm ?? 0;
    const pct = Math.max(0, Math.min(1, flown / totalKm));
    const left = Math.max(0, totalKm - flown);
    const speed = t?.groundSpeedMs ?? 0;
    const etaMin = speed > 1 ? left / ((speed * 60) / 1000) : undefined;
    const batt = t ? Math.round(Math.max(0, Math.min(100, t.batteryPct))) : undefined;
    body = (
      <>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 text-[15px] font-semibold tracking-tight">Delivering</h2>
          <span className="truncate font-mono text-[13px] text-sub">{shortLabel(f.dest)}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Route progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
          className="h-1.5 rounded-sm bg-hair"
        >
          <div className="h-1.5 rounded-sm bg-accent" style={{ width: `${pct * 100}%` }} />
        </div>
        <dl className="m-0 grid grid-cols-3 gap-2">
          <Stat label="ETA" value={etaMin === undefined ? '—' : `${Math.max(1, Math.round(etaMin))} min`} />
          <Stat label="Left" value={`${left.toFixed(1)} km`} />
          <Stat label="Battery" value={batt === undefined ? '—' : `${batt}%`} />
        </dl>
        <StageChips stage={stage ?? 'outbound'} />
      </>
    );
  } else if (key === 'done' && f) {
    const startEv = [...fresh].reverse().find((e) => e.type === 'mission_started' || e.type === 'takeoff');
    const end = fresh[0];
    const ms = startEv && end ? Date.parse(end.ts) - Date.parse(startEv.ts) : NaN;
    body = (
      <>
        <h2 className="m-0 text-[17px] font-semibold tracking-tight">
          {stage === 'aborted' ? 'Mission aborted' : 'Delivered, home safe'}
        </h2>
        <dl className="m-0 grid grid-cols-2 gap-2">
          <Stat label="Flight time" value={Number.isFinite(ms) ? fmtDuration(ms) : '—'} />
          <Stat label="Route" value={`${f.plan.distanceKm.toFixed(1)} km`} />
        </dl>
        <button type="button" className="btn btn-primary" onClick={backToPlan}>
          New delivery
        </button>
      </>
    );
  }

  return (
    <section
      aria-label={key === 'flying' || key === 'done' ? 'Delivery in flight' : 'Plan a delivery'}
      style={{ maxWidth: compact ? 300 : 380 }}
      className="glass max-h-[calc(100dvh-7rem)] w-full overflow-hidden rounded-[22px] p-4 transition-[max-width] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
    >
      <Resizing stageKey={key}>{body}</Resizing>
    </section>
  );
}
