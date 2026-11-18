export interface SpringState {
  x: number;
  v: number;
}

/**
 * One step of a critically damped spring (damping ratio 1, no overshoot), implicit so it stays stable at any dt.
 * `response` is the time in seconds to reach the target, like Apple's spring response.
 */
export function springStep(s: SpringState, target: number, response: number, dt: number): void {
  const omega = (2 * Math.PI) / response;
  const f = 1 + 2 * dt * omega;
  const hoo = dt * omega * omega;
  const hhoo = dt * hoo;
  const inv = 1 / (f + hhoo);
  const x = (f * s.x + dt * s.v + hhoo * target) * inv;
  const v = (s.v + hoo * (target - s.x)) * inv;
  s.x = x;
  s.v = v;
}
