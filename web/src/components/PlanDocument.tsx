import { lazy, Suspense, useEffect, useState } from 'react';
import { ChatText, CircleNotch, ArrowRight, ArrowClockwise, ArrowsOut, Plus, Minus } from '@phosphor-icons/react';
import { api } from '../api';
import { ActionDialog } from './ActionDialog';
import type { ProjectDetail } from '../types';
import type { ExplanationPlan, PlanReceipt } from '../explanationPlan';
const MarkdownPreview = lazy(() => import('./MarkdownPreview'));
export function PlanDocument({ project, compact = false, onCompose, onConfirm, confirming = false }: { project: ProjectDetail; compact?: boolean; onCompose?: (text: string) => void; onConfirm?: (receipt: PlanReceipt) => void; confirming?: boolean }) {
  const [result, setResult] = useState<ExplanationPlan | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [expandedFrame, setExpandedFrame] = useState<{ title: string; path: string; description: string } | null>(null);
  useEffect(() => setExpandedFrame(null), [project.id, result?.revision]);
  const [failedFrames, setFailedFrames] = useState<string[]>([]);
  useEffect(() => setFailedFrames([]), [result?.revision, retry]);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setLoading(true); setError('');
    const timer = setTimeout(() => controller.abort(), 15000);
    void api.getPlan(project.id, controller.signal).then(value => { if (!disposed) setResult(value); }).catch(reason => { if (disposed) return; if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '方案暂时无法读取'); else setError('方案读取超时，请重试'); }).finally(() => { clearTimeout(timer); if (!disposed) setLoading(false); });
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [project.id, project.updatedAt, retry]);
  const working = Boolean(project.activeTurnId || project.queueDepth);
  const document = result?.document;
  const canConfirm = !failedFrames.length && !loading && !error && result?.ready && result.checkpointId === project.manifest.checkpoint?.id && !working && !confirming;
  const content = <section className="plan-document knowledge-plan" aria-label="制作方案">
    <header><div><h2>{document?.title || '制作方案'}</h2></div>{working || loading ? <span role="status"><CircleNotch className="spin"/>{loading ? '读取方案中' : '正在完善方案'}</span> : null}</header>
    {error ? <p className="form-error" role="alert">{error}<button onClick={() => setRetry(value => value + 1)}><ArrowClockwise/>重新读取</button></p> : null}
    {document ? <>
      <dl className="plan-brief"><div><dt>讲给谁听</dt><dd>{document.audience}</dd></div><div><dt>核心问题</dt><dd>{document.question}</dd></div><div><dt>看完理解</dt><dd>{document.takeaway}</dd></div></dl>
      <p className="plan-meta">预计 {Math.round(document.durationSeconds)} 秒 · {document.aspectRatio} · {document.narration}</p>
      <div className="plan-sections">{document.sections.map((section, index) => <article key={section.id}>
        <header><h3>{index + 1}. {section.title}</h3>{onCompose ? <button type="button" onClick={() => onCompose(`关于方案「${result?.revision.slice(0,8)}」的段落「${section.id}」（${section.title}），我想调整：`)}><ChatText/>对此提意见</button> : null}</header>
        <p>{section.summary}</p><p className="plan-expression">画面：{section.expression}</p>
        {section.keyframe ? section.keyframe.status === 'ready' && section.keyframe.path ? <figure><button type="button" className="plan-keyframe-open" aria-label={`放大查看：${section.title}`} disabled={failedFrames.includes(section.id)} onClick={() => setExpandedFrame({ title: section.title, path: section.keyframe!.path!, description: section.expression })}><img key={`${section.id}:${retry}`} onError={() => setFailedFrames(items => items.includes(section.id) ? items : [...items, section.id])} src={`${api.fileUrl(project.id, section.keyframe.path)}?revision=${result?.revision}&retry=${retry}`} alt={`${section.title}的关键画面`} loading="lazy"/><span><ArrowsOut aria-hidden="true"/>放大查看</span></button><figcaption>{failedFrames.includes(section.id) ? <>画面加载失败。<button onClick={() => setRetry(value => value + 1)}>重试画面</button></> : "关键画面"}{onCompose ? <button onClick={() => onCompose(`关于方案「${result?.revision.slice(0,8)}」段落「${section.id}」的关键画面，我想调整：`)}>对此画面提意见</button> : null}</figcaption></figure> : <p role="status">{section.keyframe.status === 'failed' ? section.keyframe.message || '关键画面制作未完成，请在对话中重试。' : '关键画面正在准备中'}</p> : null}
      </article>)}</div>
      {document.materials.length ? <p>使用素材：{document.materials.join('、')}</p> : null}
      {document.missingMaterials.length ? <p className="plan-materials">需要补充：{document.missingMaterials.join('、')}</p> : null}
    </> : result?.markdown ? <Suspense fallback={<p>正在显示方案…</p>}><MarkdownPreview projectId={project.id}>{result.markdown}</MarkdownPreview></Suspense> : !loading && !error ? <div className="plan-empty"><p>在对话中添加内容或参考资料。</p></div> : null}
    {result && !result.ready && !working && !loading && onCompose ? <p>方案还未准备完整。<button onClick={() => onCompose("请继续完善当前方案与实际关键画面，保留已确定的内容和设计，完成后再让我确认制作。")}>继续完善方案</button></p> : null}
    {result?.checkpointId && onConfirm ? <footer className="plan-confirm">{working || !result.ready ? <p>{working ? '方案更新中。' : '正在准备关键画面。'}</p> : null}<button className="primary-button primary-fill" disabled={!canConfirm} onClick={() => result.checkpointId && onConfirm({ checkpointId: result.checkpointId, revision: result.revision })}>{confirming ? '正在提交…' : '按这个方案制作'}<ArrowRight/></button></footer> : null}
  </section>;
  return <>{compact ? <details><summary>查看制作方案</summary>{content}</details> : content}
    {expandedFrame ? <PlanFramePreview title={expandedFrame.title} description={expandedFrame.description} src={`${api.fileUrl(project.id, expandedFrame.path)}?revision=${result?.revision}&retry=${retry}`} onClose={() => setExpandedFrame(null)}/> : null}
  </>;
}

function PlanFramePreview({ title, description, src, onClose }: { title: string; description: string; src: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  return <ActionDialog title={title} className="plan-frame-dialog" onClose={onClose}>
    <div className="asset-zoom-controls" role="group" aria-label="关键画面缩放">
      <button aria-label="缩小画面" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))}><Minus/></button>
      <button aria-label="适应窗口" onClick={() => setZoom(1)}>{zoom === 1 ? '适应窗口' : `${Math.round(zoom * 100)}% · 重置`}</button>
      <button aria-label="放大画面" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .5))}><Plus/></button>
    </div>
    <div className="plan-frame-image" role="region" aria-label="关键画面预览，可滚动查看" tabIndex={0}>
      <img src={src} alt={`${title}的关键画面`} style={{ width: `${zoom * 100}%` }}/>
    </div>
    <p>{description} · 放大后可滚动查看细节。</p>
  </ActionDialog>;
}
