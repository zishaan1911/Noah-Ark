import { useState } from 'react';
import type { CommandType } from '@contracts';
import type { DroneApi } from '../hooks/useDrone';
import { buildCommand } from '../lib/commands';
import { sendCommand } from '../lib/flightOps';

interface Props {
  droneId: string;
  drone: DroneApi;
}

const BUTTONS: { type: CommandType; label: string }[] = [
  { type: 'hold', label: 'Hold' },
  { type: 'rtl', label: 'Return home' },
  { type: 'land', label: 'Land' },
];

export function FlightControls({ droneId, drone }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const armed = drone.telemetry?.armed === true;
  const off = !armed || busy || drone.conn !== 'connected';

  async function run(type: CommandType, label: string) {
    setConfirming(false);
    setBusy(true);
    setNote(null);
    try {
      await sendCommand(drone, buildCommand(type, droneId));
      setNote({ ok: true, text: `${label} accepted` });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Flight controls" className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2">
        {BUTTONS.map((b) => (
          <button
            key={b.type}
            type="button"
            className="btn btn-quiet"
            disabled={off}
            onClick={() => run(b.type, b.label)}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          className="btn bg-red-tint text-red-ink"
          disabled={off}
          onClick={() => setConfirming(true)}
        >
          Abort
        </button>
      </div>
      {confirming && (
        <div
          className="flex flex-col gap-2 rounded-xl bg-red-tint p-3"
          role="alertdialog"
          aria-label="Confirm abort"
        >
          <span className="text-[13px] font-semibold text-red-ink">Abort the mission?</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn flex-1 bg-danger text-white"
              disabled={off}
              onClick={() => run('abort', 'Abort')}
            >
              Abort now
            </button>
            <button type="button" className="btn btn-quiet flex-1" onClick={() => setConfirming(false)}>
              Keep flying
            </button>
          </div>
        </div>
      )}
      {!armed && <span className="text-xs text-sub">Controls unlock when the drone is armed.</span>}
      <span
        role="status"
        className={`text-[13px] ${note ? (note.ok ? 'text-green-ink' : 'text-red-ink') : 'sr-only'}`}
      >
        {note?.text}
      </span>
    </section>
  );
}
