import {
  FolderSimple,
  Images,
  Plus,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function AppNavigation({
  active,
  onCreate,
  onAssets,
  accountPanel,
  children,
}: {
  active: "create" | "assets";
  onCreate: () => void;
  onAssets: () => void;
  accountPanel?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <aside className="home-nav app-navigation">
      <div className="home-brand">
        <img src="/brand/yingya-ghost.png" alt="" />
        <b>映芽</b>
      </div>
      <button className="home-new-button" aria-label="新建视频" title="新建视频" onClick={onCreate}>
        <Plus weight="bold" aria-hidden="true" />
        <span>新建视频</span>
      </button>
      <nav className="app-primary-navigation" aria-label="映芽功能">
        <button
          className={active === "create" && window.location.hash === "#/projects" ? "active" : ""}
          aria-current={active === "create" && window.location.hash === "#/projects" ? "page" : undefined}
          title="我的作品"
          aria-label="我的作品"
          onClick={() => {
            window.location.hash = "/projects";
            document.querySelector(".home-projects")?.scrollIntoView({block:"start"});
          }}
        >
          <FolderSimple />
          <span>我的作品</span>
        </button>
        <button
          title="素材工坊"
          aria-label="素材工坊"
          className={active === "assets" ? "active" : ""}
          aria-current={active === "assets" ? "page" : undefined}
          onClick={onAssets}
        >
          <Images />
          <span>素材工坊</span>
        </button>
      </nav>
      {children && <div className="app-navigation-extra">{children}</div>}
      {accountPanel}
    </aside>
  );
}
