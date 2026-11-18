import type { ReactNode } from 'react';
import type { DroneApi } from '../hooks/useDrone';
import type { Point } from '../lib/types';
import { BottomSheet, type Detent } from './BottomSheet';
import type { Review } from './DeliveryCard';
import { EventFeed } from './EventFeed';
import { FlightControls } from './FlightControls';
import { LiveCard } from './LiveCard';

interface Props {
  droneId: string;
  drone: DroneApi;
  groundM: number | null;
  review: Review | null;
  detent: Detent;
  onDetent: (d: Detent) => void;
  /** Extra controls between the flight controls and the event feed (the manual-fly toggle). */
  extra?: ReactNode;
}

function Peek({ drone, groundM }: Pick<Props, 'drone' | 'groundM'>) {
  const t = drone.telemetry;
  if (!t) return <p className="m-0 text-sm text-sub">No telemetry yet</p>;
  const agl = groundM !== null && t.altAmslM !== undefined ? Math.round(t.altAmslM - groundM) : null;
  const batt = Math.round(Math.max(0, Math.min(100, t.batteryPct)));
  return (
    <dl className="m-0 grid grid-cols-4 gap-2 font-mono text-[13px]">
      {[
        [t.armed ? 'Armed' : 'Disarmed', t.flightMode],
        ['Battery', `${batt}%`],
        ['Alt AGL', agl === null ? '—' : `${agl} m`],
        ['Speed', t.groundSpeedMs === undefined ? '—' : `${t.groundSpeedMs.toFixed(1)} m/s`],
      ].map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col">
          <dt className="truncate font-sans text-xs text-sub">{k}</dt>
          <dd className="m-0 truncate font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The live flight sheet: peek row, then the live card, controls, extra slot and events. */
export function LiveSheet({ droneId, drone, groundM, review, detent, onDetent, extra }: Props) {
  const last = review?.plan.waypoints.at(-1);
  const dest: Point | null = last ? { lat: last.lat, lon: last.lon } : null;
  return (
    <BottomSheet detent={detent} onDetent={onDetent} peek={<Peek drone={drone} groundM={groundM} />}>
      <LiveCard droneId={droneId} telemetry={drone.telemetry} dest={dest} groundM={groundM} />
      <FlightControls droneId={droneId} drone={drone} />
      {extra}
      <EventFeed events={drone.events} />
    </BottomSheet>
  );
}
