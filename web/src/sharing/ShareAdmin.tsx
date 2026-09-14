import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ArrowClockwise, CaretLeft, CaretRight, LinkBreak, MagnifyingGlass } from '@phosphor-icons/react';
import { message, ShareError, shareDate, shareRequest, shareSchema, shareSize, shareStatus, type Share } from './api';
import './sharing.css';

export function ShareAdmin({ members, onAuthenticationError }: { members: { id: string; email: string }[]; onAuthenticationError: () => void }) {
  const [items, setItems] = useState<Share[]>([]), [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [search, setSearch] = useState('');
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError('');
    void shareRequest(`/api/admin/shares?offset=${offset}`, { signal: controller.signal }).then(body => { if (!controller.signal.aborted) setItems(z.object({ shares: z.array(shareSchema) }).parse(body).shares); }).catch(error => { if (!controller.signal.aborted) { setError(message(error)); if (error instanceof ShareError && [401, 403].includes(error.status)) onAuthenticationError(); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Authentication callback belongs to the mounted admin session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, refresh]);
  async function revoke(item: Share) {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await shareRequest(`/api/admin/shares/${item.id}`, { method: 'DELETE' }); setNotice('分享已下架，创建者无法恢复此链接。'); setRefresh(value => value + 1); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  const needle = search.trim().toLowerCase();
  const email = (owner: string) => members.find(value => value.id === owner)?.email || owner;
  const visible = items.filter(item => [item.title, item.id, item.projectId, email(item.ownerId)].some(value => value.toLowerCase().includes(needle)));
  return <section><header className="admin-page-heading"><div><p>映芽 / 管理后台</p><h1>视频分享</h1></div><button className="admin-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><ArrowClockwise/>刷新</button></header>
    <p className="share-help">管理公开的视频链接。下架后停止新的观看请求，操作会保留记录。</p>
    <label className="share-admin-search"><MagnifyingGlass/><input aria-label="搜索当前页分享" placeholder="搜索当前页标题、分享 ID、项目 ID 或账号" value={search} onChange={event => setSearch(event.target.value)}/></label>
    {error ? <p className="admin-error" role="alert">{error}</p> : null}{notice ? <p className="share-notice" role="status">{notice}</p> : null}
    <div className="admin-table-scroll" aria-busy={loading}><table><thead><tr><th>视频</th><th>所属账号</th><th>状态 / 有效期</th><th>文件 / 今日请求流量</th><th>操作</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><th scope="row">{item.title}<small>{item.version}</small><small>{item.id}</small></th><td>{email(item.ownerId)}</td><td>{shareStatus(item.status)}<small>{shareDate(item.expiresAt)}</small></td><td>{shareSize(item.bytes)}<small>{shareSize(item.reservedBytesToday)}</small></td><td>{['active', 'expired', 'preparing'].includes(item.status) ? <button className="admin-button" disabled={busy} onClick={() => void revoke(item)}><LinkBreak/>下架分享</button> : '已取消'}</td></tr>)}</tbody></table>{!visible.length ? <p className="share-empty">{loading ? '正在读取分享…' : '暂无匹配的分享'}</p> : null}</div>
    <footer className="admin-pagination"><span>第 {offset / 100 + 1} 页 · 每页最多 100 条</span><div><button className="admin-icon" aria-label="上一页分享" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}><CaretLeft/></button><button className="admin-icon" aria-label="下一页分享" disabled={loading || items.length < 100} onClick={() => setOffset(value => value + 100)}><CaretRight/></button></div></footer>
    <p className="share-footnote">请求流量按响应长度预留，含中断传输；用于流量保护，不代表实际观看人数或计费流量。每日按 UTC 重置。</p>
  </section>;
}
