import type { ManualControl } from '@contracts';
import type { Stick } from './types';

// The gateway clamps these again onboard; the UI limits are for feel, not safety.
export const MANUAL = { cruiseMs: 6, boostMs: 10, climbMs: 3, yawDegS: 45 };

const ACCEL_MS2 = 12;
const YAW_ACCEL_DEGS2 = 120;

export const ZERO_STICK: Stick = { forwardMs: 0, rightMs: 0, upMs: 0, yawRateDegS: 0 };

/** Every `KeyboardEvent.code` the manual mode handles. */
export const MANUAL_KEYS: ReadonlySet<string> = new Set([
  'KeyW',
  'ArrowUp',
  'KeyS',
  'ArrowDown',
  'KeyA',
  'KeyD',
  'ArrowLeft',
  'KeyQ',
  'ArrowRight',
  'KeyE',
  'KeyR',
  'KeyF',
  'ShiftLeft',
  'ShiftRight',
  'Space',
]);

const has = (p: ReadonlySet<string>, ...codes: string[]) => codes.some((c) => p.has(c));
const axis = (pos: boolean, neg: boolean) => (pos ? 1 : 0) - (neg ? 1 : 0);

export function stickFromKeys(pressed: ReadonlySet<string>): Stick {
  if (pressed.has('Space')) return { ...ZERO_STICK };
  const limit = has(pressed, 'ShiftLeft', 'ShiftRight') ? MANUAL.boostMs : MANUAL.cruiseMs;
  let fwd = axis(has(pressed, 'KeyW', 'ArrowUp'), has(pressed, 'KeyS', 'ArrowDown'));
  let right = axis(pressed.has('KeyD'), pressed.has('KeyA'));
  const len = Math.hypot(fwd, right);
  if (len > 1) {
    fwd /= len;
    right /= len;
  }
  return {
    forwardMs: fwd * limit,
    rightMs: right * limit,
    upMs: axis(pressed.has('KeyR'), pressed.has('KeyF')) * MANUAL.climbMs,
    yawRateDegS: axis(has(pressed, 'ArrowRight', 'KeyE'), has(pressed, 'ArrowLeft', 'KeyQ')) * MANUAL.yawDegS,
  };
}

function slew(prev: number, target: number, maxStep: number): number {
  const d = target - prev;
  return Math.abs(d) <= maxStep ? target : prev + Math.sign(d) * maxStep;
}

/** Moves each axis toward the target at a bounded rate, so a key press never steps the drone. */
export function smooth(prev: Stick, target: Stick, dt: number): Stick {
  const v = ACCEL_MS2 * dt;
  return {
    forwardMs: slew(prev.forwardMs, target.forwardMs, v),
    rightMs: slew(prev.rightMs, target.rightMs, v),
    upMs: slew(prev.upMs, target.upMs, v),
    yawRateDegS: slew(prev.yawRateDegS, target.yawRateDegS, YAW_ACCEL_DEGS2 * dt),
  };
}

export function packet(droneId: string, seq: number, stick: Stick, issuedBy: string): ManualControl {
  return { droneId, ts: new Date().toISOString(), seq, ...stick, issuedBy };
}
