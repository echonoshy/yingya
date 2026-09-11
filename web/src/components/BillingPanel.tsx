import { useEffect, useState } from 'react';
import { ArrowsClockwise, CaretLeft, CaretRight, DownloadSimple, FileText, Receipt } from '@phosphor-icons/react';
import { billingMonth, billingReportSchema, downloadInvoice, invoiceSchema, modelName, money, type Bill, type BillingReport, type Invoice } from '../billing';
import { formatUsage as number } from '../usage';
import { sessionFetch } from '../session';
import { EditorDialog } from '../admin/AdminEditors';
import { date } from '../admin/api';
import '../admin/admin.css';
import './billing.css';

function BillingTotals({bill}:{bill:Bill}) {
  return <section className="admin-summary billing-summary" aria-label="费用汇总">
    <div><span>已核对估算金额</span><strong>{money(bill.totals.totalCostUsd)}</strong><small>USD</small></div>
    <div><span>输入 Token</span><strong>{number(bill.totals.inputTokens)}</strong><small>{money(bill.totals.inputCostUsd)} · 含缓存 {number(bill.totals.cachedInputTokens)}</small></div>
    <div><span>输出 Token</span><strong>{number(bill.totals.outputTokens)}</strong><small>{money(bill.totals.outputCostUsd)}</small></div>
    <div><span>调用次数</span><strong>{number(bill.totals.calls)}</strong><small>{bill.totals.pendingCalls?`${bill.totals.pendingCalls} 次待核对`:'用量已核对'}</small></div>
  </section>;
}
function BillLines({bill,administrative}:{bill:Bill;administrative:boolean}) {
  const [page,setPage]=useState(1);
  const pages=Math.max(1,Math.ceil(bill.lines.length/20));const current=Math.min(page,pages);
  return <><div className="admin-table-scroll billing-table" tabIndex={0} aria-label="计价明细"><table><thead><tr>{administrative?<th>用户</th>:null}<th>模型 / 单价（USD / 1M）</th><th>输入 / 缓存 Token</th><th>输出 Token</th><th>输入金额</th><th>输出金额</th><th>小计</th></tr></thead><tbody>{bill.lines.slice((current-1)*20,current*20).map((line,index)=><tr key={index}>
    {administrative?<th scope="row">{line.email}</th>:null}<td>{modelName(line.model)}<small>{line.inputPerMillion===null?'缺少历史明细':`入 ${line.inputPerMillion} · 缓 ${line.cachedInputPerMillion} · 出 ${line.outputPerMillion}`}</small><small>{line.totals.pendingCalls?`${line.totals.pendingCalls} 次待核对`:`${line.totals.calls} 次调用`}</small></td>
    <td title={String(line.totals.inputTokens)}>{line.totals.knownCalls?number(line.totals.inputTokens):'待核对'}<small>{line.totals.knownCalls?`缓存 ${number(line.totals.cachedInputTokens)}`:''}</small></td><td title={String(line.totals.outputTokens)}>{line.totals.knownCalls?number(line.totals.outputTokens):'待核对'}</td>
    <td>{line.totals.knownCalls?money(line.totals.inputCostUsd):'未计价'}</td><td>{line.totals.knownCalls?money(line.totals.outputCostUsd):'未计价'}</td><td>{line.totals.knownCalls?money(line.totals.totalCostUsd):'未计价'}</td>
  </tr>)}</tbody></table>{!bill.lines.length?<div className="admin-empty"><Receipt/><p>这个月份暂无调用记录</p></div>:null}</div>{pages>1?<footer className="admin-pagination"><span>{bill.lines.length} 条明细</span><div><button className="admin-icon" title="上一页明细" aria-label="上一页明细" disabled={current===1} onClick={()=>setPage(current-1)}><CaretLeft/></button><span>{current} / {pages}</span><button className="admin-icon" title="下一页明细" aria-label="下一页明细" disabled={current===pages} onClick={()=>setPage(current+1)}><CaretRight/></button></div></footer>:null}</>;
}

