import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { uploadForm } from './upload';
import { setCurrentUser } from './session';
class FakeXHR {
  static last: FakeXHR;
  upload: { onprogress?: (event: {loaded: number; total: number; lengthComputable: boolean}) => void; onload?: () => void } = {};
  status = 200; responseText = '{"path":"assets/a.png"}';
  onload?: () => void; onerror?: () => void; onabort?: () => void;
  url = ''; headers: Record<string,string> = {};
  constructor() { FakeXHR.last = this; }
  open(_method: string, url: string) { this.url = url; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  send() {}
  abort() { this.onabort?.(); }
}
const schema = z.object({path:z.string()});
afterEach(() => { vi.unstubAllGlobals(); setCurrentUser(''); });
describe('upload transport', () => {
  it('reports transmitted bytes and awaits a validated server receipt', async () => {
    vi.stubGlobal('XMLHttpRequest',FakeXHR); setCurrentUser('upload-owner'); const progress=vi.fn();
    const result=uploadForm('/api/assets/library',new FormData(),schema,{onProgress:progress});
    const xhr=FakeXHR.last;
    expect(xhr.url).toBe('/api/u/upload-owner/assets/library');expect(xhr.headers).toEqual({'X-Yingya-User':'upload-owner'});
    xhr.upload.onprogress?.({loaded:25,total:100,lengthComputable:true});
    expect(progress).toHaveBeenLastCalledWith({loaded:25,total:100,phase:'uploading'});
    xhr.upload.onload?.();expect(progress).toHaveBeenLastCalledWith({loaded:1,total:1,phase:'processing'});
    xhr.onload?.();await expect(result).resolves.toEqual({path:'assets/a.png'});
  });
  it('does not invent a percentage when a transfer has no length', async () => {
    vi.stubGlobal('XMLHttpRequest',FakeXHR);const progress=vi.fn();const result=uploadForm('/api/assets/library',new FormData(),schema,{onProgress:progress});
    FakeXHR.last.upload.onprogress?.({loaded:25,total:0,lengthComputable:false});expect(progress).toHaveBeenLastCalledWith({loaded:25,total:undefined,phase:'uploading'});
    FakeXHR.last.onerror?.();await expect(result).rejects.toThrow('网络中断');
  });
  it('rejects server failures, invalid receipts and stale account responses', async () => {
    vi.stubGlobal('XMLHttpRequest',FakeXHR);
    const failed=uploadForm('/api/assets/library',new FormData(),schema);FakeXHR.last.status=413;FakeXHR.last.responseText='{"message":"文件过大"}';FakeXHR.last.onload?.();await expect(failed).rejects.toThrow('文件过大');
    const invalid=uploadForm('/api/assets/library',new FormData(),schema);FakeXHR.last.responseText='{}';FakeXHR.last.onload?.();await expect(invalid).rejects.toThrow();
    setCurrentUser('first');const stale=uploadForm('/api/assets/library',new FormData(),schema);setCurrentUser('second');FakeXHR.last.onload?.();await expect(stale).rejects.toThrow('登录状态已改变');
  });
  it('aborts the request when its owner unmounts', async () => {
    vi.stubGlobal('XMLHttpRequest',FakeXHR);const controller=new AbortController();const result=uploadForm('/api/assets/library',new FormData(),schema,{signal:controller.signal});controller.abort();await expect(result).rejects.toMatchObject({name:'AbortError'});
  });
});
