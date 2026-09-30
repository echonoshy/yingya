import { describe, expect, it } from 'vitest';
import { cssTimeMilliseconds } from './motionTiming';

describe('CSS motion token units', () => {
  it('gives equivalent durations for theme seconds and base milliseconds', () => {
    expect(cssTimeMilliseconds('.16s') * 5).toBe(800);
    expect(cssTimeMilliseconds('160ms') * 5).toBe(800);
    expect(cssTimeMilliseconds(' 0.16s ')).toBe(160);
  });
  it('preserves zero and falls back for missing or invalid tokens', () => {
    expect(cssTimeMilliseconds('0s')).toBe(0);
    expect(cssTimeMilliseconds('')).toBe(160);
    expect(cssTimeMilliseconds('fast')).toBe(160);
  });
});
