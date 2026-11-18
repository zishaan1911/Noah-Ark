import { clamp, destinationPoint, normDeg } from './geo';
import type { Pose } from './types';

const rad = (d: number) => (d * Math.PI) / 180;

/** Chase camera orbiting the drone. */
export interface ChaseRig {
  /** Around the drone, relative to its heading; 0 = directly behind. */
  yawOffsetDeg: number;
  elevDeg: number;
  distM: number;
}

/** Onboard gimbal: pan relative to heading, tilt below the horizon, and the lens. */
export interface Gimbal {
  panDeg: number;
  tiltDeg: number;
  fovDeg: number;
}

export interface CameraPosition {
  lat: number;
  lon: number;
  altAmslM: number;
}

export const CHASE_LIMITS = { elevMin: 5, elevMax: 60, distMin: 5, distMax: 60 } as const;
export const GIMBAL_LIMITS = { panMax: 90, tiltMax: 90, fovMin: 40, fovMax: 100 } as const;
export const CHASE_DEFAULT: ChaseRig = { yawOffsetDeg: 0, elevDeg: 18, distM: 14 };
export const GIMBAL_DEFAULT: Gimbal = { panDeg: 0, tiltDeg: 30, fovDeg: 90 };
export const CHASE_FOV_DEG = 55;
export const CHASE_DEG_PER_PX = 0.3;

const ZOOM_PER_WHEEL_UNIT = 0.001;

export function clampChase(r: ChaseRig): ChaseRig {
  return {
    yawOffsetDeg: r.yawOffsetDeg,
    elevDeg: clamp(r.elevDeg, CHASE_LIMITS.elevMin, CHASE_LIMITS.elevMax),
    distM: clamp(r.distM, CHASE_LIMITS.distMin, CHASE_LIMITS.distMax),
  };
}

export function clampGimbal(g: Gimbal): Gimbal {
  return {
    panDeg: clamp(g.panDeg, -GIMBAL_LIMITS.panMax, GIMBAL_LIMITS.panMax),
    tiltDeg: clamp(g.tiltDeg, 0, GIMBAL_LIMITS.tiltMax),
    fovDeg: clamp(g.fovDeg, GIMBAL_LIMITS.fovMin, GIMBAL_LIMITS.fovMax),
  };
}

export const isChaseDefault = (r: ChaseRig) =>
  r.yawOffsetDeg === CHASE_DEFAULT.yawOffsetDeg &&
  r.elevDeg === CHASE_DEFAULT.elevDeg &&
  r.distM === CHASE_DEFAULT.distM;

export const isGimbalDefault = (g: Gimbal) =>
  g.panDeg === GIMBAL_DEFAULT.panDeg &&
  g.tiltDeg === GIMBAL_DEFAULT.tiltDeg &&
  g.fovDeg === GIMBAL_DEFAULT.fovDeg;

/** Camera eye and look-at target for the chase view. Inputs are clamped, so any gesture maths is safe. */
export function chaseCamera(pose: Pose, rig: ChaseRig): { from: CameraPosition; to: CameraPosition } {
  const { yawOffsetDeg, elevDeg, distM } = clampChase(rig);
  const elev = rad(elevDeg);
  const eye = destinationPoint(pose, pose.headingDeg + 180 + yawOffsetDeg, distM * Math.cos(elev));
  return {
    from: { lat: eye.lat, lon: eye.lon, altAmslM: pose.altAmslM + distM * Math.sin(elev) },
    to: { lat: pose.lat, lon: pose.lon, altAmslM: pose.altAmslM },
  };
}

/** MapLibre bearing and pitch for the gimbal; MapLibre pitch counts from straight down. */
export function gimbalCamera(pose: Pose, g: Gimbal): { bearingDeg: number; pitchDeg: number } {
  const { panDeg, tiltDeg } = clampGimbal(g);
  return { bearingDeg: normDeg(pose.headingDeg + panDeg), pitchDeg: 90 - tiltDeg };
}

/** A drag follows the finger: the scene moves with it, so the camera moves the opposite way around the drone. */
export function dragChase(r: ChaseRig, dxPx: number, dyPx: number): ChaseRig {
  return clampChase({
    ...r,
    yawOffsetDeg: r.yawOffsetDeg + dxPx * CHASE_DEG_PER_PX,
    elevDeg: r.elevDeg + dyPx * CHASE_DEG_PER_PX,
  });
}

/** Exponential zoom: wheel `deltaY` > 0 or a pinch that closes (ratio < 1) both move the camera away. */
export function zoomChaseWheel(r: ChaseRig, deltaY: number): ChaseRig {
  return clampChase({ ...r, distM: r.distM * Math.exp(deltaY * ZOOM_PER_WHEEL_UNIT) });
}

/** `spanRatio` = new finger span / previous span. */
export function zoomChasePinch(r: ChaseRig, spanRatio: number): ChaseRig {
  return clampChase({ ...r, distM: r.distM / spanRatio });
}

/** `degPerPx` is the lens angle per screen pixel, so the scene tracks the finger 1:1. */
export function dragGimbal(g: Gimbal, dxPx: number, dyPx: number, degPerPx: number): Gimbal {
  return clampGimbal({ ...g, panDeg: g.panDeg - dxPx * degPerPx, tiltDeg: g.tiltDeg - dyPx * degPerPx });
}

export function zoomGimbalWheel(g: Gimbal, deltaY: number): Gimbal {
  return clampGimbal({ ...g, fovDeg: g.fovDeg * Math.exp(deltaY * ZOOM_PER_WHEEL_UNIT) });
}

/** Spreading the fingers (ratio > 1) narrows the lens. */
export function zoomGimbalPinch(g: Gimbal, spanRatio: number): Gimbal {
  return clampGimbal({ ...g, fovDeg: g.fovDeg / spanRatio });
}
