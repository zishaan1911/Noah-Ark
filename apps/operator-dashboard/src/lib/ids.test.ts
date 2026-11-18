import { describe, expect, it } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('is prefix_ plus a 26 char Crockford ULID', () => {
    expect(newId('cmd')).toMatch(/^cmd_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newId('msn')).toMatch(/^msn_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('is unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('cmd')));
    expect(ids.size).toBe(1000);
  });
});
