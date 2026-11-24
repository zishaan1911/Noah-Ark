import { useEffect, useMemo, useState } from 'react';
import { DispatchFeed } from '../components/DispatchFeed';
import { FleetKpis } from '../components/FleetKpis';
import { FleetList } from '../components/FleetList';
import { FleetMap } from '../components/FleetMap';
import { FleetWeather } from '../components/FleetWeather';
import { Header } from '../components/Header';
import { SosInbox } from '../components/SosInbox';
import { useFleet } from '../hooks/useFleet';
import { usePartyRock } from '../hooks/usePartyRock';
import { useTheme } from '../hooks/useTheme';
import { fleetWindText, kpis } from '../lib/fleet';

const EMPTY_AFTER_MS = 5000;

/** Fleet-scale view: every drone on one map, the dispatch queue, and the delivery numbers. */
export function FleetOps() {
  const { conn, state, stats, weather, publish } = useFleet();
  const item = usePartyRock();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const sos = item?.kind === 'sos' && item.sos.id !== dismissedId ? item.sos : null;
  const [radar, setRadar] = useState(true);
  const [theme, toggleTheme] = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setWaited(true), EMPTY_AFTER_MS);
    return () => clearTimeout(id);
  }, []);

  const numbers = useMemo(() => kpis(state, stats), [state, stats]);
  const droneCount = Object.keys(state.drones).length;
  const empty = droneCount === 0 && Object.keys(state.missions).length === 0;

  return (
    <div className="relative h-dvh overflow-hidden">
      <div className="absolute inset-0">
        <FleetMap
          state={state}
          selectedId={selectedId}
          onSelect={setSelectedId}
          theme={theme}
          weather={weather}
          radar={radar}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 bottom-3 z-10 flex flex-col gap-2 lg:inset-x-4 lg:top-4 lg:bottom-4">
        <div className="pointer-events-auto">
          <Header
            page="fleet"
            droneId=""
            fleetCount={droneCount}
            fleetWind={fleetWindText(stats)}
            view="map"
            onView={() => undefined}
            conn={conn}
            sim={null}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </div>
        <div className="flex min-h-0 flex-1 items-start justify-between gap-3">
          <aside
            aria-label="Fleet overview"
            className="glass pointer-events-auto flex max-h-full w-full flex-col gap-4 overflow-y-auto rounded-[18px] p-3.5 lg:w-[380px]"
          >
            {empty && waited && (
              <p role="status" className="m-0 rounded-xl bg-amber-tint p-3 text-sm text-amber-ink">
                Fleet sim not running. Start it with docker compose up fleet.
              </p>
            )}
            {sos && (
              <SosInbox
                key={sos.id}
                sos={sos}
                connected={conn === 'connected'}
                onDispatch={(order) => publish('fleet/orders', order, 1)}
                onDismiss={() => setDismissedId(sos.id)}
              />
            )}
            <FleetKpis kpis={numbers} stats={stats} />
            <FleetWeather weather={weather} stats={stats} radar={radar} onRadar={setRadar} />
            <DispatchFeed missions={state.missions} />
          </aside>
          <aside
            aria-label="Fleet drones"
            className="glass pointer-events-auto hidden max-h-full w-[300px] shrink-0 overflow-y-auto rounded-[18px] p-3.5 lg:block"
          >
            <FleetList state={state} selectedId={selectedId} onSelect={setSelectedId} />
          </aside>
        </div>
      </div>
    </div>
  );
}
