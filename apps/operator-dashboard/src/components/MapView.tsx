import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LngLat, Map as MapLibreMap, Marker, type GeoJSONSource } from 'maplibre-gl';
import {
  CHASE_DEFAULT,
  CHASE_FOV_DEG,
  GIMBAL_DEFAULT,
  chaseCamera,
  dragChase,
  dragGimbal,
  gimbalCamera,
  isChaseDefault,
  isGimbalDefault,
  zoomChasePinch,
  zoomChaseWheel,
  zoomGimbalPinch,
  zoomGimbalWheel,
  type ChaseRig,
  type Gimbal,
} from '../lib/cameraRig';
import { createDroneLayer, type DroneLayer, type ModelStatus } from '../lib/droneLayer';
import { PAPAR } from '../lib/config';
import {
  BASE_STYLE_URL,
  DEM_SOURCE,
  EMPTY_FC,
  ROUTE_SOURCE,
  TRACK_SOURCE,
  addArkLayers,
  applyTheme,
  lineFeature,
} from '../lib/mapStyle';
import { prefersReducedMotion } from '../lib/prefs';
import { springStep, type SpringState } from '../lib/spring';
import type { MapFocus, PickTarget, Point, Pose, Theme, View } from '../lib/types';
import '../styles/map.css';

interface Props {
  view: View;
  theme: Theme;
  getPose: () => Pose | null;
  armed: boolean;
  /** The flown path as [lon, lat]. */
  track: [number, number][];
  start: Point | null;
  dest: Point | null;
  /** The planned route, start to destination. */
  route: Point[] | null;
  picking: PickTarget | null;
  /** Map click while picking. */
  onPick: (p: Point) => void;
  /** A pin was dragged, or right-click / long-press (always 'dest'). */
  onMovePoint: (target: PickTarget, p: Point) => void;
  /** Map view: fly here whenever `seq` changes. */
  focus: MapFocus | null;
  children?: ReactNode;
}

const CHASE_RESPONSE_S = 0.35;
const ONBOARD_DROP_M = 0.25;
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
const FADE_MS = 280;
const MAP_BG = { light: '#F4F1EA', dark: '#1C1F24' } as const;

const BOX_SVG =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>';
const DRONE_SVG =
  '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/><rect x="10" y="10" width="4" height="4" rx="1"/></svg>';
const RESET_SVG =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

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
  onDragEnd: (p: Point) => void,
) {
  if (!point) {
    ref.current?.remove();
    ref.current = null;
  } else if (ref.current) {
    ref.current.setLngLat([point.lon, point.lat]);
  } else {
    const marker = new Marker({ element: make(), anchor: 'center', draggable: true })
      .setLngLat([point.lon, point.lat])
      .addTo(map);
    marker.on('dragend', () => {
      const ll = marker.getLngLat();
      onDragEnd({ lat: ll.lat, lon: ll.lng });
    });
    ref.current = marker;
  }
}

