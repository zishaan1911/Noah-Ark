import { useEffect, useMemo, useState } from 'react';
import type { CommandType, DroneEvent } from '@contracts';
import { DefenceTelemetry } from '../components/DefenceTelemetry';
import { TacticalMap } from '../components/TacticalMap';
import { useDrone } from '../hooks/useDrone';
import { ARK1 } from '../lib/ark1';
import { buildCommand, buildMission, payloadTotalKg } from '../lib/commands';
import { DRONE_ID, MQTT_URL, OPERATOR_INITIALS } from '../lib/config';
import {
  OUTPOSTS,
  REQUESTS,
  ZONES,
  ZONE_MARGIN_KM,
  outpost,
  planPath,
  type DefencePlan,
  type Priority,
} from '../lib/defence';
import { sendCommand, sendMission, type StepId, type StepStatus } from '../lib/flightOps';
import { elevationAt } from '../lib/terrain';
import { validateMission } from '../lib/validate';
import { flyCall } from '../lib/weather';
import '../styles/defence.css';

const PRIORITY: Record<Priority, { label: string; tone: string; solid?: boolean }> = {
  flash: { label: 'FLASH', tone: 'var(--dt-red)', solid: true },
  immediate: { label: 'IMMEDIATE', tone: 'var(--dt-amber)' },
  priority: { label: 'PRIORITY', tone: 'var(--dt-dim)' },
};
const STEPS: { id: StepId; label: string }[] = [
  { id: 'position', label: 'PLACE UNIT AT MAIN BASE' },
  { id: 'upload', label: 'UPLOAD MISSION' },
  { id: 'start', label: 'LAUNCH' },
];
const COMMANDS: { type: CommandType; label: string; amber?: boolean }[] = [
  { type: 'hold', label: 'HOLD POSITION' },
  { type: 'rtl', label: 'RETURN TO BASE' },
  { type: 'land', label: 'LAND NOW', amber: true },
];

const zulu = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
const logLine = (e: DroneEvent) =>
  `${e.type.replace(/_/g, ' ').toUpperCase()}${e.message ? ` · ${e.message.toUpperCase()}` : ''}`;

type Steps = Record<StepId, { status: StepStatus; detail?: string }>;
const idle = (): Steps => ({
  position: { status: 'pending' },
  upload: { status: 'pending' },
  start: { status: 'pending' },
});

