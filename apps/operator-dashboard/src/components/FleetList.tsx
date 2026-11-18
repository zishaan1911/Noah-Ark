import type { DroneStatus } from '@contracts';
import type { FleetState } from '../lib/fleet';

interface Props {
  state: FleetState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const DOT: Record<DroneStatus, string> = {
  available: 'bg-green',
  assigned: 'bg-accent',
  in_flight: 'bg-accent',
  charging: 'bg-amber',
  maintenance: 'bg-red',
  offline: 'bg-sub',
};

const batteryColor = (pct: number) => (pct > 40 ? 'bg-green' : pct > 20 ? 'bg-amber' : 'bg-red');

/** Compact table of every drone; click a row to pick it on the map. */
export function FleetList({ state, selectedId, onSelect }: Props) {
  const drones = Object.values(state.drones).sort((a, b) => a.id.localeCompare(b.id));
  return (
    <section aria-label="Drones">
      <table className="w-full border-collapse text-left text-[13px]">
        <caption className="sr-only">Fleet drones</caption>
        <thead>
          <tr className="text-[11px] text-sub">
            <th scope="col" className="pb-1 font-semibold">
              Drone
            </th>
            <th scope="col" className="pb-1 font-semibold">
              Status
            </th>
            <th scope="col" className="pb-1 font-semibold">
              Battery
            </th>
            <th scope="col" className="pb-1 text-right font-semibold">
              ETA
            </th>
          </tr>
        </thead>
        <tbody>
          {drones.map((d) => {
            const eta = d.missionId ? state.missions[d.missionId]?.etaMinutes : undefined;
            const pct = Math.max(0, Math.min(100, Math.round(d.batteryPct)));
            const on = d.id === selectedId;
            return (
              <tr key={d.id} className={on ? 'bg-accent-tint' : undefined}>
                <th scope="row" className="py-0.5 pr-1 font-normal">
                  <button
                    type="button"
                    onClick={() => onSelect(d.id)}
                    aria-pressed={on}
                    className="min-h-8 cursor-pointer rounded-md border-0 bg-transparent px-1 font-mono text-xs font-semibold text-ink"
                  >
                    {d.id}
                  </button>
                </th>
                <td className="py-0.5 pr-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`size-2 shrink-0 rounded-full ${DOT[d.status] ?? 'bg-sub'}`}
                      aria-hidden="true"
                    />
                    {d.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="py-0.5 pr-1">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-10 overflow-hidden rounded-full bg-fill" aria-hidden="true">
                      <span
                        className={`block h-full rounded-full ${batteryColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="tabular-nums text-sub">{pct}%</span>
                  </span>
                </td>
                <td className="py-0.5 text-right tabular-nums text-sub">
                  {eta !== undefined ? `${Math.round(eta)} min` : '–'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
