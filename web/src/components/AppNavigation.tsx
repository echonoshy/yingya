import { useEffect, useRef, type ReactNode } from "react";
import { Plus, VideoCamera, FolderSimple, CaretDown } from "@phosphor-icons/react";
import { BrandLogo } from "../marketing/BrandLogo";

export function AppNavigation({ active, onCreate, onAssets, onProjects, accountPanel, children }: {
  active: "create" | "assets" | "projects" | "account";
  onCreate: () => void; onAssets: () => void; onProjects?: () => void;
  accountPanel?: ReactNode; children?: ReactNode;
}) {
  const foldersRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const viewport = matchMedia('(min-width: 761px)');
    const sync = () => { if (foldersRef.current) foldersRef.current.open = viewport.matches; };
    sync();
    viewport.addEventListener('change', sync);
    return () => viewport.removeEventListener('change', sync);
  }, []);
  return <><header className="home-nav app-navigation">
    <div className="app-navigation-surface">
      <BrandLogo />
      <nav className="app-primary-navigation" aria-label="映芽功能">
        <button className={active === "create" ? "active home-new-button" : "home-new-button"} aria-label="新建视频" aria-current={active === "create" ? "page" : undefined} onClick={onCreate}><Plus/><span>创作</span></button>
        <button className={active === "projects" ? "active" : ""} aria-label="我的项目" aria-current={active === "projects" ? "page" : undefined} onClick={() => { if (onProjects) onProjects(); else window.location.hash = "/projects"; }}><VideoCamera/><span>项目</span></button>
        <button className={active === "assets" ? "active" : ""} aria-label="素材工坊" aria-current={active === "assets" ? "page" : undefined} onClick={onAssets}><FolderSimple/><span>素材</span></button>
      </nav>
      {children ? <details ref={foldersRef} className="app-navigation-extra"><summary><FolderSimple/><span>素材文件夹</span><CaretDown/></summary><div aria-label="素材文件夹导航">{children}</div></details> : null}
      <div className="app-account-dock">{accountPanel}</div>
    </div>
  </header></>;
}
