import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { collectProjectContents, type ContentCategory, type ContentFile } from "../projectContents";
import type { Artifact, MediaAsset, ProjectDetail } from "../types";
import { ArtifactList } from "./ArtifactList";

export function ProjectContentPanel({ project, query, onQuery, category, onCategory, onPreview, onContext, onAdd }: {
  project: ProjectDetail; query: string; onQuery: (value: string) => void;
  category: ContentCategory; onCategory: (value: ContentCategory) => void;
  onPreview: (artifact: Artifact) => void; onContext: (value: string) => void; onAdd: () => void;
}) {
  const [files, setFiles] = useState<ContentFile[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const running = Boolean(project.activeTurnId || project.queueDepth);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || controller.signal.aborted || document.hidden) return;
      pending = true; setLoading(true);
      try {
        const [contents, media] = await Promise.allSettled([api.getProjectContents(project.id, controller.signal), api.getProjectMedia(project.id)]);
        if (!controller.signal.aborted) {
          if (contents.status === "fulfilled") { setFiles(contents.value.files); setTruncated(contents.value.truncated); }
          if (media.status === "fulfilled") setAssets(media.value.assets);
          setError(contents.status === "rejected" ? "项目文件暂时无法读取，已显示的内容仍可查看。" : media.status === "rejected" ? "部分素材信息暂时无法读取，项目文件仍可查看。" : "");
        }
      } catch { if (!controller.signal.aborted) setError("项目内容暂时无法读取，已显示的文件仍可查看。"); }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
    }
    void refresh();
    const interval = running ? setInterval(() => void refresh(), 5000) : undefined;
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [project.id, project.updatedAt, running, reload]);
  const artifacts = useMemo(() => collectProjectContents(project, files, assets), [project, files, assets]);
  return <ArtifactList projectId={project.id} artifacts={artifacts} query={query} onQuery={onQuery} category={category} onCategory={onCategory} onPreview={onPreview} onContext={onContext} loading={loading} error={error} truncated={truncated} onRefresh={() => setReload(value => value + 1)} onAdd={onAdd}/>;
}
