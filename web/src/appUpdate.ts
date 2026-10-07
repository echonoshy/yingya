export type AppVersion = { schemaVersion: 1; buildId: string; version: string; changes: string[] };

export function parseAppVersion(value: unknown): AppVersion | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1 || typeof data.buildId !== 'string' || !data.buildId || data.buildId.length > 128
    || typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version)
    || !Array.isArray(data.changes) || !data.changes.every(item => typeof item === 'string')) return null;
  return { schemaVersion: 1, buildId: data.buildId, version: data.version, changes: data.changes.slice(0, 5).map(item => item.slice(0, 500)) };
}

// Only the explicit update button consults these blockers. Background video jobs
// survive navigation; pending browser writes and uploads must finish first.
const updateBlockers = new Map<symbol, string>();
export function blockPageUpdate(reason: string) {
  const key = Symbol();
  updateBlockers.set(key, reason);
  return () => { updateBlockers.delete(key); };
}
export function pageUpdateBlockReason(): string | undefined {
  return updateBlockers.values().next().value;
}
