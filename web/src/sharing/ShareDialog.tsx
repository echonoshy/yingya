import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, CircleNotch, Copy, LinkBreak, LinkSimple, ArrowSquareOut, Warning } from '@phosphor-icons/react';
import { ActionDialog } from '../components/ActionDialog';
import { api } from '../api';
import { absoluteShareUrl, listShares, message, shareDate, shareRequest, shareSchema, shareSize, shareStatus, type Share } from './api';
import './sharing.css';

function ExpiryOptions() { return <><option value={7}>7 天</option><option value={30}>30 天</option><option value={0}>长期有效</option></>; }
export type ShareSource = { path: string; label: string } & ({ artifactId: string; versionId?: never } | { versionId: string; artifactId?: never });
export function ShareDialog({ projectId, title, source, onClose }: { projectId: string; title: string; source: ShareSource; onClose: () => void }) {
  const [items, setItems] = useState<Share[]>([]), [days, setDays] = useState(7), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [retry, setRetry] = useState(0);
  const pending = useRef(false);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError('');
    void listShares(projectId, controller.signal).then(setItems).catch(error => { if (!controller.signal.aborted) setError(message(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, retry]);
  async function mutate(work: () => Promise<void>) {
    if (pending.current) return; pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (error) { setError(message(error)); } finally { pending.current = false; setBusy(false); }
  }
  async function create() { await mutate(async () => {
    const item = shareSchema.parse(await shareRequest('/api/shares', { method: 'POST', body: JSON.stringify({ projectId, artifactId: source.artifactId, versionId: source.versionId, days }) }));
    setItems(current => [item, ...current]); setNotice('分享已创建，复制链接即可发送。');
  }); }
  async function revoke(item: Share) { await mutate(async () => {
    await shareRequest(`/api/shares/${item.id}`, { method: 'DELETE' }); setItems(current => current.map(value => value.id === item.id ? { ...value, status: 'revoked', url: null } : value)); setNotice('分享已取消，此链接将不再接受新的观看请求。');
  }); }
  async function update(item: Share, days: number) { await mutate(async () => {
    const updated = shareSchema.parse(await shareRequest(`/api/shares/${item.id}`, { method: 'PATCH', body: JSON.stringify({ days }) }));
    setItems(current => current.map(value => value.id === item.id ? updated : value)); setNotice('有效期已更新。');
  }); }
  return createPortal(<ActionDialog title="分享当前视频" busy={busy} onClose={onClose} className="share-dialog"><div className="share-dialog-body">
    <div className="share-selected"><video src={api.fileUrl(projectId, source.path)} controls playsInline preload="metadata" aria-label="将要分享的视频"/><div><b>{title}</b><p>{source.label.replace(/草稿/g, '视频')}</p><small>直接分享当前视频，无需重新导出。分享保存独立副本，后续修改不会改变链接中的视频。</small></div></div>
    <p className="share-help"><LinkSimple/>持有链接的人无需登录即可观看，也可以继续转发链接。</p>
    <div className="share-create"><label>新链接有效期<select aria-label="新链接有效期" value={days} disabled={busy} onChange={event => setDays(Number(event.target.value))}><ExpiryOptions/></select></label><button className="share-primary" disabled={busy || loading} onClick={() => void create()}>{busy ? <CircleNotch className="spin"/> : <LinkSimple/>}{busy ? '正在处理…' : '创建分享链接'}</button></div>
    {notice ? <p className="share-notice" role="status"><CheckCircle/>{notice}</p> : null}
    {error ? <p className="share-error" role="alert"><Warning/>{error}<button disabled={busy} onClick={() => setRetry(value => value + 1)}>重新读取</button></p> : null}
    <div className="share-list-heading"><h3>此项目的分享</h3><span>{loading ? '正在读取…' : `${items.length} 个链接`}</span></div>
    {!loading && !items.length ? <p className="share-empty">还没有分享链接。创建后可在这里复制、调整有效期或取消。</p> : null}
    <div className="share-list">{items.map(item => <ShareRow key={item.id} item={item} busy={busy} onRevoke={() => void revoke(item)} onUpdate={days => void update(item, days)}/>)}</div>
    <p className="share-footnote">删除项目或停用账号会使分享失效。已保存或缓冲的视频无法收回。</p>
  </div></ActionDialog>, document.body);
}
function ShareRow({ item, busy, onRevoke, onUpdate }: { item: Share; busy: boolean; onRevoke: () => void; onUpdate: (days: number) => void }) {
  const [days, setDays] = useState(7), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function copy() { setCopyError(''); try { await navigator.clipboard.writeText(absoluteShareUrl(item.url!)); setCopied(true); } catch { input.current?.focus(); input.current?.select(); setCopyError('请复制已选中的链接。'); } }
  const editable = item.status === 'active' || item.status === 'expired';
  return <article className="share-row"><div className="share-row-heading"><b>{item.version}</b><span><LinkSimple/>{shareStatus(item.status)}</span></div><p>{shareSize(item.bytes)} · 创建于 {shareDate(item.createdAt)}</p><p>{item.expiresAt ? `有效至 ${shareDate(item.expiresAt)}` : '长期有效'}</p>
    {item.url ? <><div className="share-link"><input ref={input} readOnly aria-label={`${item.version}分享链接`} value={absoluteShareUrl(item.url)} onFocus={event => event.target.select()}/><button disabled={busy} onClick={() => void copy()}><Copy/>{copied ? '已复制' : '复制链接'}</button></div>{copyError ? <p role="status">{copyError}</p> : null}</> : null}
    {editable ? <div className="share-row-actions">{item.url && item.status === 'active' ? <a href={item.url} target="_blank" rel="noreferrer"><ArrowSquareOut/>打开分享</a> : null}<button disabled={busy} onClick={onRevoke}><LinkBreak/>取消分享</button><details><summary>调整有效期</summary><div><label>从现在起<select aria-label={`${item.version}新的有效期`} value={days} disabled={busy} onChange={event => setDays(Number(event.target.value))}><ExpiryOptions/></select></label><button disabled={busy} onClick={() => onUpdate(days)}>保存有效期</button></div></details></div> : null}
  </article>;
}
