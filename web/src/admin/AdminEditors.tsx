import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, Eye, EyeSlash, Key, Plus, SignOut, X } from '@phosphor-icons/react';
import { date, number, type Invite, type Member } from './api';
import { DEFAULT_ACCOUNT_QUOTA } from '../usage';

export function EditorDialog({title,busy,onClose,children}:{title:string;busy:boolean;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog className="admin-dialog" ref={ref} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><header><h2>{title}</h2><button type="button" className="admin-icon" title="关闭" aria-label="关闭" disabled={busy} onClick={onClose}><X/></button></header>{children}</dialog>;
}
export function Credential({label,url}:{label:string;url:string}){
  const input=useRef<HTMLInputElement>(null),[copied,setCopied]=useState(false),[error,setError]=useState('');
  async function copy(){try{await navigator.clipboard.writeText(url);setCopied(true);setError('');}catch{input.current?.select();setError('链接已选中，请手动复制');}}
  return <section className="admin-credential"><label>{label}<div><input ref={input} value={url} readOnly/><button type="button" className="admin-icon" title="复制链接" aria-label="复制链接" onClick={()=>void copy()}>{copied?<Check/>:<Copy/>}</button></div></label>{copied?<p role="status">已复制</p>:null}{error?<p role="status">{error}</p>:null}</section>;
}
export function UserEditor({member,currentId,busy,onSave,onAction,onClose,error}:{member:Member|null;currentId:string;busy:boolean;onSave:(input:Record<string,unknown>)=>Promise<void>;onAction:(action:'reset'|'sessions',member:Member)=>Promise<string|void>;onClose:()=>void;error:string}){
  const [showPassword,setShowPassword]=useState(false),[link,setLink]=useState('');
  const [role,setRole]=useState(member?.isAdmin?'admin':'user');
  const own=member?.id===currentId;
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);
    await onSave({email:String(data.get('email')||member?.email||''),username:String(data.get('username')||''),name:String(data.get('name')||''),isAdmin:role==='admin',tokenLimit:Number(data.get('tokens')),mediaLimit:Number(data.get('media')),...(member?{revision:member.revision,notes:String(data.get('notes')||''),status:String(data.get('status')||'active')}:{password:String(data.get('password')||'')})});
  }
  return <EditorDialog title={member?'用户详情':'创建用户'} busy={busy} onClose={onClose}><form onSubmit={event=>void submit(event)}>
    {member?<div className="admin-detail-meta"><span>注册于 {date(member.createdAt)}</span><span>最近登录 {date(member.lastLogin)}</span><span>用户 ID：{member.id}</span></div>:null}
    <fieldset disabled={busy}><div className="admin-fields">
      <label>姓名<input name="name" defaultValue={member?.name??''} maxLength={100}/></label>
      <label>用户名<input name="username" defaultValue={member?.username??''} minLength={3} maxLength={32} pattern="[A-Za-z0-9_.\-]+" autoComplete="off"/></label>
      <label className="admin-wide">邮箱<input name="email" type="email" defaultValue={member?.email??''} maxLength={254} required disabled={member?.configuredAdmin}/></label>
      <label>角色<select aria-label="角色" value={role} onChange={event=>setRole(event.target.value)} disabled={own||member?.configuredAdmin}><option value="user">普通用户</option><option value="admin">管理员</option></select></label>
      {member?<label>账号状态<select aria-label="账号状态" name="status" defaultValue={member.archived?'archived':member.quota.disabled?'disabled':'active'} disabled={own}><option value="active">启用</option><option value="disabled">停用</option><option value="archived">归档</option></select></label>:null}
      {!member?<label className="admin-wide">初始密码<div className="admin-password"><input name="password" type={showPassword?'text':'password'} minLength={10} maxLength={128} autoComplete="new-password" required/><button type="button" className="admin-icon" title={showPassword?'隐藏密码':'显示密码'} aria-label={showPassword?'隐藏密码':'显示密码'} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeSlash/>:<Eye/>}</button></div></label>:null}
    </div>
    <section className="admin-form-section"><h3>使用额度</h3>{member?<div className="admin-balance"><span>已用 Token <b>{number(member.quota.usedTokens)}</b></span><span>剩余 Token <b>{number(member.quota.remainingTokens)}</b></span><span>运行中预留 <b>{number(member.quota.reservedTokens)}</b></span><span>已用素材次数 <b>{number(member.quota.usedMedia)}</b></span></div>:null}<div className="admin-fields"><label>Token 总额度<input type="number" name="tokens" min={member?member.quota.usedTokens+member.quota.reservedTokens:0} max={1000000000000} step={1} defaultValue={member?.quota.tokenLimit??DEFAULT_ACCOUNT_QUOTA.tokenLimit} required/></label><label>素材生成总次数<input type="number" name="media" min={member?member.quota.usedMedia+member.quota.reservedMedia:0} max={1000000} step={1} defaultValue={member?.quota.mediaLimit??DEFAULT_ACCOUNT_QUOTA.mediaLimit} required/></label></div></section>
    {member?<label className="admin-notes">管理员备注<textarea name="notes" defaultValue={member.notes} rows={3} maxLength={2000}/></label>:null}
    </fieldset>
    {member?.registered?<div className="admin-secondary-actions"><button type="button" className="admin-button" disabled={busy||member.quota.disabled} onClick={()=>void onAction('reset',member).then(result=>{if(result)setLink(result);})}><Key/>生成密码重置链接</button><button type="button" className="admin-button" disabled={busy} onClick={()=>void onAction('sessions',member)}><SignOut/>撤销登录会话</button></div>:null}
    {link?<Credential label="密码重置链接（1 小时有效）" url={link}/>:null}
    {member?.archived?<p className="admin-help">归档账号的作品和记录仍保留，可切换为启用恢复访问。</p>:null}
    {error?<p className="admin-error" role="alert">{error}</p>:null}
    <footer><button type="button" className="admin-button" disabled={busy} onClick={onClose}>取消</button><button className="admin-button primary" disabled={busy}>{member?<Check/>:<Plus/>}{busy?'正在保存…':member?'保存更改':'创建用户'}</button></footer>
  </form></EditorDialog>;
}