/** Defence logistics terminal: military resupply on the live simulated flight, in the green-on-black console look. */
export function DefenceOps() {
  const drone = useDrone(DRONE_ID, MQTT_URL);
  const t = drone.telemetry;
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string>(REQUESTS[0].id);
  const [plan, setPlan] = useState<{ id: string; plan: DefencePlan } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [second, setSecond] = useState(false);
  const [steps, setSteps] = useState<Steps>(idle);
  const [sending, setSending] = useState(false);
  const [cmdNote, setCmdNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<{ ts: number; text: string; tone?: string }[]>([]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const req = REQUESTS.find((r) => r.id === selectedId) ?? REQUESTS[0];
  const to = outpost(req.to);
  const kg = payloadTotalKg(req.payload);
  const current = plan?.id === req.id ? plan.plan : null;
  const note = (text: string, tone?: string) =>
    setNotes((n) => [{ ts: Date.now(), text, tone }, ...n].slice(0, 20));

  const sim = drone.sim;
  const wx =
    sim && Number.isFinite(sim.windMs)
      ? flyCall({ windMs: sim.windMs, gustMs: sim.windMs * 1.5, rainMmH: 0 })
      : null;
  const checks = current
    ? [
        {
          ok: kg <= ARK1.maxPayloadKg,
          text: `PAYLOAD ${kg.toFixed(2)} KG ≤ ${ARK1.maxPayloadKg.toFixed(2)} KG`,
        },
        {
          ok: current.distanceKm <= ARK1.rangeOutKm,
          text: `RANGE ${current.distanceKm.toFixed(1)} KM OUT ≤ ${ARK1.rangeOutKm} KM`,
        },
        {
          ok: current.minClearanceKm >= ZONE_MARGIN_KM,
          text: `THREAT ZONES · CLEARS BY ${current.minClearanceKm.toFixed(1)} KM (MIN ${ZONE_MARGIN_KM})`,
        },
        {
          ok: wx === null || wx.call !== 'no_go',
          wait: wx === null,
          text: wx
            ? `WEATHER · ${wx.call.toUpperCase().replace('_', '-')} · WIND ${sim?.windMs.toFixed(1)} M/S`
            : 'WEATHER · WAITING FOR SIM',
        },
        {
          ok: drone.conn === 'connected',
          text: drone.conn === 'connected' ? 'LINK · BROKER CONNECTED' : 'LINK · BROKER DOWN',
        },
        {
          ok: second,
          wait: !second,
          text: second ? 'SECOND OPERATOR · CONFIRMED' : 'SECOND OPERATOR · AWAITING',
        },
      ]
    : [];
  const canLaunch = !!current && checks.every((c) => c.ok) && !sending;

  async function doPlan() {
    setPlanning(true);
    setPlanError(null);
    setSecond(false);
    setSteps(idle());
    try {
      const res = await planPath(req.path, kg, elevationAt);
      if (!res.ok) {
        setPlan(null);
        setPlanError(res.reason);
        return;
      }
      setPlan({ id: req.id, plan: res.plan });
      note(
        `PLAN ${req.id} · ${res.plan.distanceKm.toFixed(1)} KM${res.plan.detourKm > 0.05 ? ` · BENT ${res.plan.detourKm.toFixed(1)} KM AROUND THREAT ZONE` : ''}`,
      );
    } catch (err) {
      setPlanError(`TERRAIN UNAVAILABLE · ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPlanning(false);
    }
  }

  async function launch() {
    if (!current || !to) return;
    const base = OUTPOSTS[0];
    const mission = buildMission({
      droneId: DRONE_ID,
      start: base,
      dest: to,
      plan: current,
      payload: req.payload,
      mode: 'military',
    });
    const v = validateMission(mission);
    if (!v.ok) {
      setPlanError(`MISSION INVALID · ${v.errors.join('; ')}`);
      return;
    }
    setSending(true);
    setSteps(idle());
    drone.clearTrack();
    note(`AUTHORISED ${req.id} · OPR ${OPERATOR_INITIALS} + SECOND OPERATOR`, 'var(--dt-bright)');
    try {
      await sendMission(drone, DRONE_ID, mission, (id, status, detail) =>
        setSteps((s) => ({ ...s, [id]: { status, detail } })),
      );
      note(`${DRONE_ID} LAUNCHED · ${req.id} → ${to.name}`, 'var(--dt-bright)');
    } catch (err) {
      note(
        `LAUNCH FAILED · ${err instanceof Error ? err.message.toUpperCase() : String(err)}`,
        'var(--dt-red)',
      );
    } finally {
      setSending(false);
      setSecond(false);
    }
  }

  async function command(type: CommandType, label: string) {
    setCmdNote(null);
    try {
      await sendCommand(drone, buildCommand(type, DRONE_ID));
      setCmdNote({ ok: true, text: `${label} · ACCEPTED` });
      note(`${label} SENT TO ${DRONE_ID} · ACCEPTED`);
    } catch (err) {
      setCmdNote({ ok: false, text: err instanceof Error ? err.message.toUpperCase() : String(err) });
    }
  }

  const log = useMemo(() => {
    const ev = drone.events.map((e) => ({
      ts: Date.parse(e.ts),
      text: logLine(e),
      tone:
        e.severity === 'critical'
          ? 'var(--dt-red)'
          : e.severity === 'warning'
            ? 'var(--dt-amber)'
            : undefined,
    }));
    return [...ev, ...notes].sort((a, b) => b.ts - a.ts).slice(0, 9);
  }, [drone.events, notes]);

  const pose = t ? { lat: t.position.lat, lon: t.position.lon, headingDeg: t.headingDeg ?? 0 } : null;
  const flash = REQUESTS.filter((r) => r.priority === 'flash').length;

  return (
    <div className="dt">
      <div
        style={{
          background: '#0e2a15',
          color: 'var(--dt-bright)',
          textAlign: 'center',
          fontSize: 12,
          letterSpacing: '0.18em',
          padding: '4px 16px',
          fontWeight: 600,
        }}
      >
        UNCLASSIFIED // EXERCISE KESTREL // DEMO DATA
      </div>

      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px 28px',
          padding: '14px 24px',
          borderBottom: '1px solid var(--dt-line)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="dt-big" style={{ fontSize: 32 }}>
            ARK COMMAND
          </span>
          <span style={{ color: 'var(--dt-dim)', letterSpacing: '0.12em' }}>
            // DEFENCE LOGISTICS TERMINAL
          </span>
        </div>
        <span
          style={{
            border: '1px solid var(--dt-green)',
            padding: '2px 10px',
            letterSpacing: '0.14em',
            fontWeight: 600,
          }}
        >
          MODE: MILITARY
        </span>
        <nav aria-label="Page" style={{ display: 'flex', gap: 4 }}>
          <a href="#" style={{ padding: '4px 12px', textDecoration: 'none' }}>
            DRONE
          </a>
          <a href="#/fleet" style={{ padding: '4px 12px', textDecoration: 'none' }}>
            FLEET
          </a>
          <a
            href="#/defence"
            aria-current="page"
            style={{
              background: 'var(--dt-green)',
              color: 'var(--dt-bg)',
              padding: '4px 12px',
              textDecoration: 'none',
              fontWeight: 600,
              textShadow: 'none',
            }}
          >
            DEFENCE
          </a>
        </nav>
        <div
          role="status"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 22px',
            color: 'var(--dt-dim)',
          }}
        >
          <span>
            LINK{' '}
            <span style={{ color: drone.conn === 'connected' ? 'var(--dt-green)' : 'var(--dt-amber)' }}>
              {drone.conn === 'connected' ? 'BROKER ●' : drone.conn.toUpperCase()}
            </span>
          </span>
          <span>
            SIM{' '}
            <span style={{ color: sim?.state === 'ready' ? 'var(--dt-green)' : 'var(--dt-amber)' }}>
              {sim ? sim.state.toUpperCase() : 'OFFLINE'}
            </span>
          </span>
          <span style={{ color: 'var(--dt-bright)' }}>{zulu(new Date(now))}</span>
          <span>
            OPR <span style={{ color: 'var(--dt-bright)' }}>{OPERATOR_INITIALS}</span>
          </span>
        </div>
      </header>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          padding: '14px 24px',
          borderBottom: '1px solid var(--dt-line)',
        }}
      >
        {[
          {
            label: `LIVE UNIT ${DRONE_ID}`,
            value: t ? t.flightMode : 'NO DATA',
            tone: t?.armed ? 'var(--dt-bright)' : undefined,
          },
          { label: 'PACK', value: t ? `${Math.round(t.batteryPct)}%` : '—' },
          { label: 'REQUESTS OPEN', value: String(REQUESTS.length) },
          { label: 'FLASH PRIORITY', value: String(flash), tone: 'var(--dt-red)' },
          { label: 'THREAT ZONES', value: `${ZONES.length} NO-FLY`, tone: 'var(--dt-amber)' },
        ].map((k) => (
          <div
            key={k.label}
            style={{
              flex: '1 1 170px',
              border: '1px solid var(--dt-line)',
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span className="dt-label">{k.label}</span>
            <span className="dt-big" style={{ fontSize: 36, color: k.tone }}>
              {k.value}
            </span>
          </div>
        ))}
      </div>

      <main style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '16px 24px', flex: '1 1 auto' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section aria-label="Resupply queue" className="dt-panel">
            <h2 className="dt-h2">RESUPPLY QUEUE</h2>
            {REQUESTS.map((r) => {
              const p = PRIORITY[r.priority];
              const o = outpost(r.to);
              return (
                <button
                  key={r.id}
                  type="button"
                  className="dt-row"
                  aria-pressed={r.id === req.id}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                    <span style={{ color: 'var(--dt-bright)', fontWeight: 600 }}>{r.id}</span>
                    <span
                      style={
                        p.solid
                          ? {
                              background: p.tone,
                              color: 'var(--dt-bg)',
                              padding: '0 6px',
                              fontWeight: 600,
                              textShadow: 'none',
                            }
                          : { border: `1px solid ${p.tone}`, color: p.tone, padding: '0 6px' }
                      }
                    >
                      {p.label}
                    </span>
                  </span>
                  <span>
                    {o?.name} · {r.payload.map((i) => `${i.item.toUpperCase()} ×${i.qty}`).join(', ')}
                  </span>
                  <span style={{ color: r.path.length ? 'var(--dt-dim)' : 'var(--dt-amber)' }}>
                    {r.path.length
                      ? `${payloadTotalKg(r.payload).toFixed(2)} KG`
                      : 'DROP INSIDE TZ-BRAVO · NO ROUTE'}
                  </span>
                </button>
              );
            })}
          </section>

          <section aria-label="Resupply plan" className="dt-panel">
            <h2 className="dt-h2">
              PLAN · {req.id} → {to?.name}
            </h2>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!current && (
                <button
                  type="button"
                  className="dt-btn"
                  onClick={doPlan}
                  disabled={planning || req.path.length < 2}
                >
                  {planning
                    ? 'READING TERRAIN…'
                    : req.path.length < 2
                      ? 'HELD · NO SAFE ROUTE'
                      : 'PLAN ROUTE'}
                </button>
              )}
              {planError && (
                <p role="alert" style={{ margin: 0, color: 'var(--dt-red)' }}>
                  {planError}
                </p>
              )}
              {current && (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
                    <span>
                      <span style={{ color: 'var(--dt-dim)' }}>OUT</span> {current.distanceKm.toFixed(1)} KM
                    </span>
                    <span>
                      <span style={{ color: 'var(--dt-dim)' }}>DETOUR</span> +{current.detourKm.toFixed(1)} KM
                    </span>
                    <span>
                      <span style={{ color: 'var(--dt-dim)' }}>ETA</span> {Math.round(current.etaMinutes)} MIN
                    </span>
                    <span>
                      <span style={{ color: 'var(--dt-dim)' }}>MAX ALT</span> {Math.round(current.climbM)} M
                    </span>
                  </div>
                  <ul
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    {checks.map((c) => (
                      <li key={c.text}>
                        <span
                          style={{
                            color: c.ok ? 'var(--dt-green)' : c.wait ? 'var(--dt-amber)' : 'var(--dt-red)',
                            fontWeight: 600,
                          }}
                        >
                          [{c.ok ? 'GO' : c.wait ? 'WAIT' : 'NO-GO'}]
                        </span>{' '}
                        {c.text}
                      </li>
                    ))}
                  </ul>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 44,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={second}
                      onChange={(e) => setSecond(e.target.checked)}
                      style={{ width: 18, height: 18, accentColor: '#4dff7a' }}
                    />
                    SECOND OPERATOR CONFIRMS
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="dt-btn dt-btn-solid"
                      onClick={launch}
                      disabled={!canLaunch}
                      style={{ flex: '1 1 200px' }}
                    >
                      [F5] AUTHORISE LAUNCH
                    </button>
                    <button type="button" className="dt-btn" onClick={() => setPlan(null)} disabled={sending}>
                      REPLAN
                    </button>
                  </div>
                  <ol
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    {STEPS.map((s) => {
                      const st = steps[s.id];
                      const tone =
                        st.status === 'done'
                          ? 'var(--dt-green)'
                          : st.status === 'failed'
                            ? 'var(--dt-red)'
                            : st.status === 'active'
                              ? 'var(--dt-amber)'
                              : 'var(--dt-dim)';
                      return (
                        <li key={s.id} style={{ color: tone }}>
                          {st.status === 'done'
                            ? '■'
                            : st.status === 'active'
                              ? '▶'
                              : st.status === 'failed'
                                ? '✕'
                                : '□'}{' '}
                          {s.label}
                          {st.detail && (
                            <span style={{ display: 'block', paddingLeft: 18 }}>
                              {st.detail.toUpperCase()}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
            </div>
          </section>
        </div>

        <section
          aria-label="Tactical map"
          className="dt-panel"
          style={{ flex: '999 1 560px', borderColor: '#2a6b3a' }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: '6px 12px',
              padding: '8px 12px',
              background: 'var(--dt-panel)',
              borderBottom: '1px solid var(--dt-line)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 12, letterSpacing: '0.16em' }}>
              TACTICAL PICTURE · SECTOR 7 · DARVEL BAY
            </h2>
            <span style={{ color: 'var(--dt-dim)' }}>
              {pose ? `${pose.lat.toFixed(4)}°N ${pose.lon.toFixed(4)}°E` : '05°05′N 118°22′E'}
            </span>
          </div>
          <div style={{ position: 'relative', minHeight: 520, flex: '1 1 auto' }}>
            <div style={{ position: 'absolute', inset: 0 }}>
              <TacticalMap requests={REQUESTS} selectedId={req.id} track={drone.track} drone={pose} />
            </div>
            <div
              style={{
                position: 'absolute',
                left: 12,
                top: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                fontSize: 11.5,
                background: 'rgba(3,7,3,0.82)',
                border: '1px solid var(--dt-line)',
                padding: '6px 8px',
              }}
            >
              <span>━ ━ SELECTED ROUTE · {req.id}</span>
              <span style={{ color: '#ff8a78' }}>· · · DIRECT LINE · BLOCKED</span>
              <span style={{ color: 'var(--dt-bright)' }}>━━ FLOWN TRACK · {DRONE_ID}</span>
            </div>
          </div>
        </section>

        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section aria-label="Live telemetry" className="dt-panel">
            <h2 className="dt-h2">LIVE TELEMETRY · {DRONE_ID} · SITL</h2>
            <DefenceTelemetry telemetry={t} now={now} />
          </section>
          <section aria-label="Commands" className="dt-panel" style={{ borderColor: 'var(--dt-green)' }}>
            <h2 className="dt-h2">COMMANDS</h2>
            <div
              style={{
                padding: 12,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 8,
              }}
            >
              {COMMANDS.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  className={`dt-btn${c.amber ? ' dt-btn-amber' : ''}`}
                  disabled={!t?.armed || drone.conn !== 'connected'}
                  onClick={() => void command(c.type, c.label)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {cmdNote && (
              <p
                role="status"
                style={{
                  margin: 0,
                  padding: '0 12px 12px',
                  color: cmdNote.ok ? 'var(--dt-green)' : 'var(--dt-red)',
                }}
              >
                {cmdNote.text}
              </p>
            )}
          </section>
        </div>
      </main>

      <section
        aria-label="Event log"
        style={{
          margin: '0 24px 16px',
          border: '1px solid var(--dt-line)',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          fontSize: 12.5,
          background: '#030703',
        }}
      >
        {log.length === 0 && (
          <span style={{ color: 'var(--dt-dim)' }}>
            NO EVENTS SINCE THIS SCREEN OPENED · PLAN A REQUEST TO BEGIN
          </span>
        )}
        {log.map((l, i) => (
          <span key={`${l.ts}-${i}`} style={{ color: l.tone }}>
            <span style={{ color: 'var(--dt-dim)' }}>{zulu(new Date(l.ts))}</span> {l.text}
          </span>
        ))}
        <span style={{ color: 'var(--dt-bright)' }}>
          &gt; <span className="dt-cursor">█</span>
        </span>
      </section>

      <footer
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 24px',
          padding: '8px 24px 14px',
          color: 'var(--dt-dim)',
          borderTop: '1px solid var(--dt-line)',
        }}
      >
        <span>LIVE FLIGHT: ARK-1 SITL AIRFRAME (2 KG) · ARK-1M CARRIES 4 KG</span>
        <span style={{ marginLeft: 'auto' }}>
          UNARMED RESUPPLY · NO WEAPONS CARRIED · MAP © OPENSTREETMAP, OPENFREEMAP
        </span>
      </footer>
    </div>
  );
}
