import { CaretDown, Eye, File, FileAudio, FileCode, FileText, Images, MagnifyingGlass, Plus, VideoCamera, X } from "@phosphor-icons/react";
import type { Artifact } from "../types";
import { filePreviewKind } from "../projectFiles";

const categories = [
  { id: "video", label: "视频", icon: VideoCamera },
  { id: "plan", label: "方案与分镜", icon: FileText },
  { id: "image", label: "画面与封面", icon: Images },
  { id: "audio", label: "旁白与配乐", icon: FileAudio },
  { id: "report", label: "检查报告", icon: FileText },
  { id: "other", label: "源文件与其他", icon: FileCode },
] as const;

export function artifactCategory(artifact: Artifact): string {
  const kind = artifact.kind.toLowerCase();
  // Semantic roles take precedence: reports can be Markdown, sources can be HTML.
  if (kind.includes("report") || /(^|\/)reports\//i.test(artifact.path)) return "report";
  if (/^(plan|scenes|storyboard|script)$/.test(kind)) return "plan";
  if (kind.includes("source")) return "other";
  const media = filePreviewKind(artifact.path);
  if (media === "video" || media === "image" || media === "audio") return media;
  if (kind.includes("video")) return "video";
  if (kind.includes("image")) return "image";
  if (kind.includes("audio")) return "audio";
  return "other";
}

export function ArtifactList({ artifacts, query, onQuery, expanded, onExpanded, onPreview, onContext }: {
  artifacts: Artifact[];
  query: string;
  onQuery: (value: string) => void;
  expanded: string[];
  onExpanded: (value: string[]) => void;
  onPreview: (artifact: Artifact) => void;
  onContext: (value: string) => void;
}) {
  const search = query.trim().toLocaleLowerCase();
  const matching = artifacts.filter(artifact => !search || `${artifact.label}\n${artifact.path}`.toLocaleLowerCase().includes(search)).reverse();
  const groups = categories.map(category => ({ ...category, items: matching.filter(artifact => artifactCategory(artifact) === category.id) })).filter(group => group.items.length);

  return <section className="artifact-list" aria-label="项目产物">
    <div className="section-heading"><h3>项目文件</h3><span>{artifacts.length} 项</span></div>
    {artifacts.length ? <>
      <div className="artifact-search"><MagnifyingGlass aria-hidden="true"/><input aria-label="搜索产物名称或路径" placeholder="搜索名称或路径" value={query} onChange={event => onQuery(event.target.value)}/>{query ? <button aria-label="清除产物搜索" title="清除搜索" onClick={() => onQuery("")}><X/></button> : null}</div>
      <p className="artifact-list-hint" role="status">{search ? `找到 ${matching.length} 项产物` : "按用途归类 · 组内后加入的在前"}</p>
      {groups.map(({ id, label, icon: Icon, items }) => {
        const open = Boolean(search) || expanded.includes(id);
        return <section className="artifact-group" key={id} aria-label={label}>
          <h4><button className="artifact-group-toggle" aria-expanded={open} aria-controls={`artifact-group-${id}`} onClick={() => {
            if (search) return;
            onExpanded(open ? expanded.filter(value => value !== id) : [...expanded, id]);
          }} aria-disabled={Boolean(search)}><Icon aria-hidden="true"/><span>{label}</span><span className="artifact-group-count">{items.length}</span><CaretDown className="artifact-group-chevron" aria-hidden="true"/></button></h4>
          <div id={`artifact-group-${id}`} hidden={!open}>
            {items.map(artifact => <div className="artifact-row" key={artifact.id}>
              <button className="artifact-open" onClick={() => onPreview(artifact)} title={`${artifact.label}\n${artifact.path}`}><span><Icon aria-hidden="true"/></span><div><b>{artifact.label}</b><small>{artifact.path}</small></div><Eye aria-hidden="true"/></button>
              <button className="artifact-context" aria-label={`加入反馈 ${artifact.label}`} title="加入反馈" onClick={() => onContext(artifact.label)}><Plus/></button>
            </div>)}
          </div>
        </section>;
      })}
      {!matching.length ? <div className="artifact-empty"><MagnifyingGlass/><b>没有找到匹配的产物</b><p>试试文件名、版本号或路径中的关键词。</p></div> : null}
    </> : <div className="artifact-empty"><File/><b>还没有生成的文件</b><p>生成完成后，视频与检查报告会显示在这里。</p></div>}
  </section>;
}
