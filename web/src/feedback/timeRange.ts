// Only recognize one explicit, unambiguous interval. Keep the original prose.
export function parseTimeRange(text: string): { start: number; end: number } | null {
  const matches = [...text.matchAll(/(?<![\d:.])(\d{1,3}:\d{2}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:秒)?\s*[–—~～至到-]\s*(\d{1,3}:\d{2}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(秒)?/g)];
  if (matches.length !== 1) return null;
  const match = matches[0];
  if (!match[3] && !(match[1].includes(':') && match[2].includes(':'))) return null;
  const seconds = (part: string) => { const pieces = part.split(':').map(Number); return pieces.length === 1 ? pieces[0] : pieces[1] < 60 ? pieces[0] * 60 + pieces[1] : NaN; };
  const start = seconds(match[1]), end = seconds(match[2]);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}
