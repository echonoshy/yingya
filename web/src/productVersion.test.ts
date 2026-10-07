import {describe, expect, it} from 'vitest';
import {releaseNotes} from './productVersion';

describe('public release history', () => {
  it('shows the latest five patch changes, skipping milestone introductions without deleting history', () => {
    const releases = [
      {version: '0.5.12', date: '2026-10-07', changes: ['修复上传进度']},
      {version: '0.5.11', date: '2026-10-07', changes: ['支持文档预览']},
      {version: '0.5.10', date: '2026-10-07', changes: ['优化菜单关闭']},
      {version: '0.5.9', date: '2026-10-06', changes: ['支持素材移动']},
      {version: '0.5.0', date: '2026-10-05', title: '旧版介绍', summary: '不展示', changes: ['新版']},
      {version: '0.4.2', date: '2026-10-04', changes: ['改进搜索']},
      {version: '0.4.1', date: '2026-10-03', changes: ['较早更新']},
    ];
    const original = structuredClone(releases);
    const notes = releaseNotes(releases);
    expect(notes.map(note => note.version)).toEqual(['0.5.12', '0.5.11', '0.5.10', '0.5.9', '0.4.2']);
    expect(notes[0]).toEqual({version: '0.5.12', date: '2026-10-07', summary: '修复上传进度'});
    expect(releases).toEqual(original);
  });

  it('keeps available patch notes when fewer than five have been recorded', () => {
    expect(releaseNotes([{version: '0.1.1', date: '2026-10-07', changes: ['修复上传。', '优化预览。']}]))
      .toEqual([{version: '0.1.1', date: '2026-10-07', summary: '修复上传。 优化预览。'}]);
    expect(releaseNotes([{version: '0.1.0', date: '2026-10-06', changes: ['初始版本']}])).toEqual([]);
  });
});
