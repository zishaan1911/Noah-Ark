import { useMemo, useState } from 'react';
import type { Detent } from '../components/BottomSheet';
import { DeliveryCard, type Review } from '../components/DeliveryCard';
import { Header } from '../components/Header';
import { LiveSheet } from '../components/LiveSheet';
import { ManualFly } from '../components/ManualFly';
import { MapView } from '../components/MapView';
import { MiniMap } from '../components/MiniMap';
import { OnboardHud } from '../components/OnboardHud';
import { SearchBox } from '../components/SearchBox';
import { useDrone } from '../hooks/useDrone';
import { useGroundElevation } from '../hooks/useGroundElevation';
import { useInterpolatedPose } from '../hooks/useInterpolatedPose';
import { useManualControl } from '../hooks/useManualControl';
import { useTheme } from '../hooks/useTheme';
import { buildCommand } from '../lib/commands';
import { DRONE_ID, MQTT_URL } from '../lib/config';
import { sendCommand } from '../lib/flightOps';
import { haversineKm } from '../lib/geo';
import type { MapFocus, PickTarget, Point, View } from '../lib/types';

const OPERATOR = 'Zishaan Ahmed';

/** GDEX operator's job: pick a start and a destination, plan, send to the drone, watch it fly (or fly it). */
export function GdexOps() {
  const drone = useDrone(DRONE_ID, MQTT_URL);
  const getPose = useInterpolatedPose(drone.telemetry);
  const t = drone.telemetry;
  const groundM = useGroundElevation(t?.position.lat, t?.position.lon);
  const [theme, toggleTheme] = useTheme();

  const [view, setView] = useState<View>('map');
  const [start, setStart] = useState<Point | null>(null);
  const [dest, setDest] = useState<Point | null>(null);
  const [picking, setPicking] = useState<PickTarget | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [detent, setDetent] = useState<Detent>('peek');
  const [manualOn, setManualOn] = useState(false);

  // The start defaults to where the drone is, once, as soon as telemetry is known.
  if (!start && t) setStart({ lat: t.position.lat, lon: t.position.lon });

  const airborne = t?.armed === true && (t.position.altM ?? 0) > 2;
  const manual = useManualControl({
    droneId: DRONE_ID,
    drone,
    enabled: manualOn && airborne,
    issuedBy: OPERATOR,
  });
  // Landing or disarming ends a manual session on its own (adjusted during render, not in an effect).
  if (manualOn && t && !airborne) setManualOn(false);

  const immersive = view !== 'map';
  const changeView = (v: View) => {
    setView(v);
    if (v !== 'map') setDetent('peek'); // the camera gets the screen
  };

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

  const manualFly = (
    <ManualFly
      armed={t?.armed === true}
      airborne={airborne}
      active={manualOn && manual.active}
      stick={manual.stick}
      onToggle={setManualOn}
      onAfter={(type) => void sendCommand(drone, buildCommand(type, DRONE_ID)).catch(() => undefined)}
    />
  );

  return (
    <div className="relative h-dvh overflow-hidden">
      <div className="absolute inset-0">
        <MapView
          view={view}
          theme={theme}
          getPose={getPose}
          armed={t?.armed === true}
          track={drone.track}
          start={start}
          dest={dest}
          route={route}
          picking={picking}
          onPick={(p) => setPoint(picking ?? 'dest', p)}
          onMovePoint={setPoint}
          focus={focus}
        >
          {view === 'onboard' && (
            <OnboardHud
              telemetry={t}
              groundM={groundM}
              manual={manualOn && manual.active}
              stick={manual.stick}
            />
          )}
        </MapView>
      </div>

      <div className="absolute inset-x-3 top-3 z-10 flex flex-col gap-2 lg:inset-x-4 lg:top-4">
        <Header
          droneId={DRONE_ID}
          view={view}
          onView={changeView}
          conn={drone.conn}
          sim={drone.sim}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        {!immersive && (
          <div className="w-full lg:w-[380px]">
            <SearchBox
              onSelect={(p) => {
                setPoint('dest', p);
                setFocus({ point: p, zoom: 14, seq: Date.now() });
              }}
            />
          </div>
        )}
      </div>

      <aside
        aria-label="Delivery"
        className={`pointer-events-none absolute left-3 z-10 lg:left-4 ${immersive ? 'top-[88px]' : 'top-[148px]'}`}
      >
        <div className="pointer-events-auto">
          <DeliveryCard
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
            compact={immersive}
          />
        </div>
      </aside>

      {immersive && (
        <div className="glass absolute bottom-24 left-4 z-10 hidden h-[150px] w-[220px] overflow-hidden rounded-2xl p-0 lg:block">
          <MiniMap route={route} track={drone.track} getPose={getPose} theme={theme} />
        </div>
      )}

      <LiveSheet
        droneId={DRONE_ID}
        drone={drone}
        groundM={groundM}
        review={review}
        detent={detent}
        onDetent={setDetent}
        extra={manualFly}
      />
    </div>
  );
}
