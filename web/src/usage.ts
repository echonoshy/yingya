export const DEFAULT_ACCOUNT_QUOTA = { tokenLimit: 1_000_000_000, mediaLimit: 40 } as const;

const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false });

export function formatUsage(value: number): string {
  for (const [scale, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    // Promote rounded boundary values, so 999,999 is 1M instead of 1000K.
    if (Math.abs(value) >= scale - scale / 200_000) {
      return `${decimal.format(value / scale)}${suffix}`;
    }
  }
  return decimal.format(value);
}
