import { lazy, Suspense, useEffect, useState } from 'react';
import { MarketingPage } from './MarketingPage';

const AccountGate = lazy(() => import('../components/AccountGate').then(module => ({ default: module.AccountGate })));
const AdminApp = lazy(() => import('../admin/AdminApp').then(module => ({ default: module.AdminApp })));
function currentRoute(){return /^\/admin(?:\/|$)/.test(window.location.pathname)?'admin':isWorkspaceRoute()?'workspace':'marketing';}

function isWorkspaceRoute() {
  // Keep existing bookmarks to projects, assets, and the original create page working.
  return /^\/app(?:\/|$)/.test(window.location.pathname)
    || /^#\/(?:projects\/|assets(?:$|\/)|$)/.test(window.location.hash);
}

export function WebsiteRouter() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const sync = () => setRoute(currentRoute());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  return route==='admin'?<Suspense fallback={<main className="state-screen" role="status">正在打开管理后台…</main>}><AdminApp/></Suspense>:route==='workspace' ? <Suspense fallback={<main className="state-screen" role="status">正在打开工作台…</main>}><AccountGate /></Suspense> : <MarketingPage />;
}