/** Owns the one MapLibre map; Map, Chase and Onboard only change its camera and layers. */
export function MapView({
  view,
  theme,
  getPose,
  armed,
  track,
  start,
  dest,
  route,
  picking,
  onPick,
  onMovePoint,
  focus,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const layerRef = useRef<DroneLayer | null>(null);
  const droneMarkerRef = useRef<Marker | null>(null);
  const startMarkerRef = useRef<Marker | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);
  const defaultFovRef = useRef(36.87);
  const prevViewRef = useRef<View>('map');
  const viewRef = useRef(view);
  const themeRef = useRef(theme);
  const pickingRef = useRef(picking);
  const onPickRef = useRef(onPick);
  const onMovePointRef = useRef(onMovePoint);
  const focusRef = useRef(focus);
  const chaseRef = useRef<ChaseRig>({ ...CHASE_DEFAULT });
  const gimbalRef = useRef<Gimbal>({ ...GIMBAL_DEFAULT });
  const fadeFramesRef = useRef(0); // frames left before the cross-fade starts, so the jump lands first
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [moved, setMoved] = useState({ chase: false, onboard: false });

  useEffect(() => {
    viewRef.current = view;
    themeRef.current = theme;
    pickingRef.current = picking;
    onPickRef.current = onPick;
    onMovePointRef.current = onMovePoint;
    focusRef.current = focus;
  }, [view, theme, picking, onPick, onMovePoint, focus]);

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
      applyTheme(map, themeRef.current);
      map.setTerrain({ source: DEM_SOURCE, exaggeration: 1 }); // keep 1 so heights are real
      defaultFovRef.current = map.getVerticalFieldOfView();
      const layer = createDroneLayer(setModelStatus);
      map.addLayer(layer);
      layer.setTheme(themeRef.current);
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

    // Right-click moves the destination, but a right-drag rotates the map and must not.
    let rotatedAt = -Infinity;
    map.on('rotateend', () => {
      rotatedAt = performance.now();
    });
    map.on('contextmenu', (e) => {
      if (viewRef.current !== 'map' || map.isMoving() || performance.now() - rotatedAt < 300) return;
      onMovePointRef.current('dest', { lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    // Touch long-press does the same.
    const canvasBox = map.getCanvasContainer();
    let pressTimer = 0;
    let pressAt = { x: 0, y: 0 };
    const cancelPress = () => window.clearTimeout(pressTimer);
    const onTouchStart = (e: TouchEvent) => {
      cancelPress();
      if (viewRef.current !== 'map' || e.touches.length !== 1) return;
      const t = e.touches[0];
      pressAt = { x: t.clientX, y: t.clientY };
      pressTimer = window.setTimeout(() => {
        const rect = canvasBox.getBoundingClientRect();
        const ll = map.unproject([pressAt.x - rect.left, pressAt.y - rect.top]);
        onMovePointRef.current('dest', { lat: ll.lat, lon: ll.lng });
      }, LONG_PRESS_MS);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (
        e.touches.length !== 1 ||
        Math.hypot(t.clientX - pressAt.x, t.clientY - pressAt.y) > LONG_PRESS_SLOP_PX
      )
        cancelPress();
    };
    canvasBox.addEventListener('touchstart', onTouchStart, { passive: true });
    canvasBox.addEventListener('touchmove', onTouchMove, { passive: true });
    canvasBox.addEventListener('touchend', cancelPress);
    canvasBox.addEventListener('touchcancel', cancelPress);

    return () => {
      cancelPress();
      canvasBox.removeEventListener('touchstart', onTouchStart);
      canvasBox.removeEventListener('touchmove', onTouchMove);
      canvasBox.removeEventListener('touchend', cancelPress);
      canvasBox.removeEventListener('touchcancel', cancelPress);
      setReady(false);
      droneMarkerRef.current = null;
      startMarkerRef.current = null;
      destMarkerRef.current = null;
      layerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Light / Dark, recoloured in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyTheme(map, theme);
    layerRef.current?.setTheme(theme);
  }, [ready, theme]);

  // Start and destination markers; flat pins would cover the 3D drone and the view, so only Map view shows them.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    syncMarker(
      startMarkerRef,
      map,
      start,
      () => pinElement('Start', 'background:#F5A524', BOX_SVG),
      (p) => onMovePointRef.current('start', p),
    );
    syncMarker(
      destMarkerRef,
      map,
      dest,
      () =>
        pinElement(
          'Destination',
          'width:22px;height:22px;background:#fff;border:5px solid #0A84FF;box-sizing:border-box',
        ),
      (p) => onMovePointRef.current('dest', p),
    );
    for (const m of [startMarkerRef.current, destMarkerRef.current]) {
      if (m) m.getElement().style.display = view === 'map' ? '' : 'none';
    }
  }, [ready, start, dest, view]);

  // Planned route, and frame it in Map view.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
    if (!route || route.length < 2) {
      src?.setData(EMPTY_FC);
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
    src?.setData(track.length > 1 ? lineFeature(track) : EMPTY_FC);
  }, [ready, track]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getCanvas().style.cursor = picking ? 'crosshair' : '';
  }, [ready, picking]);

  useEffect(() => {
    layerRef.current?.setArmed(armed);
  }, [ready, armed]);

  // Map view: fly to a search result.
  const focusSeq = focus?.seq;
  useEffect(() => {
    const map = mapRef.current;
    const f = focusRef.current;
    if (!ready || !map || !f || viewRef.current !== 'map') return;
    setFollow(false);
    const target = { center: [f.point.lon, f.point.lat] as [number, number], zoom: f.zoom };
    if (prefersReducedMotion()) map.jumpTo(target);
    else map.flyTo(target);
  }, [ready, focusSeq]);

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
    layer.setVisible(view === 'chase');
    // Chase and Onboard aim the camera at a drone in the air; a ground-clamped centre would drag it to the terrain.
    map.setCenterClampedToGround(free);

    if (prevViewRef.current !== view && !prefersReducedMotion() && fadeRef.current) {
      const fade = fadeRef.current;
      fade.style.transition = 'none';
      fade.style.background = MAP_BG[themeRef.current];
      fade.style.opacity = '1';
      fadeFramesRef.current = 2;
    }

    if (view === 'chase') {
      map.setVerticalFieldOfView(CHASE_FOV_DEG); // MapLibre 6 exposes the vertical field of view
    } else if (view === 'onboard') {
      map.setVerticalFieldOfView(gimbalRef.current.fovDeg);
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

  // Chase and Onboard gestures. MapLibre's own handlers are off there, so these own the canvas.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const box = map.getCanvasContainer();
    const pointers = new Map<number, { x: number; y: number }>();
    const span = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const syncMoved = () => {
      const next = { chase: !isChaseDefault(chaseRef.current), onboard: !isGimbalDefault(gimbalRef.current) };
      setMoved((m) => (m.chase === next.chase && m.onboard === next.onboard ? m : next));
    };
    const applyFov = () => map.setVerticalFieldOfView(gimbalRef.current.fovDeg);
    const active = () => viewRef.current === 'chase' || viewRef.current === 'onboard';

    const drag = (dx: number, dy: number) => {
      if (viewRef.current === 'chase') {
        chaseRef.current = dragChase(chaseRef.current, dx, dy);
      } else {
        const degPerPx = gimbalRef.current.fovDeg / Math.max(1, box.clientHeight);
        gimbalRef.current = dragGimbal(gimbalRef.current, dx, dy, degPerPx);
      }
    };
    const zoom = (apply: (c: ChaseRig) => ChaseRig, applyG: (g: Gimbal) => Gimbal) => {
      if (viewRef.current === 'chase') chaseRef.current = apply(chaseRef.current);
      else {
        gimbalRef.current = applyG(gimbalRef.current);
        applyFov();
      }
    };

    const onDown = (e: PointerEvent) => {
      if (!active() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      box.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev || !active()) return;
      if (pointers.size === 2) {
        const before = span();
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const ratio = before > 0 ? span() / before : 1;
        zoom(
          (c) => zoomChasePinch(c, ratio),
          (g) => zoomGimbalPinch(g, ratio),
        );
      } else if (pointers.size === 1) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drag(e.clientX - prev.x, e.clientY - prev.y);
      }
      syncMoved();
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      if (!active()) return;
      e.preventDefault();
      zoom(
        (c) => zoomChaseWheel(c, e.deltaY),
        (g) => zoomGimbalWheel(g, e.deltaY),
      );
      syncMoved();
    };
    const onDouble = () => {
      if (!active()) return;
      if (viewRef.current === 'chase') chaseRef.current = { ...CHASE_DEFAULT };
      else {
        gimbalRef.current = { ...GIMBAL_DEFAULT };
        applyFov();
      }
      syncMoved();
    };

    box.addEventListener('pointerdown', onDown);
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp);
    box.addEventListener('pointercancel', onUp);
    box.addEventListener('wheel', onWheel, { passive: false });
    box.addEventListener('dblclick', onDouble);
    return () => {
      box.removeEventListener('pointerdown', onDown);
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerup', onUp);
      box.removeEventListener('pointercancel', onUp);
      box.removeEventListener('wheel', onWheel);
      box.removeEventListener('dblclick', onDouble);
    };
  }, [ready]);

  // Every animation frame: move the drone and, in Chase and Onboard, the camera.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const marker = droneMarkerRef.current;
    if (!ready || !map || !layer || !marker) return;
    const reduced = prefersReducedMotion();
    const el = marker.getElement();
    const heading = el.querySelector<HTMLElement>('.heading');
    // The spring follows the moving drone; the user's orbit is applied on top of it, undamped.
    const anchor: Record<'lat' | 'lon' | 'alt', SpringState> = {
      lat: { x: 0, v: 0 },
      lon: { x: 0, v: 0 },
      alt: { x: 0, v: 0 },
    };
    let anchorReady = false;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
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
        if (!anchorReady || reduced) {
          anchor.lat.x = pose.lat;
          anchor.lon.x = pose.lon;
          anchor.alt.x = pose.altAmslM;
          anchor.lat.v = anchor.lon.v = anchor.alt.v = 0;
          anchorReady = true;
        } else {
          springStep(anchor.lat, pose.lat, CHASE_RESPONSE_S, dt);
          springStep(anchor.lon, pose.lon, CHASE_RESPONSE_S, dt);
          springStep(anchor.alt, pose.altAmslM, CHASE_RESPONSE_S, dt);
        }
        const { from } = chaseCamera(
          { ...pose, lat: anchor.lat.x, lon: anchor.lon.x, altAmslM: anchor.alt.x },
          chaseRef.current,
        );
        map.jumpTo(
          map.calculateCameraOptionsFromTo(
            new LngLat(from.lon, from.lat),
            from.altAmslM,
            new LngLat(pose.lon, pose.lat),
            pose.altAmslM,
          ),
        );
      } else {
        const cam = gimbalCamera(pose, gimbalRef.current);
        map.jumpTo(
          map.calculateCameraOptionsFromCameraLngLatAltRotation(
            [pose.lon, pose.lat],
            pose.altAmslM - ONBOARD_DROP_M,
            cam.bearingDeg,
            cam.pitchDeg,
            pose.rollDeg,
          ),
        );
      }
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      frame(now);
      const fade = fadeRef.current;
      if (fadeFramesRef.current > 0 && --fadeFramesRef.current === 0 && fade) {
        void fade.offsetWidth; // flush the opacity 1 style so the transition runs from it
        fade.style.transition = `opacity ${FADE_MS}ms ease-out`;
        fade.style.opacity = '0';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, view, follow, getPose]);

  const resetCamera = () => {
    const map = mapRef.current;
    if (view === 'chase') chaseRef.current = { ...CHASE_DEFAULT };
    else {
      gimbalRef.current = { ...GIMBAL_DEFAULT };
      map?.setVerticalFieldOfView(GIMBAL_DEFAULT.fovDeg);
    }
    setMoved((m) => ({ ...m, [view]: false }));
  };

  const pickText =
    picking === 'start' ? 'Click the map to set the start' : 'Click the map to set the destination';

  return (
    <div className="relative size-full">
      {/* size-full, not inset-0: maplibre-gl.css (unlayered) forces position: relative over Tailwind's layer */}
      <div ref={containerRef} className="absolute inset-0 size-full" />
      <div ref={fadeRef} className="map-fade" aria-hidden="true" />
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
      {view !== 'map' && moved[view] && (
        <button type="button" aria-label="Reset camera" onClick={resetCamera} className="glass map-reset">
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: RESET_SVG }} />
          Reset camera
        </button>
      )}
      {view === 'chase' && modelStatus === 'error' && (
        <div
          className="glass absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-[13px] font-semibold text-amber-ink"
          role="status"
        >
          3D model not loaded: /models/ark1.glb
        </div>
      )}
      {children}
    </div>
  );
}
