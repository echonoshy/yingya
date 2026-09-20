import { lazy, Suspense, useEffect, useState } from 'react';
import { ChatText, CircleNotch, ArrowRight, ArrowClockwise } from '@phosphor-icons/react';
import { api } from '../api';
import type { ProjectDetail } from '../types';
import type { ExplanationPlan, PlanReceipt } from '../explanationPlan';
const MarkdownPreview = lazy(() => import('./MarkdownPreview'));
export function PlanDocument({ project, compact = false, onCompose, onConfirm, confirming = false }: { project: ProjectDetail; compact?: boolean; onCompose?: (text: string) => void; onConfirm?: (receipt: PlanReceipt) => void; confirming?: boolean }) {
  const [result, setResult] = useState<ExplanationPlan | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
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
    <header><div><small>制作方案</small><h2>{document?.title || '先确定怎么讲，再制作视频'}</h2></div>{working || loading ? <span role="status"><CircleNotch className="spin"/>{loading ? '读取方案中' : '正在完善方案'}</span> : null}</header>
    {error ? <p className="form-error" role="alert">{error}<button onClick={() => setRetry(value => value + 1)}><ArrowClockwise/>重新读取</button></p> : null}
    {document ? <>
      <dl className="plan-brief"><div><dt>讲给谁听</dt><dd>{document.audience}</dd></div><div><dt>核心问题</dt><dd>{document.question}</dd></div><div><dt>看完理解</dt><dd>{document.takeaway}</dd></div></dl>
      <p className="plan-meta">预计 {Math.round(document.durationSeconds)} 秒 · {document.aspectRatio} · {document.narration}</p>
      <div className="plan-sections">{document.sections.map((section, index) => <article key={section.id}>
        <header><h3>{index + 1}. {section.title}</h3>{onCompose ? <button type="button" onClick={() => onCompose(`关于方案「${result?.revision.slice(0,8)}」的段落「${section.id}」（${section.title}），我想调整：`)}><ChatText/>对此提意见</button> : null}</header>
        <p>{section.summary}</p><p className="plan-expression">画面：{section.expression}</p>
        {section.keyframe ? section.keyframe.status === 'ready' && section.keyframe.path ? <figure><img key={`${section.id}:${retry}`} onError={() => setFailedFrames(items => items.includes(section.id) ? items : [...items, section.id])} src={`${api.fileUrl(project.id, section.keyframe.path)}?revision=${result?.revision}&retry=${retry}`} alt={`${section.title}的关键画面`} loading="lazy"/><figcaption>{failedFrames.includes(section.id) ? <>画面加载失败。<button onClick={() => setRetry(value => value + 1)}>重试画面</button></> : "实际制作源中的关键画面"}{onCompose ? <button onClick={() => onCompose(`关于方案「${result?.revision.slice(0,8)}」段落「${section.id}」的关键画面，我想调整：`)}>对此画面提意见</button> : null}</figcaption></figure> : <p role="status">{section.keyframe.status === 'failed' ? section.keyframe.message || '关键画面制作未完成，请在对话中重试。' : '关键画面正在准备中'}</p> : null}
      </article>)}</div>
      {document.materials.length ? <p>使用素材：{document.materials.join('、')}</p> : null}
      {document.missingMaterials.length ? <p className="plan-materials">需要补充：{document.missingMaterials.join('、')}</p> : null}
    </> : result?.markdown ? <Suspense fallback={<p>正在显示方案…</p>}><MarkdownPreview projectId={project.id}>{result.markdown}</MarkdownPreview></Suspense> : !loading && !error ? <div className="plan-empty"><p>提供想法、资料或素材，映芽会整理讲解顺序与关键画面。</p><p>你可以继续在对话中补充受众、重点和参考。</p></div> : null}
    {result && !result.ready && !working && !loading && onCompose ? <p>方案还未准备完整。<button onClick={() => onCompose("请继续完善当前方案与实际关键画面，保留已确定的内容和设计，完成后再让我确认制作。")}>继续完善方案</button></p> : null}
    {result?.checkpointId && onConfirm ? <footer className="plan-confirm"><p>{working ? '方案更新完成后可以确认制作。' : !result.ready ? '关键画面准备完成后可以确认制作。' : '确认内容和画面方向后，映芽会制作完整视频。'}</p><button className="primary-button primary-fill" disabled={!canConfirm} onClick={() => result.checkpointId && onConfirm({ checkpointId: result.checkpointId, revision: result.revision })}>{confirming ? '正在提交…' : '按这个方案制作'}<ArrowRight/></button></footer> : null}
  </section>;
  return compact ? <details><summary>查看制作方案</summary>{content}</details> : content;
}
