import { z } from 'zod';
import { sessionFetch, sessionHeaders } from '../session';

export const shareSchema = z.object({
  id: z.string(), projectId: z.string(), ownerId: z.string(), artifactId: z.string(), title: z.string(), version: z.string(),
  createdAt: z.number(), expiresAt: z.number().nullable(), status: z.string(), bytes: z.number(), reservedBytesToday: z.number(), url: z.string().nullable(),
});
export type Share = z.infer<typeof shareSchema>;
export const publicSchema = z.object({ title: z.string(), version: z.string(), expiresAt: z.number().nullable(), duration: z.number(), width: z.number(), height: z.number(), videoUrl: z.string(), posterUrl: z.string() });
export type PublicVideo = z.infer<typeof publicSchema>;
export class ShareError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function shareRequest(path: string, init?: RequestInit) {
  const response = await sessionFetch(path, { ...init, cache: 'no-store', headers: { ...sessionHeaders(), 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new ShareError((await response.json().catch(() => ({}))).message || '分享操作失败，请重试', response.status);
  return response.status === 204 ? null : response.json();
}
export async function listShares(projectId: string, signal: AbortSignal) {
  return z.object({ shares: z.array(shareSchema) }).parse(await shareRequest(`/api/shares?projectId=${encodeURIComponent(projectId)}`, { signal })).shares;
}
export const shareStatus = (value: string) => ({ active: '分享中', expired: '已过期', revoked: '已取消', preparing: '正在准备', purged: '已取消' })[value] || '暂不可用';
export const shareDate = (value: number | null) => value ? new Date(value * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '长期有效';
export const shareSize = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
export const message = (error: unknown) => error instanceof Error ? error.message : '分享操作失败，请重试';
export function absoluteShareUrl(path: string) { return new URL(path, window.location.origin).href; }
