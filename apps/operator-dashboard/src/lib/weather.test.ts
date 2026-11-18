import { describe, expect, it } from 'vitest';
import { flyCall, windAdjustedMinutes } from './weather';

describe('flyCall', () => {
  it('calls calm air go', () => {
    expect(flyCall({ windMs: 3, gustMs: 5, rainMmH: 0 }).call).toBe('go');
  });
  it('holds for gusts of 16 m/s', () => {
    expect(flyCall({ windMs: 5, gustMs: 16, rainMmH: 0 }).call).toBe('no_go');
  });
  it('flies with caution in 12 mm/h rain', () => {
    expect(flyCall({ windMs: 3, gustMs: 5, rainMmH: 12 }).call).toBe('caution');
  });
  it('holds for a thunderstorm code', () => {
    const r = flyCall({ windMs: 1, gustMs: 2, rainMmH: 0, weatherCode: 96 });
    expect(r.call).toBe('no_go');
    expect(r.reason).not.toBe('');
  });
});

describe('windAdjustedMinutes', () => {
  it('takes longer into a headwind than with a tailwind', () => {
    // flying north (0°): wind from the north is a headwind, from the south a tailwind
    const head = windAdjustedMinutes(10, 0, 6, 0);
    const tail = windAdjustedMinutes(10, 0, 6, 180);
    expect(head).toBeGreaterThan(tail);
  });
  it('floors ground speed at 3 m/s', () => {
    // 30 m/s headwind would be negative; 6 km at 3 m/s is 2000 s
    expect(windAdjustedMinutes(6, 0, 30, 0)).toBeCloseTo(6000 / 3 / 60, 6);
  });
});
