import { ArrowClockwise, CaretDown, Eye, File, FileAudio, FileText, Folders, Images, ListBullets, MagnifyingGlass, Plus, VideoCamera, X } from "@phosphor-icons/react";
import { useState } from "react";
import { z } from "zod";
import { api } from "../api";
import { useSavedState } from "../hooks/useSavedState";
import { contentCategories, contentCategory, contentGroups, type ContentCategory, type ProjectContent } from "../projectContents";
import type { Artifact } from "../types";
import { SelectControl } from "./SelectControl";

const icons = { all: File, video: VideoCamera, image: Images, audio: FileAudio, document: FileText, other: File };
const viewSchema = z.enum(["grouped", "files"]);
const sortSchema = z.enum(["recent", "name"]);
const foldsSchema = z.array(z.enum(["versions", "media", "documents", "production"]));
const defaultFolds: z.infer<typeof foldsSchema> = ["production"];
const dateFormat = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
function ContentThumbnail({ projectId, artifact }: { projectId: string; artifact: Artifact }) {
  const [failed, setFailed] = useState(false);
  const kind = contentCategory(artifact), Icon = icons[kind];
  return <span className={`project-content-thumbnail project-content-thumbnail--${kind}`}>
    {kind === "image" && !failed ? <img src={api.fileUrl(projectId, artifact.path)} alt="" loading="lazy" onError={() => setFailed(true)}/> : <Icon aria-hidden="true"/>}
  </span>;
}
function sizeLabel(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : value < 1024 ? `${value} B` : `${Math.round(value / 1024)} KB`;
}
function ContentRow({ projectId, artifact, paths, onPreview, onContext }: {
  projectId: string; artifact: ProjectContent; paths: boolean;
  onPreview: (artifact: Artifact) => void; onContext: (value: string) => void;
}) {
  const format = artifact.path.match(/\.([a-z0-9]+)$/i)?.[1].toUpperCase() ?? "文件";
  const source = artifact.currentVersion ? "当前版本" : artifact.group === "versions" ? "已保存版本" : artifact.source === "generated" ? "生成素材" : ["uploaded", "imported", "library"].includes(artifact.source ?? "") ? "已加入项目" : "";
  const modifiedAt = Number(artifact.metadata.modifiedAt), date = new Date(modifiedAt);
  const hasDate = modifiedAt > 0 && !Number.isNaN(date.getTime());
  return <li className={artifact.currentVersion ? "project-content-current" : undefined}>
    <button className="project-content-open" onClick={() => onPreview(artifact)} aria-label={`预览 ${artifact.label}`} title={`${artifact.label}\n${artifact.path}`}>
      <ContentThumbnail key={artifact.path} projectId={projectId} artifact={artifact}/>
      <span className="project-content-name"><b>{artifact.label}</b><span className={paths ? "project-content-path" : "project-content-description"}>{paths ? artifact.path : [source, format, sizeLabel(artifact.metadata.size)].filter(Boolean).join(" · ")}</span></span>
      {paths ? <span className="project-content-meta"><span>{format}</span><span>{sizeLabel(artifact.metadata.size) || "—"}</span></span> : null}
      <span className="project-content-date" title={hasDate ? `更新于 ${date.toLocaleString("zh-CN")}` : undefined}>{hasDate ? <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time> : "—"}</span>
      <span className="project-content-preview" aria-hidden="true"><Eye/><span>预览</span></span>
    </button>
    <button className="project-content-context" aria-label={`引用 ${artifact.label}`} title="加入对话" onClick={() => onContext(`文件「${artifact.label}」（${artifact.path}）`)}><Plus/></button>
  </li>;
}
export function ArtifactList({ projectId, artifacts, query, onQuery, category, onCategory, onPreview, onContext, loading, error, truncated, onRefresh, onAdd }: {
  projectId: string; artifacts: ProjectContent[]; query: string; onQuery: (value: string) => void;
  category: ContentCategory; onCategory: (value: ContentCategory) => void;
  onPreview: (artifact: Artifact) => void; onContext: (value: string) => void;
  loading: boolean; error: string; truncated: boolean; onRefresh: () => void; onAdd: () => void;
}) {
  const [view, setView] = useSavedState("yingya-project-contents-view", viewSchema, "grouped");
  const [folds, setFolds] = useSavedState(`yingya-content-folds:${projectId}`, foldsSchema, defaultFolds);
  const [sort, setSort] = useSavedState("yingya-project-contents-sort", sortSchema, "recent");
  const search = query.trim().toLocaleLowerCase();
  const filtered = Boolean(search || category !== "all");
  const grouped = view === "grouped" && !filtered;
  const counts = new Map<ContentCategory, number>();
  for (const artifact of artifacts) { const kind = contentCategory(artifact); counts.set(kind, (counts.get(kind) ?? 0) + 1); }
  const matching = artifacts.filter(artifact => (category === "all" || contentCategory(artifact) === category) && (!search || `${artifact.label}\n${artifact.path}`.toLocaleLowerCase().includes(search))).sort((a, b) => sort === "name" ? a.label.localeCompare(b.label, "zh-CN") : Number(b.metadata.modifiedAt ?? 0) - Number(a.metadata.modifiedAt ?? 0) || a.path.localeCompare(b.path));
  function rows(items: ProjectContent[], tiles = false) {
    return <ul className={`project-content-list${tiles ? " project-content-list--tiles" : ""}${!grouped ? " project-content-list--files" : ""}`} aria-label="项目文件">{items.map(artifact => <ContentRow key={artifact.path} projectId={projectId} artifact={artifact} paths={!grouped} onPreview={onPreview} onContext={onContext}/>)}</ul>;
  }
  return <section className="project-contents" aria-label="项目内容">
    <header className="project-contents-heading"><div><h2 aria-label="项目内容"><em>项目</em>内容</h2><p>成片、素材与文稿，按用途归档。</p></div><div><button aria-label="刷新项目内容" title="刷新项目内容" disabled={loading} onClick={onRefresh}><ArrowClockwise className={loading ? "spin" : ""}/></button><button className="project-contents-add" onClick={onAdd}><Plus/>添加素材</button></div></header>
    <div className="project-contents-tools">
      <nav aria-label="内容分类">{contentCategories.map(item => <button key={item.id} aria-pressed={category === item.id} onClick={() => onCategory(item.id)}>{item.label}<span>{item.id === "all" ? artifacts.length : counts.get(item.id) ?? 0}</span></button>)}</nav>
      <label className="project-contents-search"><MagnifyingGlass aria-hidden="true"/><input aria-label="搜索项目内容" placeholder="搜索名称或路径" value={query} onChange={event => onQuery(event.target.value)}/>{query ? <button aria-label="清除搜索" onClick={() => onQuery("")}><X/></button> : null}</label>
    </div>
    <div className="project-contents-display">
      <p className="project-content-count" role="status">{filtered ? `找到 ${matching.length} 项` : `${artifacts.length} 项内容`}{filtered ? <button onClick={() => { onQuery(""); onCategory("all"); }}>清除筛选</button> : null}</p>
      {filtered ? <span className="project-contents-filter-note">全部分组内查找</span> : <div className="project-contents-view" aria-label="内容视图"><button aria-label="按用途分组" title="按用途分组" aria-pressed={view === "grouped"} onClick={() => setView("grouped")}><Folders/><span>按用途</span></button><button aria-label="文件列表" title="文件列表" aria-pressed={view === "files"} onClick={() => setView("files")}><ListBullets/><span>文件列表</span></button></div>}
      <SelectControl aria-label="内容排序" value={sort} onChange={event => setSort(event.target.value === "name" ? "name" : "recent")}><option value="recent">最近更新</option><option value="name">名称排序</option></SelectControl>
    </div>
    {error ? <div className="project-content-notice" role="alert"><span>{error}</span><button onClick={onRefresh}>重新读取</button></div> : null}
    {truncated ? <p className="project-content-notice" role="status">文件较多，当前展示部分内容及已登记的作品。</p> : null}
    {loading && !artifacts.length ? <p role="status" className="project-content-empty">正在读取项目内容…</p> : matching.length ? <div className="project-content-results" key={grouped ? "groups" : "files"}>
      {grouped ? contentGroups.map((group, index) => {
        const items = matching.filter(artifact => artifact.group === group.id);
        if (!items.length) return null;
        const expanded = !folds.includes(group.id), id = `content-group-${group.id}`;
        return <section className={`project-content-group project-content-group--${group.id}`} key={group.id} aria-label={group.label}>
          <h3><button aria-expanded={expanded} aria-controls={id} onClick={() => setFolds(current => expanded ? [...current, group.id] : current.filter(value => value !== group.id))}><span className="project-content-group-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><b>{group.label}</b><span className="project-content-group-count">{items.length}</span><span className="project-content-group-description">{group.description}</span><CaretDown aria-hidden="true"/></button></h3>
          {expanded ? <div id={id} className="project-content-group-body">{rows(items, group.id === "media" || group.id === "documents")}</div> : <div id={id} hidden/>}
        </section>;
      }) : rows(matching)}
    </div> : !error ? <div className="project-content-empty"><File aria-hidden="true"/><h3>{filtered ? "没有匹配的内容" : "还没有项目内容"}</h3><p>{filtered ? "试试其他分类，或清除搜索条件。" : "生成的图片、视频、音频和文档会自动显示在这里。"}</p><button onClick={() => { if (filtered) { onQuery(""); onCategory("all"); } else onAdd(); }}>{filtered ? "查看全部内容" : "添加素材"}</button></div> : null}
  </section>;
}
