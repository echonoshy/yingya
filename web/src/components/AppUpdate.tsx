import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import { parseAppVersion, pageUpdateBlockReason, type AppVersion } from '../appUpdate';
import { ActionDialog } from './ActionDialog';
import './app-update.css';

const UpdateContext = createContext<{ available: AppVersion | null; openDetails: () => void }>({ available: null, openDetails: () => {} });
export function useAppUpdate() { return useContext(UpdateContext); }

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<AppVersion | null>(null);
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState('');
  const openDetails = useCallback(() => { setBlocked(''); setOpen(true); }, []);
  useEffect(() => {
    let disposed = false;
    let pending: AbortController | null = null;
    let lastCheck = -Infinity;
    async function check() {
      if (document.visibilityState === 'hidden' || pending || Date.now() - lastCheck < 15_000) return;
      lastCheck = Date.now();
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch('/app-version.json', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const latest = parseAppVersion(await response.json());
        if (!disposed && latest) {
          // Build identity also detects same-version rebuilds and rollbacks.
          const next = latest.buildId === __YINGYA_BUILD_ID__ ? null : latest;
          setAvailable(current => current?.buildId === next?.buildId ? current : next);
          if (!next) setOpen(false);
        }
      } catch { /* Offline and deployments never interrupt the current page. */ }
      finally { clearTimeout(timeout); if (pending === controller) pending = null; }
    }
    const checkNow = () => { void check(); };
    checkNow();
    const interval = window.setInterval(checkNow, 60_000);
    window.addEventListener('focus', checkNow);
    window.addEventListener('pageshow', checkNow);
    window.addEventListener('online', checkNow);
    document.addEventListener('visibilitychange', checkNow);
    return () => {
      disposed = true; pending?.abort(); clearInterval(interval);
      window.removeEventListener('focus', checkNow);
      window.removeEventListener('pageshow', checkNow);
      window.removeEventListener('online', checkNow);
      document.removeEventListener('visibilitychange', checkNow);
    };
  }, []);
  const value = useMemo(() => ({ available, openDetails }), [available, openDetails]);
  function update() {
    const reason = pageUpdateBlockReason();
    if (reason) { setBlocked(reason); return; }
    window.location.reload();
  }
  return <UpdateContext.Provider value={value}>{children}
    <span className="app-update-announcement" role="status">{available ? '网站有新版本，可从“新版本”入口查看。当前页面不会自动刷新。' : ''}</span>
    {open && available ? <ActionDialog title="新版本可用" className="app-update-dialog" onClose={() => setOpen(false)}>
      <p className="app-update-version">v{available.version}</p>
      <ul>{available.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
      <p>当前页面不会自动更新，下次打开将使用最新版。</p>
      <p className="app-update-hint">已提交的视频制作会继续运行。刷新前，请保存当前输入并完成上传。</p>
      {blocked ? <p role="alert">{blocked}</p> : null}
      <footer><button type="button" onClick={() => setOpen(false)}>继续使用</button><button type="button" className="primary-button" onClick={update}>刷新更新</button></footer>
    </ActionDialog> : null}
  </UpdateContext.Provider>;
}

export function UpdateBadge({ beforeOpen }: { beforeOpen?: () => void }) {
  const { available, openDetails } = useAppUpdate();
  if (!available) return null;
  return <button type="button" className="app-update-badge" onClick={() => { beforeOpen?.(); openDetails(); }} aria-label="新版本，查看更新说明"><ArrowClockwise aria-hidden="true"/><span>新版本</span></button>;
}
