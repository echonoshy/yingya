import {
  FolderSimple,
  Images,
  Plus,
  Pause,
  Play,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useStudioMotion } from "./StudioTheme";

export function AppNavigation({
  active,
  onCreate,
  onAssets,
  onProjects,
  accountPanel,
  children,
}: {
  active: "create" | "assets" | "projects" | "account";
  onCreate: () => void;
  onAssets: () => void;
  onProjects?: () => void;
  accountPanel?: ReactNode;
  children?: ReactNode;
}) {
  const { enabled, toggle } = useStudioMotion();
  return (
    <aside className="home-nav app-navigation">
      <div className="app-navigation-surface">
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
          className={active === "projects" ? "active" : ""}
          aria-current={active === "projects" ? "page" : undefined}
          title="我的作品"
          aria-label="我的作品"
          onClick={() => {
            if (onProjects) { onProjects(); return; }
            window.location.hash = "/projects";
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
      </div>
      {children && <div className="app-navigation-extra">{children}</div>}
      <div className="app-account-dock">
        {accountPanel}
        {active === "create" ? <button className="studio-motion-toggle" type="button" onClick={toggle} aria-label={enabled ? "暂停插画动效" : "播放插画动效"} title={enabled ? "暂停插画动效" : "播放插画动效"} aria-pressed={!enabled}>{enabled ? <Pause/> : <Play/>}</button> : null}
      </div>
    </aside>
  );
}
