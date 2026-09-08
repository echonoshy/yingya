let currentUser = "";
export function setCurrentUser(id: string) { currentUser = id; }
export function userStorageKey(key: string) { return currentUser ? `yingya-user:${currentUser}:${key}` : key; }
export function scopedUrl(path: string) {
  if (!currentUser) return path;
  if (path.startsWith('/api/u/') || path.startsWith('/assets/u/')) return path;
  if (path.startsWith('/api/') && !/^\/api\/(auth|admin|usage)(\/|$|\?)/.test(path)) return `/api/u/${currentUser}/${path.slice(5)}`;
  if (path.startsWith('/assets/')) return `/assets/u/${currentUser}/${path.slice(8)}`;
  return path;
}
export function sessionHeaders(): Record<string, string> { return currentUser ? { 'X-Yingya-User': currentUser } : {}; }
export function sessionChanged() { try { localStorage.setItem('yingya-session-change', crypto.randomUUID()); } catch { /* Login and logout must still work when browser storage is unavailable. */ } }
