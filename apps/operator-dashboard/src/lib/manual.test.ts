import { describe, expect, it } from 'vitest';
import { MANUAL, packet, smooth, stickFromKeys, ZERO_STICK } from './manual';
import { validateManual } from './validate';

const keys = (...k: string[]) => new Set(k);

describe('stickFromKeys', () => {
  it('W goes forward at cruise speed', () => {
    expect(stickFromKeys(keys('KeyW')).forwardMs).toBe(MANUAL.cruiseMs);
  });
  it('Shift boosts', () => {
    expect(stickFromKeys(keys('KeyW', 'ShiftLeft')).forwardMs).toBe(MANUAL.boostMs);
  });
  it('opposite keys cancel', () => {
    expect(stickFromKeys(keys('KeyW', 'KeyS')).forwardMs).toBe(0);
  });
  it('a diagonal stays within the limit', () => {
    const s = stickFromKeys(keys('KeyW', 'KeyD'));
    expect(Math.hypot(s.forwardMs, s.rightMs)).toBeLessThanOrEqual(MANUAL.cruiseMs + 1e-9);
  });
  it('Space zeroes everything', () => {
    expect(stickFromKeys(keys('KeyW', 'KeyR', 'KeyE', 'Space'))).toEqual(ZERO_STICK);
  });
});

describe('smooth', () => {
  it('limits one step and never overshoots', () => {
    const target = { ...ZERO_STICK, forwardMs: 6 };
    expect(smooth(ZERO_STICK, target, 0.1).forwardMs).toBeLessThanOrEqual(1.2 + 1e-9);
    let s = ZERO_STICK;
    for (let i = 0; i < 20; i++) {
      s = smooth(s, target, 0.1);
      expect(s.forwardMs).toBeLessThanOrEqual(6);
    }
    expect(s.forwardMs).toBe(6);
  });
});

describe('packet', () => {
  it('passes the schema', () => {
    const p = packet('ARK-001', 3, { forwardMs: 2, rightMs: -1, upMs: 0, yawRateDegS: 10 }, 'Zishaan Ahmed');
    expect(validateManual(p)).toEqual({ ok: true, errors: [] });
  });
});
