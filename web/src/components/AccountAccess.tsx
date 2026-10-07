import { UpdateBadge } from './AppUpdate';
import { BrandLogo } from "../marketing/BrandLogo";
import "./editorial-login.css";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CircleNotch, Eye, EyeSlash, Prohibit } from '@phosphor-icons/react';
import { z } from 'zod';
import { sessionFetch } from '../session';
import { formatUsage as number } from '../usage';

export async function accountCall(path: string, init?: RequestInit) {
  const response = await sessionFetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || '暂时无法连接，请重试');
  return body;
}
const quotaSchema = z.object({ tokenLimit: z.number(), usedTokens: z.number(), reservedTokens: z.number(), remainingTokens: z.number(), mediaLimit: z.number(), usedMedia: z.number(), reservedMedia: z.number(), remainingMedia: z.number(), unknownCalls: z.number(), disabled: z.boolean() });
type Quota = z.infer<typeof quotaSchema>;
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';

export function LoginScreen({ initialError, onLogin }: { initialError: string; onLogin: (user: { id: string; email: string; isAdmin: boolean }) => void }) {
  const [invitation, setInvitation] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(invitation.has('reset') ? 'reset' : invitation.has('invite') ? 'register' : 'login');
  const [email, setEmail] = useState(invitation.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [confirmationError, setConfirmationError] = useState(false);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const [inviteCode, setInviteCode] = useState(invitation.get('invite') ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(initialError);
  useEffect(() => { if (invitation.has('invite') || invitation.has('reset')) window.history.replaceState(null, '', window.location.pathname + window.location.search); }, [invitation]);
  useEffect(() => {
    const changed = () => {
      const next = new URLSearchParams(window.location.hash.slice(1));
      if (!next.has('invite') && !next.has('reset')) return;
      setInvitation(next); setMode(next.has('reset') ? 'reset' : 'register'); setEmail(next.get('email') ?? ''); setInviteCode(next.get('invite') ?? ''); setError('');
    };
    window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (mode !== 'login' && password !== confirmation) { setConfirmationError(true); confirmationInput.current?.focus(); return; }
    setBusy(true); setError(''); setConfirmationError(false);
    try {
      const body = await accountCall(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password, ...(mode === 'register' ? { invite_code: inviteCode } : mode === 'reset' ? { reset_code: invitation.get('reset') } : {}) }) });
      onLogin(z.object({ id: z.string(), email: z.string(), isAdmin: z.boolean() }).parse(body.user));
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <div className="auth-preview editorial-login">
    <header className="auth-header"><BrandLogo compact /><div className="auth-header-actions"><UpdateBadge /><a className="auth-back" href="/"><ArrowLeft aria-hidden="true" />返回首页</a></div></header>
    <main className="auth-layout">
      <section className="auth-form-area" aria-labelledby="auth-heading">
        <code className="auth-code-label" aria-hidden="true"><span>&lt;</span>YingYa<span>&gt;</span></code>
        <h1 id="auth-heading">{mode === 'reset' ? '重置密码' : mode === 'register' ? '开始创作' : '欢迎回来'}</h1>
        <p className="auth-subtitle">{mode === 'reset' ? '设置新密码，继续你的创作' : mode === 'register' ? '用邀请码，开启你的第一个故事' : '登录 YingYa，继续你的创作。'}</p>
        <form onSubmit={event => void submit(event)} aria-busy={busy}>
          <div className="auth-field"><label htmlFor="login-email">邮箱地址</label><input id="login-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} disabled={busy} /></div>
          {mode === 'register' ? <div className="auth-field"><label htmlFor="login-invite">邀请码</label><input id="login-invite" autoComplete="off" placeholder="输入你的邀请码" value={inviteCode} onChange={event => setInviteCode(event.target.value)} required maxLength={128} disabled={busy} /></div> : null}
          <div className="auth-field"><label htmlFor="login-password">{mode !== 'login' ? '设置密码' : '密码'}</label><div className="auth-password"><input id="login-password" type={passwordVisible ? 'text' : 'password'} autoComplete={mode !== 'login' ? 'new-password' : 'current-password'} minLength={mode !== 'login' ? 10 : undefined} maxLength={128} value={password} onChange={event => { setPassword(event.target.value); setConfirmationError(false); }} required disabled={busy} aria-describedby={mode === 'login' ? undefined : 'password-hint'} /><button type="button" aria-label={passwordVisible ? '隐藏密码' : '显示密码'} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)} disabled={busy}>{passwordVisible ? <EyeSlash/> : <Eye/>}</button></div>{mode !== 'login' ? <small id="password-hint">至少 10 个字符</small> : null}</div>
          {mode !== 'login' ? <div className="auth-field"><label htmlFor="login-confirmation">确认密码</label><input ref={confirmationInput} aria-invalid={confirmationError || undefined} aria-describedby={confirmationError ? "confirmation-error" : undefined} id="login-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => { setConfirmation(event.target.value); setConfirmationError(false); }} required maxLength={128} disabled={busy} />{confirmationError ? <p id="confirmation-error" className="auth-error" role="alert">两次输入的密码不一致，请重新确认</p> : null}</div> : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="auth-submit" disabled={busy}><span>{busy ? (mode === 'login' ? '正在登录…' : mode === 'register' ? '正在注册…' : '正在重置密码…') : mode === 'reset' ? '重置密码并登录' : mode === 'register' ? '注册并开始创作' : '登录并开始创作'}</span>{busy ? <CircleNotch className="spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</button>
        </form>
        <p className="auth-switch">{mode === 'login' ? '有邀请码？' : '已有账号？'}<button disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setConfirmationError(false); setPasswordVisible(false); }}>{mode === 'login' ? '注册账号' : '返回登录'}</button></p>
        <div className="auth-help"><p>{mode === 'register' ? '还没有邀请码？请联系邀请你的管理员' : '忘记密码或首次激活账号，请联系管理员'}</p><a href="mailto:echonoshy@gmail.com">联系管理员<ArrowRight aria-hidden="true" /></a></div>
        <code className="auth-code-label auth-code-label--close" aria-hidden="true"><span>&lt;/</span>YingYa<span>&gt;</span></code>
      </section>
    </main>
  </div>;
}

