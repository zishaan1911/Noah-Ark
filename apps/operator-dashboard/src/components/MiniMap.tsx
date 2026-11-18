import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, type GeoJSONSource } from 'maplibre-gl';
import { PAPAR } from '../lib/config';
import {
  BASE_STYLE_URL,
  EMPTY_FC,
  ROUTE_SOURCE,
  TRACK_SOURCE,
  addRouteLayers,
  applyTheme,
  hideBuildingExtrusions,
  lineFeature,
} from '../lib/mapStyle';
import type { Point, Pose, Theme } from '../lib/types';
import '../styles/map.css';

interface Props {
  route: Point[] | null;
  /** The flown path as [lon, lat]. */
  track: [number, number][];
  getPose: () => Pose | null;
  theme: Theme;
}

const ZOOM = 13;
const DOT_SVG =
  '<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path d="M14 1 L21 20 L14 16 L7 20 Z" fill="#0A84FF" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';

/** A flat, north-up, non-interactive overview that follows the drone. The integrator sizes it. */
export function MiniMap({ route, track, getPose, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dotRef = useRef<Marker | null>(null);
  const themeRef = useRef(theme);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new MapLibreMap({
      container,
      style: BASE_STYLE_URL,
      center: [PAPAR.lon, PAPAR.lat],
      zoom: ZOOM,
      interactive: false,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on('load', () => {
      hideBuildingExtrusions(map);
      addRouteLayers(map, 0.7);
      applyTheme(map, themeRef.current);
      const el = document.createElement('div');
      el.innerHTML = DOT_SVG;
      el.setAttribute('aria-label', 'Drone position');
      dotRef.current = new Marker({ element: el, anchor: 'center', rotationAlignment: 'map' })
        .setLngLat([PAPAR.lon, PAPAR.lat])
        .addTo(map);
      setReady(true);
    });
    return () => {
      setReady(false);
      dotRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) applyTheme(map, theme);
  }, [ready, theme]);

  useEffect(() => {
    const src = mapRef.current?.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
    if (!ready) return;
    src?.setData(
      route && route.length > 1 ? lineFeature(route.map((p): [number, number] => [p.lon, p.lat])) : EMPTY_FC,
    );
  }, [ready, route]);

  useEffect(() => {
    const src = mapRef.current?.getSource(TRACK_SOURCE) as GeoJSONSource | undefined;
    if (!ready) return;
    src?.setData(track.length > 1 ? lineFeature(track) : EMPTY_FC);
  }, [ready, track]);

  // Follow the drone every frame.
  useEffect(() => {
    const map = mapRef.current;
    const dot = dotRef.current;
    if (!ready || !map || !dot) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const pose = getPose();
      if (!pose) return;
      dot.setLngLat([pose.lon, pose.lat]).setRotation(pose.headingDeg);
      map.jumpTo({ center: [pose.lon, pose.lat] });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, getPose]);

  return <div ref={containerRef} className="map-mini size-full" />;
}
