import { useCallback, useEffect, useRef } from 'react';
import type { Telemetry } from '@contracts';
import { clamp, lerp, lerpAngle } from '../lib/geo';
import type { Pose } from '../lib/types';

interface Sample {
  pose: Pose;
  at: number;
}

const DEFAULT_INTERVAL_MS = 200; // telemetry arrives at 5 Hz
const toPose = (t: Telemetry): Pose => ({
  lat: t.position.lat,
  lon: t.position.lon,
  altAmslM: t.altAmslM ?? t.position.altM ?? 0,
  headingDeg: t.headingDeg ?? 0,
  pitchDeg: t.pitchDeg ?? 0,
  rollDeg: t.rollDeg ?? 0,
});

/**
 * Telemetry is 5 Hz; the cameras need every frame. Returns a stable `getPose()` to call on each
 * requestAnimationFrame. It blends the last two samples (heading along the shortest arc) and lags one sample:
 * when a sample arrives we are still at the previous one, and reach the new one an interval later.
 */
export function useInterpolatedPose(telemetry: Telemetry | null): () => Pose | null {
  const prev = useRef<Sample | null>(null);
  const last = useRef<Sample | null>(null);

  useEffect(() => {
    if (!telemetry) return;
    prev.current = last.current;
    last.current = { pose: toPose(telemetry), at: performance.now() };
  }, [telemetry]);

  return useCallback(() => {
    const b = last.current;
    if (!b) return null;
    const a = prev.current;
    if (!a) return b.pose;
    const interval = clamp(b.at - a.at, 50, 1000) || DEFAULT_INTERVAL_MS;
    const t = clamp((performance.now() - b.at) / interval, 0, 1);
    return {
      lat: lerp(a.pose.lat, b.pose.lat, t),
      lon: lerp(a.pose.lon, b.pose.lon, t),
      altAmslM: lerp(a.pose.altAmslM, b.pose.altAmslM, t),
      headingDeg: lerpAngle(a.pose.headingDeg, b.pose.headingDeg, t),
      pitchDeg: lerp(a.pose.pitchDeg, b.pose.pitchDeg, t),
      rollDeg: lerp(a.pose.rollDeg, b.pose.rollDeg, t),
    };
  }, []);
}
