import { useCallback, useEffect, useState } from "react";
export type AppRoute = { section: "create" | "assets"; projectId?: string };
export function readRoute(): AppRoute {
  const hash = window.location.hash.slice(1);
  const match = /^\/projects\/([a-zA-Z0-9-]+)$/.exec(hash);
  return match ? { section: "create", projectId: match[1] } : { section: hash === "/assets" ? "assets" : "create" };
}
export function useAppRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener("popstate", sync); window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); };
  }, []);
  const navigate = useCallback((next: AppRoute) => {
    const hash = next.projectId ? `/projects/${next.projectId}` : next.section === "assets" ? "/assets" : "/";
    if (window.location.hash !== `#${hash}`) window.history.pushState(null, "", `#${hash}`);
    setRoute(next);
  }, []);
  return [route, navigate] as const;
}