export function BillingPanel({administrative=false,members=[],onAuthenticationError}:{administrative?:boolean;members?:{id:string;email:string}[];onAuthenticationError?:()=>void}) {
  const [month,setMonth]=useState(billingMonth),[owner,setOwner]=useState(''),[refresh,setRefresh]=useState(0);
  const [report,setReport]=useState<BillingReport|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [invoice,setInvoice]=useState<Invoice|null>(null);
  const prefix=administrative?'/api/admin/billing':'/api/billing';
  async function call(path:string,init?:RequestInit) {
    const response=await sessionFetch(prefix+path,{...init,cache:'no-store',headers:{'Content-Type':'application/json',...init?.headers}});
    const value=await response.json();
    if(!response.ok){if(response.status===401||response.status===403)onAuthenticationError?.();throw new Error(value.message||'无法读取账单');}
    return value;
  }
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setReport(null);setError('');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){setLoading(false);return()=>controller.abort();}
    const params=new URLSearchParams({month,...(administrative&&owner?{userId:owner}:{})});
    void call(`?${params}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setReport(billingReportSchema.parse(value));}).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[month,owner,refresh,administrative]);
  async function generate(){if(busy||!report)return;setBusy(true);setError('');try{const result=await call('/invoices',{method:'POST',body:JSON.stringify({month,...(administrative&&owner?{userId:owner}:{})})});setInvoice(invoiceSchema.parse(result.invoice));setRefresh(value=>value+1);}catch(error){setError(error instanceof Error?error.message:'生成账单失败');}finally{setBusy(false);}}
  async function open(id:string){setBusy(true);setError('');try{const result=await call(`/invoices/${encodeURIComponent(id)}`);setInvoice(invoiceSchema.parse(result.invoice));}catch(error){setError(error instanceof Error?error.message:'读取账单失败');}finally{setBusy(false);}}
  return <section className="billing-panel"><header className="admin-page-heading"><div><p>映芽 / {administrative?'管理后台':'我的账号'}</p><h1>API 等价账单</h1></div><div className="admin-toolbar-actions"><button className="admin-icon" title="刷新账单" aria-label="刷新账单" disabled={loading||busy} onClick={()=>setRefresh(value=>value+1)}><ArrowsClockwise className={loading?'spin':''}/></button><button className="admin-button primary" disabled={loading||busy||!report?.totals.calls} onClick={()=>void generate()}><FileText/>{busy?'正在处理…':'生成账单'}</button></div></header>
    <div className="billing-filters"><label>账单月份<input aria-label="账单月份" type="month" value={month} disabled={busy} onChange={event=>setMonth(event.target.value)} min="2000-01" max="9998-12"/></label>{administrative?<label>用户<select aria-label="用户" value={owner} disabled={busy} onChange={event=>setOwner(event.target.value)}><option value="">全部用户</option>{members.map(member=><option key={member.id} value={member.id}>{member.email}</option>)}</select></label>:null}<span>北京时间 · USD · Standard</span></div>
    {error?<p className="admin-error" role="alert">{error}</p>:null}{loading?<div className="admin-empty" role="status">正在读取费用…</div>:null}
    {report?<><BillingTotals bill={report}/>{report.totals.pendingCalls?<p className="billing-warning" role="status">有 {report.totals.pendingCalls} 次调用正在进行或缺少完整用量，金额暂未计入，不代表免费。</p>:null}
      <BillLines key={`${month}:${owner}`} bill={report} administrative={administrative}/>
      <section className="billing-history"><h2>已生成账单</h2><div className="admin-table-scroll billing-table" tabIndex={0} aria-label="已生成账单"><table><thead><tr><th>账单编号</th><th>生成时间</th>{administrative?<th>用户</th>:null}<th>已核对金额</th><th>状态</th><th>操作</th></tr></thead><tbody>{report.invoices.map(item=><tr key={item.id}><td>{item.id}</td><td>{date(item.createdAt)}</td>{administrative?<td>{item.userId?(members.find(member=>member.id===item.userId)?.email||item.userId):'全部用户'}</td>:null}<td>{money(item.totalCostUsd)}</td><td>{item.pendingCalls?'含待核对调用':'已核对快照'}</td><td><button className="admin-icon" title="查看账单" aria-label={`查看账单 ${item.id}`} disabled={busy} onClick={()=>void open(item.id)}><FileText/></button></td></tr>)}</tbody></table>{!report.invoices.length?<p className="billing-empty">尚未生成这个月份的账单</p>:null}</div></section>
      <details className="billing-rates"><summary>计价规则与参考单价</summary><p>输入费用 = 非缓存输入 × 输入单价 + 缓存输入 × 缓存单价；输出费用 = 输出 Token × 输出单价。推理已含在输出中，不重复相加。</p><p>超过 272K 输入 Token 的单次请求，输入与缓存单价按 2 倍、输出按 1.5 倍计算。这里只估算 Standard 文本 Token 费用，不含缓存写入溢价、Fast / Batch 差价、素材与工具调用费用，不是实际扣款或税务发票。</p><div className="admin-table-scroll billing-table"><table><thead><tr><th>模型</th><th>输入 / 1M</th><th>缓存 / 1M</th><th>输出 / 1M</th></tr></thead><tbody>{report.prices.map(price=><tr key={price.model}><th><a href={price.source} target="_blank" rel="noreferrer">{modelName(price.model)}</a></th><td>{money(price.inputPerMillion)}</td><td>{money(price.cachedInputPerMillion)}</td><td>{money(price.outputPerMillion)}</td></tr>)}</tbody></table></div><p>参考价版本：{report.priceVersion}。历史调用按发生时保存的单价计算；旧记录缺少输入/输出明细时不回填金额。生成账单保存当前已知用量快照，未结束账期可在后续调用后重新生成。最多显示最近 100 份快照。</p></details>
    </>:null}
    {invoice?<EditorDialog title="API 等价账单" busy={false} onClose={()=>setInvoice(null)}><div className="admin-dialog-body billing-invoice"><div className="admin-detail-meta"><span>{invoice.id}</span><span>{invoice.month} · 北京时间 · {invoice.currency}</span><span>生成于 {date(invoice.createdAt)}</span></div><BillingTotals bill={invoice}/>{invoice.totals.pendingCalls?<p className="billing-warning">另有 {invoice.totals.pendingCalls} 次待核对调用未计价。</p>:null}<BillLines bill={invoice} administrative={administrative}/><p className="admin-help">API 等价估算快照，不是实际扣款或税务发票。</p><footer><button className="admin-button primary" onClick={()=>downloadInvoice(invoice)}><DownloadSimple/>下载 CSV</button></footer></div></EditorDialog>:null}
  </section>;
}
