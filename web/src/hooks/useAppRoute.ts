import { useCallback, useEffect, useState } from "react";
export type AppRoute = {
  section: "create" | "assets";
  projectId?: string;
  homeSection?: "styles" | "projects";
  assetTool?: "image" | "voice";
  assetSection?: "library" | "generate" | "tasks";
};
export function readRoute(): AppRoute {
  const hash = window.location.hash.slice(1);
  const match = /^\/projects\/([a-zA-Z0-9-]+)$/.exec(hash);
  const asset = /^\/assets(?:\/(?:(generate)(?:\/(image|voice))?|(image|voice)|(tasks)))?$/.exec(hash);
  return match
    ? { section: "create", projectId: match[1] }
    : asset
      ? {
          section: "assets",
          assetSection: asset[4] ? "tasks" : asset[1] || asset[2] || asset[3] ? "generate" : "library",
          ...(!asset[4] && (asset[1] || asset[2] || asset[3]) ? { assetTool: (asset[2] || asset[3] || "image") as "image" | "voice" } : {}),
        }
      : {
          section: "create",
          ...(["/styles", "/projects"].includes(hash)
            ? { homeSection: hash.slice(1) as "styles" | "projects" }
            : {}),
        };
}
export function useAppRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  const navigate = useCallback((next: AppRoute) => {
    const hash = next.projectId
      ? `/projects/${next.projectId}`
      : next.section === "assets"
        ? `/assets${next.assetSection === "tasks" ? "/tasks" : next.assetTool || next.assetSection === "generate" ? `/generate/${next.assetTool || "image"}` : ""}`
        : next.homeSection
          ? `/${next.homeSection}`
          : "/";
    if (window.location.hash !== `#${hash}`)
      window.history.pushState(null, "", `#${hash}`);
    setRoute(next);
  }, []);
  return [route, navigate] as const;
}
