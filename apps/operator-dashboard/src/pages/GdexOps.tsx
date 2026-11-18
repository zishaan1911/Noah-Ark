import { useMemo, useState } from 'react';
import { DeliveryPlanner, type PickTarget, type Review } from '../components/DeliveryPlanner';
import { EventFeed } from '../components/EventFeed';
import { FlightControls } from '../components/FlightControls';
import { Header } from '../components/Header';
import { LiveCard } from '../components/LiveCard';
import { MapView } from '../components/MapView';
import { OnboardHud } from '../components/OnboardHud';
import { useDrone } from '../hooks/useDrone';
import { useGroundElevation } from '../hooks/useGroundElevation';
import { useInterpolatedPose } from '../hooks/useInterpolatedPose';
import { DRONE_ID, MQTT_URL } from '../lib/config';
import { haversineKm } from '../lib/geo';
import type { Point, View } from '../lib/types';

/** GDEX operator's job: pick a start and a destination, plan, send to the drone, watch it fly. */
export function GdexOps() {
  const drone = useDrone(DRONE_ID, MQTT_URL);
  const getPose = useInterpolatedPose(drone.telemetry);
  const t = drone.telemetry;
  const groundM = useGroundElevation(t?.position.lat, t?.position.lon);

  const [view, setView] = useState<View>('map');
  const [start, setStart] = useState<Point | null>(null);
  const [dest, setDest] = useState<Point | null>(null);
  const [picking, setPicking] = useState<PickTarget | null>(null);
  const [review, setReview] = useState<Review | null>(null);

  // The start defaults to where the drone is, once, as soon as telemetry is known.
  if (!start && t) setStart({ lat: t.position.lat, lon: t.position.lon });

  const setPoint = (target: PickTarget, p: Point) => {
    if (target === 'start') setStart(p);
    else setDest(p);
    setPicking(null);
    setReview(null);
  };

  const route = useMemo<Point[] | null>(
    () => (review && start && dest ? [start, ...review.plan.waypoints, dest] : null),
    [review, start, dest],
  );
  const liveKm = review && start && t?.armed ? haversineKm(start, t.position) : null;

  return (
    <div className="flex min-h-dvh flex-col gap-3 lg:relative lg:block lg:h-dvh lg:overflow-hidden">
      <div className="order-2 h-[55vh] lg:absolute lg:inset-0 lg:h-auto">
        <MapView
          view={view}
          getPose={getPose}
          armed={t?.armed === true}
          track={drone.track}
          start={start}
          dest={dest}
          route={route}
          picking={picking}
          onPick={(p) => setPoint(picking ?? 'dest', p)}
        >
          {view === 'onboard' && <OnboardHud telemetry={t} groundM={groundM} />}
        </MapView>
      </div>

      <div className="order-1 p-3 pb-0 lg:absolute lg:inset-x-4 lg:top-4 lg:z-10 lg:p-0">
        <Header droneId={DRONE_ID} view={view} onView={setView} conn={drone.conn} sim={drone.sim} />
      </div>

      <aside
        aria-label="Plan"
        className="order-3 px-3 lg:pointer-events-none lg:absolute lg:top-[88px] lg:bottom-4 lg:left-4 lg:z-10 lg:w-[380px] lg:overflow-y-auto lg:px-0"
      >
        <div className="pointer-events-auto">
          <DeliveryPlanner
            droneId={DRONE_ID}
            drone={drone}
            start={start}
            dest={dest}
            picking={picking}
            onPicking={setPicking}
            onSetPoint={setPoint}
            review={review}
            onReview={setReview}
            liveKm={liveKm}
          />
        </div>
      </aside>

      <aside
        aria-label="Live flight"
        className="order-4 px-3 pb-6 lg:pointer-events-none lg:absolute lg:top-[88px] lg:right-4 lg:bottom-4 lg:z-10 lg:flex lg:w-[380px] lg:flex-col lg:justify-end lg:overflow-y-auto lg:px-0 lg:pb-0"
      >
        <div className="pointer-events-auto flex flex-col gap-3">
          <LiveCard droneId={DRONE_ID} telemetry={t} dest={dest} groundM={groundM} />
          <FlightControls droneId={DRONE_ID} drone={drone} />
          <EventFeed events={drone.events} />
        </div>
      </aside>
    </div>
  );
}
