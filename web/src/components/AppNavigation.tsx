import type { ReactNode } from "react";
import { Plus, VideoCamera, FolderSimple } from "@phosphor-icons/react";
import { BrandLogo } from "../marketing/BrandLogo";

export function AppNavigation({ active, onCreate, onAssets, onProjects, accountPanel, children }: {
  active: "create" | "assets" | "projects" | "account";
  onCreate: () => void; onAssets: () => void; onProjects?: () => void;
  accountPanel?: ReactNode; children?: ReactNode;
}) {
  return <><header className="home-nav app-navigation">
    <div className="app-navigation-surface">
      <BrandLogo />
      <nav className="app-primary-navigation" aria-label="映芽功能">
        <button className={active === "create" ? "active home-new-button" : "home-new-button"} aria-label="新建视频" aria-current={active === "create" ? "page" : undefined} onClick={onCreate}><Plus/><span>创作</span></button>
        <button className={active === "projects" ? "active" : ""} aria-label="我的作品" aria-current={active === "projects" ? "page" : undefined} onClick={() => { if (onProjects) onProjects(); else window.location.hash = "/projects"; }}><VideoCamera/><span>作品</span></button>
        <button className={active === "assets" ? "active" : ""} aria-label="素材工坊" aria-current={active === "assets" ? "page" : undefined} onClick={onAssets}><FolderSimple/><span>素材</span></button>
      </nav>
      <div className="app-account-dock">{accountPanel}</div>
    </div>
  </header>{children ? <aside className="app-navigation-extra" aria-label="素材文件夹导航">{children}</aside> : null}</>;
}
