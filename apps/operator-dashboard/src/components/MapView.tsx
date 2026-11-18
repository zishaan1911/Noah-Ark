import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LngLat, Map as MapLibreMap, Marker, type GeoJSONSource } from 'maplibre-gl';
import { createDroneLayer, type DroneLayer, type ModelStatus } from '../lib/droneLayer';
import { PAPAR } from '../lib/config';
import { destinationPoint } from '../lib/geo';
import { BASE_STYLE_URL, DEM_SOURCE, ROUTE_SOURCE, TRACK_SOURCE, addArkLayers } from '../lib/mapStyle';
import { prefersReducedMotion } from '../lib/prefs';
import { springStep, type SpringState } from '../lib/spring';
import type { Point, Pose, View } from '../lib/types';

interface Props {
  view: View;
  getPose: () => Pose | null;
  armed: boolean;
  /** The flown path as [lon, lat]. */
  track: [number, number][];
  start: Point | null;
  dest: Point | null;
  /** The planned route, start to destination. */
  route: Point[] | null;
  picking: 'start' | 'dest' | null;
  onPick: (p: Point) => void;
  children?: ReactNode;
}

const CHASE_BACK_M = 11; // close enough that the 1.5 m airframe reads clearly
const CHASE_UP_M = 3.5;
const CHASE_RESPONSE_S = 0.35;
const ONBOARD_DROP_M = 0.25;
const GIMBAL_PITCH_DEG = 60; // MapLibre pitch counts from straight down, so 30 degrees below the horizon is 60
const ONBOARD_FOV_DEG = 80;

const EMPTY = { type: 'FeatureCollection' as const, features: [] };
const lineFeature = (coords: [number, number][]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: coords },
});

const BOX_SVG =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>';
const DRONE_SVG =
  '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/><rect x="10" y="10" width="4" height="4" rx="1"/></svg>';

function pinElement(label: string, dotStyle: string, inner = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ark-pin';
  el.innerHTML = `<span class="ark-pin-dot" style="${dotStyle}">${inner}</span><span class="ark-pin-label">${label}</span>`;
  return el;
}

function dronePinElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ark-drone-pin';
  el.setAttribute('aria-label', 'Drone position');
  el.innerHTML = `<div class="heading"><svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true"><path d="M28 1 L34 11 L22 11 Z" fill="#0A84FF" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div><div class="core">${DRONE_SVG}</div>`;
  el.style.display = 'none';
  return el;
}

function syncMarker(
  ref: { current: Marker | null },
  map: MapLibreMap,
  point: Point | null,
  make: () => HTMLElement,
) {
  if (!point) {
    ref.current?.remove();
    ref.current = null;
  } else if (ref.current) {
    ref.current.setLngLat([point.lon, point.lat]);
  } else {
    ref.current = new Marker({ element: make(), anchor: 'center' })
      .setLngLat([point.lon, point.lat])
      .addTo(map);
  }
}

