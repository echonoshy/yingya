import { blockPageUpdate } from './appUpdate';

let currentUser = "";
let sessionGeneration = 0;
export const SESSION_EXPIRED = "yingya-session-expired";
export function setCurrentUser(id: string) { currentUser = id; sessionGeneration++; }
export function userStorageKey(key: string) { return currentUser ? `yingya-user:${currentUser}:${key}` : key; }
export function scopedUrl(path: string) {
  if (!currentUser) return path;
  if (path.startsWith('/api/u/') || path.startsWith('/assets/u/')) return path;
  if (path.startsWith('/api/') && !/^\/api\/(auth|admin|usage|quota|billing)(\/|$|\?)/.test(path)) return `/api/u/${currentUser}/${path.slice(5)}`;
  if (path.startsWith('/assets/')) return `/assets/u/${currentUser}/${path.slice(8)}`;
  return path;
}
export function sessionHeaders(): Record<string, string> { return currentUser ? { 'X-Yingya-User': currentUser } : {}; }
export function sessionChanged() { try { localStorage.setItem('yingya-session-change', crypto.randomUUID()); } catch { /* Login and logout must still work when browser storage is unavailable. */ } }

// Fetch and XHR uploads share the same account-generation and expiry checks.
export function captureSession() {
  const generation = sessionGeneration;
  return (status: number) => {
    if (generation !== sessionGeneration) throw new DOMException("登录状态已改变", "AbortError");
    if (status === 401 && currentUser) {
      setCurrentUser("");
      window.dispatchEvent(new Event(SESSION_EXPIRED));
    }
  };
}
export async function sessionFetch(input: RequestInfo | URL, init?: RequestInit) {
  const checkSession = captureSession();
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const release = !['GET', 'HEAD'].includes(method) ? blockPageUpdate('操作仍在提交或保存，请完成后再刷新。') : undefined;
  try {
    const response = await fetch(input, init);
    checkSession(response.status);
    return response;
  } finally { release?.(); }
}
