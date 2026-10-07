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
  const [selectedSectionId, setSelectedSectionId] = useState('');
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
  const selectedSection = document?.sections.find(section => section.id === selectedSectionId) ?? document?.sections[0];
  const selectedFrame = selectedSection?.keyframe;
  const canConfirm = !failedFrames.length && !loading && !error && result?.ready && result.checkpointId === project.manifest.checkpoint?.id && !working && !confirming;
  const offersFrameReference = Boolean(!document && result?.markdown || selectedSection && selectedFrame?.status !== 'ready');
  const frameFailed = selectedSection ? failedFrames.includes(selectedSection.id) : false;
  function selectScene(index: number) {
    const section = document?.sections[index];
    if (section) setSelectedSectionId(section.id);
  }
  const content = <section className="plan-document knowledge-plan" aria-label="制作方案">
    <div className="plan-scroll">
      <header className="plan-heading"><div><h2>{document?.title || '先把故事讲清楚。'}</h2><p className="plan-review-hint">先看图片与关键画面，结合参考视频确认风格，再开始制作。</p></div>{working || loading ? <span role="status"><CircleNotch className="spin"/>{loading ? '读取方案中' : '正在完善方案'}</span> : null}</header>
      {error ? <div className="plan-read-error" role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}><ArrowClockwise/>重新读取</button></div> : null}
      {document ? <>
        <div className="plan-overview"><p className="plan-meta">预计 {Math.round(document.durationSeconds)} 秒<span>·</span>{document.aspectRatio}<span>·</span>{document.narration}</p><details className="plan-context"><summary>视频目标与讲法</summary><dl className="plan-brief"><div><dt>讲给谁听</dt><dd>{document.audience}</dd></div><div><dt>核心问题</dt><dd>{document.question}</dd></div><div><dt>看完理解</dt><dd>{document.takeaway}</dd></div></dl></details></div>
        <figure className="plan-feature-frame">
          {selectedSection && selectedFrame?.status === 'ready' && selectedFrame.path && !frameFailed ? <button type="button" className="plan-keyframe-open" aria-label={`放大当前画面：${selectedSection.title}`} onClick={() => setExpandedFrame({ title: selectedSection.title, path: selectedFrame.path!, description: selectedSection.expression })}>
            <img key={`${selectedSection.id}:${retry}`} src={`${api.fileUrl(project.id, selectedFrame.path)}?revision=${result?.revision}&retry=${retry}`} alt={`${selectedSection.title}的关键画面`} onError={() => setFailedFrames(items => items.includes(selectedSection.id) ? items : [...items, selectedSection.id])}/><span><ArrowsOut aria-hidden="true"/>放大查看</span>
          </button> : <div className="plan-frame-pending"><p>{frameFailed ? '画面加载失败' : selectedFrame?.status === 'failed' ? selectedFrame.message || '关键画面制作未完成' : selectedFrame?.status === 'pending' ? '关键画面正在准备中' : '这一段还需要画面参考'}</p>{frameFailed ? <button onClick={() => setRetry(value => value + 1)}><ArrowClockwise/>重试画面</button> : <small>{selectedFrame ? '制作完成后会在这里显示' : '代表画面展示在已准备好的段落中'}</small>}</div>}
          <figcaption><span>{selectedSection?.title || '关键画面'}</span><span>{selectedSection ? String(document.sections.indexOf(selectedSection) + 1).padStart(2, '0') : '00'} / {String(document.sections.length).padStart(2, '0')}</span></figcaption>
        </figure>
        <div className="plan-sections" role="group" aria-label="方案段落">{document.sections.map((section, index) => <button key={section.id} type="button" className="plan-scene-select" aria-pressed={selectedSection?.id === section.id} onClick={() => selectScene(index)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % document.sections.length : event.key === 'ArrowLeft' ? (index + document.sections.length - 1) % document.sections.length : event.key === 'Home' ? 0 : event.key === 'End' ? document.sections.length - 1 : -1;
          if (next < 0) return; event.preventDefault(); selectScene(next); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
        }}><span>{String(index + 1).padStart(2, '0')}</span><b>{section.title}</b><small>{section.keyframe?.status === 'ready' ? '画面已就绪' : section.keyframe ? '画面准备中' : '查看讲法'}</small></button>)}</div>
        {selectedSection ? <div className="plan-scene-detail" key={selectedSection.id}>
          <div><h3>讲什么</h3><p>{selectedSection.summary}</p></div><div><h3>怎么表现</h3><p>{selectedSection.expression}</p></div>
          {onCompose ? <div className="plan-scene-actions"><button type="button" onClick={() => onCompose(`关于方案「${result?.revision.slice(0,8)}」的段落「${selectedSection.id}」（${selectedSection.title}），我想调整：`)}><ChatText/>对此段提意见</button>{!working && selectedFrame?.status !== 'ready' ? <button type="button" onClick={() => onCompose(`请先为方案段落「${selectedSection.id}」（${selectedSection.title}）生成图片参考或实际关键画面，结合已提供的参考视频确认构图、配色与质感，再继续完善方案。`)}>补充画面参考</button> : null}{selectedFrame?.status === 'ready' ? <button type="button" onClick={() => onCompose(`关于方案「${result?.revision.slice(0,8)}」段落「${selectedSection.id}」的关键画面，我想调整：`)}>对此画面提意见</button> : null}</div> : null}
        </div> : null}
        {document.materials.length ? <details className="plan-material-list"><summary>使用素材 · {document.materials.length}</summary><p>{document.materials.join('、')}</p></details> : null}
        {document.missingMaterials.length ? <p className="plan-materials">需要补充：{document.missingMaterials.join('、')}</p> : null}
      </> : result?.markdown ? <><p className="plan-materials">文字方案已整理，可以先补充图片与关键画面来确认方向。</p>{onCompose && !working ? <div className="plan-scene-actions"><button type="button" onClick={() => onCompose('请基于当前方案与参考视频，先生成图片参考和实际关键画面，说明构图、配色与镜头关系，再一起确认制作方向。')}>补充画面参考<ArrowRight/></button></div> : null}<details className="plan-material-list"><summary>查看文字方案</summary><Suspense fallback={<p>正在显示方案…</p>}><MarkdownPreview projectId={project.id}>{result.markdown}</MarkdownPreview></Suspense></details></> : !error ? <div className="plan-empty"><p>{loading ? '正在读取制作方案' : working ? '正在整理视频结构与关键画面' : '在对话中添加内容或参考资料'}</p><small>{working || loading ? '方案就绪后，可在这里审阅并确认制作' : '你的想法会在这里整理成可审阅的制作方案'}</small></div> : null}
      {result && !result.ready && !working && !loading && !error && onCompose && !offersFrameReference ? <div className="plan-incomplete"><p>方案还未准备完整</p><button onClick={() => onCompose("请继续完善当前方案与实际关键画面，保留已确定的内容和设计，完成后再让我确认制作")}>继续完善方案<ArrowRight/></button></div> : null}
    </div>
    {result?.checkpointId && onConfirm ? <footer className="plan-confirm"><p><span className={canConfirm ? 'plan-ready-dot' : 'plan-wait-dot'}/>{confirming ? '正在提交制作请求' : working ? '方案更新中' : error || failedFrames.length ? '请先恢复方案与画面' : !result.ready ? '正在准备关键画面' : '方案与关键画面已就绪'}</p><button className="primary-button primary-fill" disabled={!canConfirm} onClick={() => result.checkpointId && onConfirm({ checkpointId: result.checkpointId, revision: result.revision })}>{confirming ? '正在提交…' : '确认方案并制作'}<ArrowRight/></button></footer> : null}
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
    <p>{description} · 放大后可滚动查看细节</p>
  </ActionDialog>;
}
