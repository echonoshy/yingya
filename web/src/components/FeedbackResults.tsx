import { useEffect, useState } from 'react';
import { z } from 'zod';
import { scopedUrl, sessionFetch } from '../session';
import type { ProjectDetail, VisualFeedback } from '../types';
const schema = z.object({ items: z.array(z.object({ feedbackId:z.string(), sourceVersionId:z.string(), note:z.string(), status:z.enum(['queued','running','incomplete','completed']), summary:z.string(), resultVersionId:z.string().optional(), targetTimeSeconds:z.number().optional() })) });
export function FeedbackResults({ project, onView, onRetry }: { project: ProjectDetail; onView:(versionId:string,time?:number)=>void; onRetry:(feedback:VisualFeedback)=>void }) {
  const [items,setItems]=useState<z.infer<typeof schema>['items']>([]);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);
  const hasFeedback=project.messages.some(message=>message.feedback?.length);
  useEffect(()=>{
    if(!hasFeedback) return;
    let disposed=false;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    void sessionFetch(scopedUrl(`/api/agent-projects/${project.id}/feedback-results`),{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error();return schema.parse(await response.json());}).then(result=>{if(!disposed){setItems(result.items);setError('');}}).catch(()=>{if(!disposed)setError('修改状态读取失败，意见仍已保留。');}).finally(()=>clearTimeout(timer));
    return()=>{disposed=true;clearTimeout(timer);controller.abort();};
  },[project.id,project.updatedAt,hasFeedback,reload]);
  if(!hasFeedback)return null;
  return <section className="feedback-results" aria-label="修改处理结果"><h3>本项目的修改意见</h3>{error?<p role="alert">{error}<button onClick={()=>setReload(value=>value+1)}>重新读取</button></p>:null}{items.map(item=><article key={item.feedbackId}><header><b>{{queued:'等待处理',running:'正在处理',incomplete:'暂未完成',completed:'已修改'}[item.status]}</b><small>来自 {item.sourceVersionId}</small></header><p>{item.note}</p><p>{item.summary}</p>{item.status==='completed'&&item.resultVersionId?<button onClick={()=>onView(item.resultVersionId!,item.targetTimeSeconds)}>{item.targetTimeSeconds===undefined?'查看修改版本':'查看这处修改'}</button>:item.status==='incomplete'?<button onClick={()=>{ const feedback=project.messages.flatMap(message=>message.feedback??[]).find(feedback=>feedback.id===item.feedbackId); if(feedback)onRetry(feedback); }}>继续处理这条意见</button>:null}</article>)}</section>;
}
