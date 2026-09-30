/** Web Animations uses milliseconds; CSS time tokens may use seconds or milliseconds. */
export function cssTimeMilliseconds(value: string, fallback = 160): number {
  const match = value.trim().match(/^(\d*\.?\d+)\s*(ms|s)$/);
  if (!match) return fallback;
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
}