export function QuotaOverview({ refresh }: { refresh: number }) {
  const [quota, setQuota] = useState<Quota | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const load = () => { void accountCall('/api/quota', { signal: controller.signal }).then(value => { setQuota(quotaSchema.parse(value)); setError(''); }).catch(error => { if (!controller.signal.aborted) setError(message(error)); }); };
    load(); const timer = window.setInterval(load, 15000); return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh]);
  return <section className="account-quota" aria-label="内测额度"><h2>我的额度</h2>{error ? <p className="account-error" role="alert">{error}</p> : null}
    {quota ? <><div className="account-quota-grid"><div><span>剩余 Token</span><strong>{number(quota.remainingTokens)}</strong><progress aria-label="Token 已用额度" value={Math.min(quota.usedTokens, quota.tokenLimit)} max={quota.tokenLimit || 1} /><small>已用 {number(quota.usedTokens)} / 总额 {number(quota.tokenLimit)}</small></div><div><span>素材生成</span><strong>不限次数</strong><small>已用 {number(quota.usedMedia)} 次</small></div></div>
      {quota.remainingTokens === 0 ? <p className="account-status"><Prohibit />Token 额度已用完或正在使用；已有作品仍可查看和下载</p> : null}
      {quota.reservedTokens > 0 ? <p className="account-help">运行中预留 {number(quota.reservedTokens)} Token，调用结束后按实际用量结算</p> : null}
      {quota.reservedMedia > 0 ? <p className="account-help">运行中图片调用 {quota.reservedMedia} 次</p> : null}
      {quota.unknownCalls > 0 ? <p className="account-help">有 {quota.unknownCalls} 次模型调用尚未确认用量，暂按预留额度扣除，请联系管理员核对</p> : null}
      <p className="account-help">Token 额度不自动重置，需要追加请联系管理员；图片生成与语音操作不限次数</p></> : !error ? <p role="status">正在读取额度…</p> : null}
  </section>;
}
