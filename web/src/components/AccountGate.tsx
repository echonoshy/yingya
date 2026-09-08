import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, ChartBar, CircleNotch, EnvelopeSimple, SignOut, UserCircle } from '@phosphor-icons/react';
import { z } from 'zod';
import { App } from '../App';
import { sessionChanged, setCurrentUser } from '../session';
const userSchema = z.object({ id:z.string(), email:z.string(), isAdmin:z.boolean() });
type User = z.infer<typeof userSchema>;
const rowSchema=z.object({userId:z.string(),email:z.string(),requests:z.number(),executions:z.number(),inputTokens:z.number(),outputTokens:z.number(),cachedInputTokens:z.number(),reasoningOutputTokens:z.number(),totalTokens:z.number(),unknownExecutions:z.number()});
const usageSchema=z.object({users:z.array(rowSchema),models:z.array(z.string())});
type Usage=z.infer<typeof usageSchema>;
async function call(path:string, init?:RequestInit) {
 const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers},cache:'no-store'});
 if(response.status===204)return null;
 const body=await response.json();
 if(!response.ok)throw new Error(body.message || '暂时无法连接，请重试');
 return body;
}
export function AccountGate() {
 const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[screen,setScreen]=useState<'work'|'usage'>('work');
 useEffect(()=>{let cancelled=false;void fetch('/api/auth/me',{cache:'no-store'}).then(async response=>{
   if(response.status===401)return;
   if(!response.ok)throw new Error('无法读取登录状态，请刷新重试');
   const value=userSchema.parse((await response.json()).user);
   if(!cancelled){setCurrentUser(value.id);setUser(value);}
 }).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
 const changed=(event:StorageEvent)=>{if(event.key==='yingya-session-change')window.location.reload();};window.addEventListener('storage',changed);
 return()=>{cancelled=true;window.removeEventListener('storage',changed);};},[]);
 async function logout(){try{await call('/api/auth/logout',{method:'POST',body:'{}'});sessionChanged();window.location.replace('/');}catch(e){setError(e instanceof Error?e.message:'退出失败');}}
 if(loading)return <div className="state-screen" role="status"><CircleNotch className="spin"/><p>正在恢复你的工作台…</p></div>;
 if(!user)return <LoginScreen initialError={error} onLogin={value=>{setCurrentUser(value.id);setUser(value);setError('');sessionChanged();window.history.replaceState(null,'','/');}}/>;
 return <div className="account-shell">
   <header className="account-bar"><div className="account-identity"><UserCircle/><span title={user.email}>{user.email}</span><small>内测账号</small></div><nav aria-label="账号"><button onClick={()=>setScreen(screen==='work'?'usage':'work')}><ChartBar/><span>{screen==='work'?'用量统计':'返回创作'}</span></button><button onClick={()=>void logout()} aria-label="退出登录"><SignOut/><span>退出</span></button></nav></header>
   {error?<p className="account-error" role="alert">{error}</p>:null}
   <div hidden={screen!=='work'}><App/></div>
   {screen==='usage'?<UsagePage user={user} onBack={()=>setScreen('work')}/>:null}
 </div>;
}
function LoginScreen({initialError,onLogin}:{initialError:string;onLogin:(user:User)=>void}) {
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(initialError);
 async function submit(event:FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{const body=await call('/api/auth/login',{method:'POST',body:JSON.stringify({email})});onLogin(userSchema.parse(body.user));}catch(e){setError(e instanceof Error?e.message:'登录失败');}finally{setBusy(false);}}
 return <main className="login-screen"><div className="login-brand"><img src="/brand/yingya-ghost.png" alt=""/><span>映芽</span></div><section className="login-content"><span className="login-eyebrow">你的创作，从这里继续</span><h1>进入你的<br/>视频工作台。</h1><p className="login-intro">用对话，把想法做成视频。<br/>项目、素材和创作记录，保存在你的账号空间。</p><form onSubmit={event=>void submit(event)}><label htmlFor="login-email">邮箱地址</label><div className="login-input"><EnvelopeSimple/><input id="login-email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={event=>setEmail(event.target.value)} required maxLength={254} autoFocus/></div><button className="login-submit" disabled={busy}>{busy?<CircleNotch className="spin"/>:null}{busy?'正在进入…':'进入工作台'}{!busy?<ArrowRight/>:null}</button>{error?<p className="account-error" role="alert">{error}</p>:null}</form><aside className="login-notice"><b>内测版 · 邮箱直接登录</b><p>首次使用自动创建账号。目前不验证邮箱归属，知道该邮箱的人也可进入同一账号。仅用于可信内测。</p></aside></section><footer>映芽 · 对话式动画视频制作工作台</footer></main>;
}
function UsagePage({user,onBack}:{user:User;onBack:()=>void}) {
 const [admin,setAdmin]=useState(false),[since,setSince]=useState(''),[until,setUntil]=useState(''),[model,setModel]=useState(''),[data,setData]=useState<Usage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let disposed=false;const controller=new AbortController();setLoading(true);setError('');
 const params=new URLSearchParams();if(since)params.set('since',String(new Date(`${since}T00:00:00`).getTime()/1000));if(until){const date=new Date(`${until}T00:00:00`);date.setDate(date.getDate()+1);params.set('until',String(date.getTime()/1000));}if(model)params.set('model',model);
 void call(`${admin?'/api/admin/usage':'/api/usage'}?${params}`,{signal:controller.signal}).then(value=>{if(!disposed)setData(usageSchema.parse(value));}).catch(e=>{if(!disposed)setError(e.message);}).finally(()=>{if(!disposed)setLoading(false);});return()=>{disposed=true;controller.abort();};},[admin,since,until,model,refresh]);
 const rows=data?.users??[], number=(n:number)=>n.toLocaleString('zh-CN');
 const sum=(key:'requests'|'executions'|'totalTokens'|'unknownExecutions')=>rows.reduce((n,row)=>n+row[key],0);
 return <main className="usage-page"><div className="usage-heading"><button className="usage-back" onClick={onBack}><ArrowLeft/>返回工作台</button><div><span>创作记录</span><h1>用量统计</h1><p>查看请求次数与模型实际返回的 token 用量。</p></div></div>
 <div className="usage-toolbar">{user.isAdmin?<div className="usage-tabs"><button aria-pressed={!admin} onClick={()=>setAdmin(false)}>我的用量</button><button aria-pressed={admin} onClick={()=>setAdmin(true)}>所有用户</button></div>:<b>我的用量</b>}<button className="usage-refresh" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>{loading?'正在更新…':'刷新数据'}</button></div>
 <div className="usage-filters"><label>开始日期<input type="date" value={since} onChange={e=>setSince(e.target.value)}/></label><label>结束日期<input type="date" value={until} onChange={e=>setUntil(e.target.value)}/></label><label>模型<select value={model} onChange={e=>setModel(e.target.value)}><option value="">全部模型</option>{data?.models.map(value=><option key={value}>{value}</option>)}</select></label></div>
 {error?<p className="account-error" role="alert">{error}</p>:null}
 <section className="usage-metrics" aria-label="用量汇总" aria-busy={loading}>{[['请求次数',sum('requests'),'次'],['Agent 执行',sum('executions'),'轮'],['总 token',sum('totalTokens'),'tokens']].map(([label,value,unit])=><div key={String(label)}><span>{label}</span><strong>{loading?'—':number(Number(value))}</strong><small>{unit}</small></div>)}</section>
 <div className="usage-table-wrap"><table><caption>{admin?'按用户汇总':'当前账号用量'}{model?' · 请求次数为全部模型合计':''}</caption><thead><tr>{['邮箱','请求','执行','输入 token','输出 token','缓存输入','推理输出','总 token'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.userId}><th scope="row">{row.email}</th>{[row.requests,row.executions,row.inputTokens,row.outputTokens,row.cachedInputTokens,row.reasoningOutputTokens,row.totalTokens].map((value,i)=><td key={i}>{loading?'—':number(value)}</td>)}</tr>)}</tbody></table>{!loading&&!rows.length?<p className="usage-empty">这个时间范围内暂无用户记录。</p>:null}</div>
 <div className="usage-notes"><p>一次创作或修改计为一次请求；自动标题和重试可能增加执行轮次。失败或中断仍保留已消耗的 token。</p><p>缓存输入、推理输出为明细项，不额外加到总 token。语音、音乐等服务的调用不折算成模型 token。</p>{sum('unknownExecutions')>0?<p>有 {sum('unknownExecutions')} 轮执行尚未收到用量，未按零消耗计算。</p>:null}<p>统计从本版本启用后开始记录，原共享项目未自动分配或计入。</p></div>
 </main>;
}
