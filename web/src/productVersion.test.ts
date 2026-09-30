import {describe, expect, it} from 'vitest';
import {releaseNotes} from './productVersion';

describe('public release history', () => {
  it('shows only milestone summaries while patch records stay in the development history', () => {
    const notes = releaseNotes([
      {version: '1.0.0', date: '2026-10-03', title: '正式版本', summary: '正式开放'},
      {version: '0.2.1', date: '2026-10-02', title: '内部修复', summary: '即使误填摘要也不展示'},
      {version: '0.2.0', date: '2026-10-01', title: '第二版', summary: '新功能'},
      {version: '0.1.1', date: '2026-09-30'},
      {version: '0.1.0', date: '2026-09-29', title: '初始版本', summary: '创作工作台'},
    ]);
    expect(notes.map(note => note.version)).toEqual(['1.0.0', '0.2.0', '0.1.0']);
  });
});
