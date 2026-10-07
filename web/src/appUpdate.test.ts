import { describe, expect, it } from 'vitest';
import { blockPageUpdate, pageUpdateBlockReason, parseAppVersion } from './appUpdate';
import { sessionFetch } from './session';

describe('app updates', () => {
  it('accepts immutable build identities, including same-version rebuilds and rollbacks', () => {
    for (const [buildId, version] of [['new-build', '0.5.64'], ['rebuilt', '0.5.64'], ['rollback', '0.5.63']]) {
      expect(parseAppVersion({ schemaVersion: 1, buildId, version, changes: ['更新说明'] })?.buildId).toBe(buildId);
    }
  });
  it('ignores unavailable or incompatible manifests', () => {
    for (const value of [null, '<html/>', {}, { schemaVersion: 2 }, { schemaVersion: 1, buildId: '', version: '0.5.64', changes: [] }, { schemaVersion: 1, buildId: 'x', version: 'bad', changes: [] }]) {
      expect(parseAppVersion(value)).toBeNull();
    }
  });
  it('keeps concurrent uploads blocked until all finish and tolerates repeated cleanup', () => {
    const first = blockPageUpdate('上传中'), second = blockPageUpdate('保存中');
    try {
      expect(pageUpdateBlockReason()).toBe('上传中');
      first(); first();
      expect(pageUpdateBlockReason()).toBe('保存中');
    } finally { first(); second(); }
    expect(pageUpdateBlockReason()).toBeUndefined();
  });
  it('blocks pending mutations and releases the blocker after network failure', async () => {
    const original = globalThis.fetch;
    let reject!: (error: Error) => void;
    globalThis.fetch = () => new Promise<Response>((_resolve, fail) => { reject = fail; });
    try {
      const pending = sessionFetch('/api/test', { method: 'POST' });
      expect(pageUpdateBlockReason()).toContain('提交');
      reject(new Error('offline'));
      await expect(pending).rejects.toThrow('offline');
      expect(pageUpdateBlockReason()).toBeUndefined();
      const read = sessionFetch('/api/test');
      expect(pageUpdateBlockReason()).toBeUndefined();
      reject(new Error('offline'));
      await expect(read).rejects.toThrow('offline');
    } finally { globalThis.fetch = original; }
  });
});
