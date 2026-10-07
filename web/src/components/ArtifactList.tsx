import { ArrowClockwise, File, FileAudio, FileText, Images, MagnifyingGlass, Plus, VideoCamera, X } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../api";
import { contentCategories, contentCategory, type ContentCategory } from "../projectContents";
import type { Artifact } from "../types";

const icons = { all: File, video: VideoCamera, image: Images, audio: FileAudio, document: FileText, other: File };
function ContentThumbnail({ projectId, artifact }: { projectId: string; artifact: Artifact }) {
  const [failed, setFailed] = useState(false);
  const kind = contentCategory(artifact), Icon = icons[kind];
  return <span className={`project-content-thumbnail project-content-thumbnail--${kind}`}>
    {kind === "image" && !failed ? <img src={api.fileUrl(projectId, artifact.path)} alt="" loading="lazy" onError={() => setFailed(true)}/> : <Icon aria-hidden="true"/>}
  </span>;
}
function sizeLabel(value: unknown) {
  if (typeof value !== "number") return "";
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}
export function ArtifactList({ projectId, artifacts, query, onQuery, category, onCategory, onPreview, onContext, loading, error, truncated, onRefresh, onAdd }: {
  projectId: string; artifacts: Artifact[]; query: string; onQuery: (value: string) => void;
  category: ContentCategory; onCategory: (value: ContentCategory) => void;
  onPreview: (artifact: Artifact) => void; onContext: (value: string) => void;
  loading: boolean; error: string; truncated: boolean; onRefresh: () => void; onAdd: () => void;
}) {
  const search = query.trim().toLocaleLowerCase();
  const matching = artifacts.filter(artifact => (category === "all" || contentCategory(artifact) === category) && (!search || `${artifact.label}\n${artifact.path}`.toLocaleLowerCase().includes(search)));
  return <section className="project-contents" aria-label="项目内容">
    <header className="project-contents-heading"><div><h2>项目内容</h2><p>制作中生成的文件和已加入项目的素材，都在这里。</p></div><div><button aria-label="刷新项目内容" disabled={loading} onClick={onRefresh}><ArrowClockwise className={loading ? "spin" : ""}/></button><button onClick={onAdd}><Plus/>添加素材</button></div></header>
    <div className="project-contents-tools">
      <nav aria-label="内容分类">{contentCategories.map(item => <button key={item.id} aria-pressed={category === item.id} onClick={() => onCategory(item.id)}>{item.label}<span>{item.id === "all" ? artifacts.length : artifacts.filter(artifact => contentCategory(artifact) === item.id).length}</span></button>)}</nav>
      <label className="project-contents-search"><MagnifyingGlass aria-hidden="true"/><input aria-label="搜索项目内容" placeholder="搜索文件名称" value={query} onChange={event => onQuery(event.target.value)}/>{query ? <button aria-label="清除搜索" onClick={() => onQuery("")}><X/></button> : null}</label>
    </div>
    {error ? <div className="project-content-notice" role="alert"><span>{error}</span><button onClick={onRefresh}>重新读取</button></div> : null}
    {truncated ? <p className="project-content-notice" role="status">文件较多，当前展示部分内容及已登记的作品。</p> : null}
    {loading && !artifacts.length ? <p role="status" className="project-content-empty">正在读取项目内容…</p> : matching.length ? <>
      <p className="project-content-count" role="status">{search ? `找到 ${matching.length} 项` : `${matching.length} 项内容`}</p>
      <div className="project-content-grid">{matching.map(artifact => <article key={artifact.path}>
        <button className="project-content-open" onClick={() => onPreview(artifact)} aria-label={`预览 ${artifact.label}`} title={artifact.path}>
          <ContentThumbnail key={artifact.path} projectId={projectId} artifact={artifact}/>
          <b>{artifact.label}</b><small>{contentCategories.find(item => item.id === contentCategory(artifact))?.label}{sizeLabel(artifact.metadata.size) ? ` · ${sizeLabel(artifact.metadata.size)}` : ""}</small>
        </button>
        <button className="project-content-context" aria-label={`引用 ${artifact.label}`} title="加入对话" onClick={() => onContext(`文件「${artifact.label}」（${artifact.path}）`)}><Plus/></button>
      </article>)}</div>
    </> : !error ? <div className="project-content-empty"><File aria-hidden="true"/><h3>{search || category !== "all" ? "没有匹配的内容" : "还没有项目内容"}</h3><p>{search || category !== "all" ? "试试其他分类，或清除搜索条件。" : "生成的图片、视频、音频和文档会自动显示在这里。"}</p><button onClick={() => { if (search || category !== "all") { onQuery(""); onCategory("all"); } else onAdd(); }}>{search || category !== "all" ? "查看全部内容" : "添加素材"}</button></div> : null}
  </section>;
}
