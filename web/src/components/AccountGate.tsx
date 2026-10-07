import "../product-styles.css";
import { AvatarPicker, useAccountAvatar } from "./AvatarPicker";
import { AccountMenu } from './AccountMenu';
import { animateElement } from "./motion";
import { AppNavigation } from "./AppNavigation";
import { VersionHistory } from './VersionHistory';
import { ContactAdminDialog } from './ContactAdminDialog';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CircleNotch } from '@phosphor-icons/react';
import { z } from 'zod';
import { App } from '../App';
import { UsageModelFilter } from './UsageModelFilter';
import { SESSION_EXPIRED, sessionFetch, sessionChanged, setCurrentUser } from '../session';
import { LoginScreen, QuotaOverview } from './AccountAccess';
import { formatUsage as number } from '../usage';
import { BillingPanel } from './BillingPanel';
import './account-pages.css';
const userSchema = z.object({ id:z.string(), email:z.string(), isAdmin:z.boolean() });
type User = z.infer<typeof userSchema>;
const rowSchema=z.object({userId:z.string(),email:z.string(),requests:z.number(),executions:z.number(),inputTokens:z.number(),outputTokens:z.number(),cachedInputTokens:z.number(),reasoningOutputTokens:z.number(),totalTokens:z.number(),unknownExecutions:z.number()});
const usageSchema=z.object({users:z.array(rowSchema),models:z.array(z.string())});
type Usage=z.infer<typeof usageSchema>;
async function call(path:string, init?:RequestInit) {
 const response=await sessionFetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers},cache:'no-store'});
 if(response.status===204)return null;
 const body=await response.json();
 if(!response.ok)throw new Error(body.message || '暂时无法连接，请重试');
 return body;
}
export function AccountGate() {
 const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[screen,setScreen]=useState<'work'|'usage'|'billing'>('work');
 const avatarState = useAccountAvatar(user?.id);
 const [avatarOpen,setAvatarOpen]=useState(false);
 const [versionOpen,setVersionOpen]=useState(false);
 const [contactOpen,setContactOpen]=useState(false);
 const accountTrigger=useRef<HTMLElement|null>(null);
 function avatarTap(event: React.MouseEvent<HTMLElement>) {
   accountTrigger.current=event.currentTarget;
   const image=event.currentTarget.querySelector<HTMLElement>('.account-avatar');
   if(image){image.getAnimations().forEach(animation=>animation.cancel());animateElement(image,[{transform:'scale(1) rotate(0deg)'},{transform:'scale(.94, 1.04) rotate(-5deg)',offset:.3},{transform:'scale(1.02) rotate(4deg)',offset:.65},{transform:'scale(1) rotate(0deg)'}],'--motion-slow');}
 }
 useEffect(()=>{let cancelled=false;void fetch('/api/auth/me',{cache:'no-store'}).then(async response=>{
   if(response.status===401)return;
   if(!response.ok)throw new Error('无法读取登录状态，请刷新重试');
   const value=userSchema.parse((await response.json()).user);
   if(!cancelled){setCurrentUser(value.id);setUser(value);}
 }).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
 const expired=()=>{cancelled=true;setAvatarOpen(false);setVersionOpen(false);setContactOpen(false);setUser(null);setScreen('work');setError('登录已过期，请重新登录后继续');setLoading(false);};
 window.addEventListener(SESSION_EXPIRED,expired);
 const changed=(event:StorageEvent)=>{if(event.key==='yingya-session-change')window.location.reload();};window.addEventListener('storage',changed);
 return()=>{cancelled=true;window.removeEventListener('storage',changed);window.removeEventListener(SESSION_EXPIRED,expired);};},[]);
 async function logout(){try{await call('/api/auth/logout',{method:'POST',body:'{}'});sessionChanged();window.location.replace('/');}catch(e){setError(e instanceof Error?e.message:'退出失败');}}
 if(loading)return <div className="state-screen" role="status"><CircleNotch className="spin"/><p>正在恢复你的工作台…</p></div>;
 if(!user)return <LoginScreen initialError={error} onLogin={value=>{setCurrentUser(value.id);setUser(value);setError('');sessionChanged();window.history.replaceState(null,'',`/app${window.location.search}${window.location.hash}`);}}/>;
 const accountPanel = <AccountMenu email={user.email} isAdmin={user.isAdmin} avatarUrl={avatarState.avatar?.url} error={error}
   returnFocus={accountTrigger} onAvatarTap={avatarTap} onAvatar={()=>setAvatarOpen(true)} onUsage={()=>setScreen('usage')}
   onBilling={()=>setScreen('billing')} onVersion={()=>setVersionOpen(true)} onContact={()=>setContactOpen(true)} onLogout={logout}/>;
 return <div className="account-shell">
   {versionOpen?<VersionHistory onClose={()=>setVersionOpen(false)}/>:null}
   {contactOpen?<ContactAdminDialog onClose={()=>setContactOpen(false)} returnFocus={accountTrigger}/>:null}
   {avatarOpen?<AvatarPicker current={avatarState.avatar} loadError={avatarState.error} onRetry={avatarState.retry} onSaved={avatarState.saved} onClose={()=>setAvatarOpen(false)} returnFocus={accountTrigger}/>:null}
   <div hidden={screen!=='work'}><App accountPanel={accountPanel}/></div>
   {screen!=='work'?<div className="home-layout studio-shell studio-shell--library editorial-shell account-pages"><AppNavigation active="account" onProjects={()=>{window.location.hash='/projects';setScreen('work');}} onCreate={()=>{window.location.hash='/';setScreen('work');}} onAssets={()=>{window.location.hash='/assets';setScreen('work');}} accountPanel={accountPanel}/>{screen==='billing'?<main className="billing-page"><button className="usage-back" onClick={()=>setScreen('work')}><ArrowLeft/>返回工作台</button><BillingPanel/></main>:<UsagePage onBack={()=>setScreen('work')}/>}</div>:null}
 </div>;
}
function UsagePage({onBack}:{onBack:()=>void}) {
 const [{since,until},setDateRange]=useState(()=>{
   const today=new Date();
   const previousMonthEnd=new Date(today.getFullYear(),today.getMonth(),0);
   const start=new Date(today.getFullYear(),today.getMonth()-1,Math.min(today.getDate(),previousMonthEnd.getDate()));
   const format=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
   return {since:format(start),until:format(today)};
 });
 const [models,setModels]=useState<string[]>([]);
 const [model,setModel]=useState(''),[data,setData]=useState<Usage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const rangeError=since&&until&&since>until?'开始日期不能晚于结束日期':'';
 useEffect(()=>{let disposed=false;const controller=new AbortController();setLoading(true);setData(null);setError('');
 if(rangeError){setLoading(false);return()=>controller.abort();}
 const params=new URLSearchParams();if(since)params.set('since',String(new Date(`${since}T00:00:00`).getTime()/1000));if(until){const date=new Date(`${until}T00:00:00`);date.setDate(date.getDate()+1);params.set('until',String(date.getTime()/1000));}if(model)params.set('model',model);
 void call(`/api/usage?${params}`,{signal:controller.signal}).then(value=>{if(!disposed){const next=usageSchema.parse(value);setData(next);setModels(next.models);}}).catch(e=>{if(!disposed)setError(e.message);}).finally(()=>{if(!disposed)setLoading(false);});return()=>{disposed=true;controller.abort();};},[since,until,model,refresh,rangeError]);
 const rows=data?.users??[];
 const sum=(key:'requests'|'executions'|'totalTokens'|'unknownExecutions')=>rows.reduce((n,row)=>n+row[key],0);
 return <main className="usage-page"><div className="usage-heading"><button className="usage-back" onClick={onBack}><ArrowLeft/>返回工作台</button><div className="usage-title-row"><div><h1>用量统计</h1><p>按日期和模型查看创作消耗</p></div><button className="usage-refresh" disabled={loading||!!rangeError} onClick={()=>setRefresh(v=>v+1)}>{loading?'正在更新…':'刷新数据'}</button></div></div>
 <div className="usage-filters"><label>开始日期<input type="date" aria-invalid={!!rangeError} aria-describedby={rangeError?"usage-range-error":undefined} max={until||undefined} value={since} onChange={e=>{const since=e.target.value;setDateRange(range=>({...range,since}));}}/></label><label>结束日期<input type="date" aria-invalid={!!rangeError} aria-describedby={rangeError?"usage-range-error":undefined} min={since||undefined} value={until} onChange={e=>{const until=e.target.value;setDateRange(range=>({...range,until}));}}/></label><UsageModelFilter models={models} value={model} onChange={setModel}/></div>
 {rangeError?<p id="usage-range-error" className="account-error" role="alert">{rangeError}</p>:null}
 {error?<div className="usage-load-error" role="alert"><p>用量暂时未能加载 · {error}</p><button className="usage-refresh" onClick={()=>setRefresh(v=>v+1)}>重新加载用量</button></div>:null}
 <section className="usage-metrics" aria-label="用量汇总" aria-busy={loading}>{[['请求次数',sum('requests'),'次'],['执行轮次',sum('executions'),'轮'],['总 Token',sum('totalTokens'),'Token']].map(([label,value,unit])=><div key={String(label)}><span>{label}</span><strong>{loading||!data?'—':number(Number(value))}</strong><small>{unit}</small></div>)}</section>
 {data&&rows.length?<div className="usage-table-wrap" tabIndex={0} role="region" aria-label="用量明细，可横向滚动"><table><caption>当前账号用量{model?' · 请求次数为全部模型合计':''}</caption><thead><tr>{['邮箱','请求','执行','输入 token','输出 token','缓存输入','推理输出','总 token'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.userId}><th scope="row">{row.email}</th>{[row.requests,row.executions,row.inputTokens,row.outputTokens,row.cachedInputTokens,row.reasoningOutputTokens,row.totalTokens].map((value,i)=><td key={i}>{loading?'—':number(value)}</td>)}</tr>)}</tbody></table></div>:data?<p className="usage-empty">这个时间范围内暂无用量记录，可调整日期或模型</p>:null}
 {data&&sum('unknownExecutions')>0?<p className="usage-pending" role="status">有 {sum('unknownExecutions')} 轮执行尚未收到用量，暂未计入统计</p>:null}
 <details className="usage-quota"><summary>账户额度与使用说明</summary><QuotaOverview refresh={refresh}/></details>
 <details className="usage-notes"><summary>统计口径</summary><p>一次创作或修改计为一次请求；自动标题和重试可能增加执行轮次；失败或中断仍保留已消耗的 token</p><p>缓存输入、推理输出为明细项，不额外加到总 token；语音、音乐等服务的调用不折算成模型 token</p><p>统计从本版本启用后开始记录，原共享项目未自动分配或计入</p></details>
 </main>;
}
