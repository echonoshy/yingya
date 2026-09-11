import { z } from 'zod';

export const quotaSchema = z.object({ tokenLimit:z.number(), usedTokens:z.number(), reservedTokens:z.number(), remainingTokens:z.number(), mediaLimit:z.number(), usedMedia:z.number(), reservedMedia:z.number(), remainingMedia:z.number(), disabled:z.boolean(), unknownCalls:z.number() });
export const memberSchema = z.object({ id:z.string(), revision:z.number(), email:z.string(), username:z.string().nullable(), name:z.string(), notes:z.string(), registered:z.boolean(), isAdmin:z.boolean(), configuredAdmin:z.boolean(), archived:z.boolean(), createdAt:z.number(), lastLogin:z.number().nullable(), quota:quotaSchema });
export const inviteSchema = z.object({ id:z.string(), revision:z.number(), label:z.string(), email:z.string().nullable(), expiresAt:z.number(), maxUses:z.number(), uses:z.number(), tokenLimit:z.number(), mediaLimit:z.number(), revoked:z.boolean(), admin:z.boolean(), users:z.array(z.object({id:z.string(),email:z.string(),createdAt:z.number()})) });
export const auditSchema = z.object({id:z.string(),actor:z.string(),action:z.string(),target:z.string(),targetName:z.string(),details:z.string(),createdAt:z.number()});
export type Member=z.infer<typeof memberSchema>;
export type Invite=z.infer<typeof inviteSchema>;
export type Audit=z.infer<typeof auditSchema>;
export type Identity={id:string;email:string;isAdmin:boolean};
export class AdminError extends Error { constructor(message:string,public status:number){super(message);} }
export async function adminCall(path:string,init?:RequestInit){
  const response=await fetch(`/api/admin${path}`,{...init,headers:{'Content-Type':'application/json',...init?.headers},cache:'no-store'});
  const body=await response.json().catch(()=>({message:'服务器响应异常，请重试'}));
  if(!response.ok)throw new AdminError(body.message||'操作失败，请重试',response.status);
  return body;
}
export { formatUsage as number } from '../usage';
export const date=(value:number|null)=>value?new Date(value*1000).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未登录';
export const memberStatus=(member:Member)=>member.archived?'archived':member.quota.disabled?'disabled':!member.registered?'pending':'active';
export const statusLabels:Record<string,string>={active:'正常',pending:'待激活',disabled:'已停用',archived:'已归档',revoked:'已撤销',expired:'已过期',spent:'已用完'};
export const inviteStatus=(invite:Invite)=>invite.revoked?'revoked':invite.expiresAt*1000<=Date.now()?'expired':invite.uses>=invite.maxUses?'spent':'active';
export const errorMessage=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试';
