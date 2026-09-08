import { lazy, Suspense, useEffect, useState } from 'react';
import { MarketingPage } from './MarketingPage';

const AccountGate = lazy(() => import('../components/AccountGate').then(module => ({ default: module.AccountGate })));

function isWorkspaceRoute() {
  // Keep existing bookmarks to projects, assets, and the original create page working.
  return /^\/app(?:\/|$)/.test(window.location.pathname)
    || /^#\/(?:projects\/|assets(?:$|\/)|$)/.test(window.location.hash);
}

export function WebsiteRouter() {
  const [workspace, setWorkspace] = useState(isWorkspaceRoute);
  useEffect(() => {
    const sync = () => setWorkspace(isWorkspaceRoute());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  return workspace ? <Suspense fallback={<main className="state-screen" role="status">正在打开工作台…</main>}><AccountGate /></Suspense> : <MarketingPage />;
}
