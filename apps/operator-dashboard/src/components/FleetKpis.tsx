import { fleetWindText, type FleetKpis as Kpis, type FleetStats } from '../lib/fleet';

interface Props {
  kpis: Kpis;
  stats: FleetStats | null;
}

function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-fill px-2.5 py-2">
      <span className="text-[11px] font-semibold text-sub">{label}</span>
      <span className="text-[22px] leading-none font-semibold tracking-tight tabular-nums">
        {value}
        {unit && <span className="ml-0.5 text-xs font-semibold text-sub">{unit}</span>}
      </span>
    </div>
  );
}

export function FleetKpis({ kpis, stats }: Props) {
  const wind = fleetWindText(stats);
  return (
    <section aria-label="Fleet numbers" className="flex flex-col gap-2">
      <div className="grid grid-cols-5 gap-1.5">
        <Tile label="Flying" value={String(kpis.flying)} />
        <Tile label="Queued" value={String(kpis.queued)} />
        <Tile label="Delivered" value={String(kpis.delivered)} />
        <Tile
          label="Avg delivery"
          value={kpis.avgDeliveryMin === null ? '–' : kpis.avgDeliveryMin.toFixed(1)}
          unit={kpis.avgDeliveryMin === null ? undefined : 'min'}
        />
        <Tile
          label="On time"
          value={kpis.onTimePct === null ? '–' : String(kpis.onTimePct)}
          unit={kpis.onTimePct === null ? undefined : '%'}
        />
      </div>
      <p className="m-0 text-xs text-sub">
        {wind ? `${wind} · sim ×${stats?.speedup}` : 'Waiting for fleet stats'}
        {kpis.maintenance > 0 && <span className="text-red-ink"> · {kpis.maintenance} in maintenance</span>}
        {kpis.watch > 0 && <span className="text-amber-ink"> · {kpis.watch} to inspect</span>}
      </p>
    </section>
  );
}
