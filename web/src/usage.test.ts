import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNT_QUOTA, formatUsage } from './usage';

describe('account quota display', () => {
  it('defaults to one billion tokens and forty media operations', () => {
    expect(DEFAULT_ACCOUNT_QUOTA).toEqual({ tokenLimit: 1_000_000_000, mediaLimit: 40 });
  });

  it.each([
    [0, '0'], [40, '40'], [999, '999'], [1000, '1K'], [1234, '1.23K'],
    [999_999, '1M'], [1_000_000, '1M'], [1_234_567, '1.23M'],
    [999_999_999, '1B'], [1_000_000_000, '1B'], [1_250_000_000, '1.25B'],
    [1_000_000_000_000, '1000B'], [-1250, '-1.25K'],
  ])('formats %s as %s without changing the underlying amount', (value, expected) => {
    expect(formatUsage(value)).toBe(expected);
  });
});
