import type { z } from 'zod';
import { captureSession, scopedUrl, sessionHeaders } from './session';

export type UploadProgress = { loaded: number; total?: number; phase: 'uploading' | 'processing' };
export type UploadOptions = { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal };

/** Report bytes actually sent; receipt/validation by the server is a separate phase. */
export function uploadForm<T>(path: string, body: FormData, schema: z.ZodType<T>, options: UploadOptions = {}): Promise<T> {
  const checkSession = captureSession();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    const fail = (error: unknown) => { cleanup(); reject(error); };
    if (options.signal?.aborted) { reject(new DOMException('上传已取消', 'AbortError')); return; }
    xhr.open('POST', scopedUrl(path));
    for (const [key, value] of Object.entries(sessionHeaders())) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = event => options.onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : undefined, phase: 'uploading' });
    xhr.upload.onload = () => options.onProgress?.({ loaded: 1, total: 1, phase: 'processing' });
    xhr.onerror = () => fail(new Error('网络中断，上传未完成，请重试'));
    xhr.onabort = () => fail(new DOMException('上传已取消', 'AbortError'));
    xhr.onload = () => {
      cleanup();
      try {
        checkSession(xhr.status);
        let value: unknown;
        try { value = JSON.parse(xhr.responseText); } catch { throw new Error(xhr.status >= 200 && xhr.status < 300 ? '无法确认上传结果，请刷新素材列表后再试' : `上传失败（${xhr.status}），请重试`); }
        if (xhr.status < 200 || xhr.status >= 300) {
          const error = value as { message?: string; error?: string } | null;
          throw new Error(error?.message || error?.error || `上传失败（${xhr.status}），请重试`);
        }
        resolve(schema.parse(value));
      } catch (error) { reject(error); }
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}