/** Owns the one MapLibre map; Map, Chase and Onboard only change its camera and layers. */
export function MapView({
  view,
  getPose,
  armed,
  track,
  start,
  dest,
  route,
  picking,
  onPick,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const layerRef = useRef<DroneLayer | null>(null);
  const droneMarkerRef = useRef<Marker | null>(null);
  const startMarkerRef = useRef<Marker | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);
  const defaultFovRef = useRef(36.87);
  const prevViewRef = useRef<View>('map');
  const viewRef = useRef(view);
  const pickingRef = useRef(picking);
  const onPickRef = useRef(onPick);
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');

  useEffect(() => {
    viewRef.current = view;
    pickingRef.current = picking;
    onPickRef.current = onPick;
  }, [view, picking, onPick]);

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new MapLibreMap({
      container,
      style: BASE_STYLE_URL,
      center: [PAPAR.lon, PAPAR.lat],
      zoom: 12,
      maxPitch: 85,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on('load', () => {
      addArkLayers(map);
      map.setTerrain({ source: DEM_SOURCE, exaggeration: 1 }); // keep 1 so heights are real
      defaultFovRef.current = map.getVerticalFieldOfView();
      const layer = createDroneLayer(setModelStatus);
      map.addLayer(layer);
      layerRef.current = layer;
      droneMarkerRef.current = new Marker({ element: dronePinElement(), anchor: 'center' })
        .setLngLat([PAPAR.lon, PAPAR.lat])
        .addTo(map);
      setReady(true);
    });
    map.on('click', (e) => {
      if (pickingRef.current) onPickRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    map.on('dragstart', () => setFollow(false));
    return () => {
      setReady(false);
      droneMarkerRef.current = null;
      startMarkerRef.current = null;
      destMarkerRef.current = null;
      layerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Start and destination markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    syncMarker(startMarkerRef, map, start, () => pinElement('Start', 'background:#F5A524', BOX_SVG));
    syncMarker(destMarkerRef, map, dest, () =>
      pinElement(
        'Destination',
        'width:22px;height:22px;background:#fff;border:5px solid #0A84FF;box-sizing:border-box',
      ),
    );
  }, [ready, start, dest]);

  // Planned route, and frame it in Map view.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
    if (!route || route.length < 2) {
      src?.setData(EMPTY);
      return;
    }
    src?.setData(lineFeature(route.map((p): [number, number] => [p.lon, p.lat])));
    if (viewRef.current !== 'map') return;
    const lons = route.map((p) => p.lon);
    const lats = route.map((p) => p.lat);
    const wide = window.innerWidth >= 1024;
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      {
        padding: { top: wide ? 110 : 40, bottom: 60, left: wide ? 420 : 40, right: wide ? 420 : 40 },
        maxZoom: 16,
        duration: prefersReducedMotion() ? 0 : 800,
      },
    );
  }, [ready, route]);

  // Flown track.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource(TRACK_SOURCE) as GeoJSONSource | undefined;
    src?.setData(track.length > 1 ? lineFeature(track) : EMPTY);
  }, [ready, track]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getCanvas().style.cursor = picking ? 'crosshair' : '';
  }, [ready, picking]);

  useEffect(() => {
    layerRef.current?.setArmed(armed);
  }, [ready, armed]);

  // What each view shows and how much the user may move the camera.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!ready || !map || !layer) return;
    const free = view === 'map';
    const handlers = [
      map.dragPan,
      map.dragRotate,
      map.scrollZoom,
      map.touchZoomRotate,
      map.touchPitch,
      map.keyboard,
      map.doubleClickZoom,
      map.boxZoom,
    ];
    for (const h of handlers) {
      if (free) h.enable();
      else h.disable();
    }
    for (const m of [startMarkerRef.current, destMarkerRef.current]) {
      if (m) m.getElement().style.display = free ? '' : 'none'; // flat pins would cover the 3D drone and the view
    }
    layer.setVisible(view === 'chase');
    // Chase and Onboard aim the camera at a drone in the air; a ground-clamped centre would drag it to the terrain.
    map.setCenterClampedToGround(free);

    if (view === 'onboard') {
      map.setVerticalFieldOfView(ONBOARD_FOV_DEG); // MapLibre 6 exposes the vertical field of view
    } else if (Math.abs(map.getVerticalFieldOfView() - defaultFovRef.current) > 0.01) {
      map.setVerticalFieldOfView(defaultFovRef.current);
    }
    if (free) {
      if (prevViewRef.current !== 'map') {
        const pose = getPose();
        map.jumpTo({ pitch: 0, bearing: 0, zoom: 13, center: pose ? [pose.lon, pose.lat] : map.getCenter() });
      }
      map.setMaxPitch(50);
    } else {
      map.setMaxPitch(85);
    }
    prevViewRef.current = view;
  }, [ready, view, getPose]);

  // Every animation frame: move the drone and, in Chase and Onboard, the camera.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const marker = droneMarkerRef.current;
    if (!ready || !map || !layer || !marker) return;
    const reduced = prefersReducedMotion();
    const el = marker.getElement();
    const heading = el.querySelector<HTMLElement>('.heading');
    const cam: Record<'lat' | 'lon' | 'alt', SpringState> = {
      lat: { x: 0, v: 0 },
      lon: { x: 0, v: 0 },
      alt: { x: 0, v: 0 },
    };
    let camReady = false;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pose = getPose();
      if (!pose) {
        el.style.display = 'none';
        return;
      }
      layer.setPose(pose);

      if (view === 'map') {
        el.style.display = '';
        marker.setLngLat([pose.lon, pose.lat]);
        if (heading) heading.style.transform = `rotate(${pose.headingDeg}deg)`;
        if (follow) map.jumpTo({ center: [pose.lon, pose.lat] });
        return;
      }
      el.style.display = 'none';

      if (view === 'chase') {
        const back = destinationPoint(pose, pose.headingDeg + 180, CHASE_BACK_M);
        const alt = pose.altAmslM + CHASE_UP_M;
        if (!camReady || reduced) {
          cam.lat.x = back.lat;
          cam.lon.x = back.lon;
          cam.alt.x = alt;
          cam.lat.v = cam.lon.v = cam.alt.v = 0;
          camReady = true;
        } else {
          springStep(cam.lat, back.lat, CHASE_RESPONSE_S, dt);
          springStep(cam.lon, back.lon, CHASE_RESPONSE_S, dt);
          springStep(cam.alt, alt, CHASE_RESPONSE_S, dt);
        }
        map.jumpTo(
          map.calculateCameraOptionsFromTo(
            new LngLat(cam.lon.x, cam.lat.x),
            cam.alt.x,
            new LngLat(pose.lon, pose.lat),
            pose.altAmslM,
          ),
        );
      } else {
        map.jumpTo(
          map.calculateCameraOptionsFromCameraLngLatAltRotation(
            [pose.lon, pose.lat],
            pose.altAmslM - ONBOARD_DROP_M,
            pose.headingDeg,
            GIMBAL_PITCH_DEG,
            pose.rollDeg,
          ),
        );
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, view, follow, getPose]);

  const pickText =
    picking === 'start' ? 'Click the map to set the start' : 'Click the map to set the destination';

  return (
    <div className="relative size-full">
      {/* size-full, not inset-0: maplibre-gl.css (unlayered) forces position: relative over Tailwind's layer */}
      <div ref={containerRef} className="absolute inset-0 size-full" />
      {picking && (
        <div
          className="glass absolute top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-[13px] font-semibold lg:top-24"
          role="status"
        >
          {pickText}
        </div>
      )}
      {view === 'map' && (
        <button
          type="button"
          aria-pressed={follow}
          aria-label="Follow the drone"
          onClick={() => setFollow((f) => !f)}
          className={`btn absolute bottom-6 left-1/2 -translate-x-1/2 ${follow ? 'btn-primary' : 'glass text-ink'}`}
        >
          Follow
        </button>
      )}
      {view === 'chase' && modelStatus === 'error' && (
        <div
          className="glass absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-[13px] font-semibold text-amber-ink"
          role="status"
        >
          3D model not loaded: /models/ark1.glb
        </div>
      )}
      {children}
    </div>
  );
}
