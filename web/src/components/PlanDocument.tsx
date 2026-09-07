import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from '../api';
import type { ProjectDetail } from '../types';
const MarkdownPreview = lazy(() => import('./MarkdownPreview'));
export function PlanDocument({ project }: { project: ProjectDetail }) {
  const path = project.manifest.checkpoint?.kind === 'plan' ? project.manifest.artifacts.find(item => project.manifest.checkpoint?.artifactIds.includes(item.id) && /\.md$/i.test(item.path))?.path : undefined;
  const [result, setResult] = useState({ path: '', text: '', error: '' });
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void api.readProjectFile(project.id, path).then(text => { if (!cancelled) setResult({ path, text, error: '' }); }).catch(() => { if (!cancelled) setResult({ path, text: '', error: '方案暂时无法读取，可从项目文件重新打开。' }); });
    return () => { cancelled = true; };
  }, [project.id, path]);
  if (!path) return null;
  return <div className="plan-document">{result.path !== path ? <p role="status">正在读取制作方案…</p> : result.error ? <p role="alert">{result.error}</p> : <Suspense fallback={<p>正在加载方案…</p>}><MarkdownPreview projectId={project.id}>{result.text}</MarkdownPreview></Suspense>}</div>;
}