function localDate(seconds:number){const date=new Date(seconds*1000);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;}
export function InviteEditor({invite,busy,onClose,onSave,error}:{invite:Invite|null;busy:boolean;onClose:()=>void;onSave:(input:Record<string,unknown>)=>Promise<void>;error:string}){
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);const email=String(data.get('email')||'').trim();
    await onSave({email:email||null,maxUses:Number(data.get('uses')),tokenLimit:Number(data.get('tokens')),mediaLimit:Number(data.get('media')),...(invite?{revision:invite.revision,label:String(data.get('label')||''),expiresAt:Math.floor(new Date(String(data.get('expires'))).getTime()/1000),revoked:data.get('revoked')==='on'}:{expiresInDays:Number(data.get('days'))})});
  }
  return <EditorDialog title={invite?'编辑邀请码':'创建邀请码'} busy={busy} onClose={onClose}><form onSubmit={event=>void submit(event)}><fieldset disabled={busy}><div className="admin-fields">
    {invite?<label className="admin-wide">邀请名称<input name="label" defaultValue={invite.label} maxLength={100}/></label>:null}
    <label className="admin-wide">绑定邮箱（可选）<input name="email" type="email" defaultValue={invite?.email??''} maxLength={254} required={invite?.admin}/></label>
    <label>可使用次数<input name="uses" type="number" min={Math.max(1,invite?.uses??0)} max={invite?.admin?1:1000} defaultValue={invite?.maxUses??1} required/></label>
    {invite?<label>到期时间<input name="expires" type="datetime-local" defaultValue={localDate(invite.expiresAt)} required/></label>:<label>有效天数<input name="days" type="number" min={1} max={365} defaultValue={7} required/></label>}
    <label>每人 Token 额度<input name="tokens" type="number" min={0} max={1000000000000} defaultValue={invite?.tokenLimit??DEFAULT_ACCOUNT_QUOTA.tokenLimit} required/></label>
    <label>每人素材生成次数<input name="media" type="number" min={0} max={1000000} defaultValue={invite?.mediaLimit??DEFAULT_ACCOUNT_QUOTA.mediaLimit} required/></label>
    </div>{invite?<label className="admin-check"><input name="revoked" type="checkbox" defaultChecked={invite.revoked}/>停用此邀请</label>:null}</fieldset>
    {invite?<p className="admin-help">新的额度用于之后的兑换，已注册用户的额度保持原值。</p>:null}
    {invite&&invite.uses>0?<section className="admin-form-section"><h3>兑换用户（{invite.uses}）</h3>{invite.users.map(user=><div className="admin-redemption" key={user.id}><span>{user.email}</span><small>{date(user.createdAt)}</small></div>)}{invite.users.length<invite.uses?<p className="admin-help">部分早期兑换仅保留次数记录。</p>:null}</section>:null}
    {error?<p className="admin-error" role="alert">{error}</p>:null}<footer><button type="button" className="admin-button" disabled={busy} onClick={onClose}>取消</button><button className="admin-button primary" disabled={busy}>{invite?<Check/>:<Plus/>}{busy?'正在保存…':invite?'保存邀请':'生成邀请码'}</button></footer>
    </form></EditorDialog>;
}
