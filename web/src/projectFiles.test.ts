import { describe, expect, it } from 'vitest';
import { projectFilePath, filePreviewKind } from './projectFiles';
describe('project file links', () => {
  it('resolves historical absolute paths, encoded names and API links', () => {
    expect(projectFilePath('/home/lake/workspace/yingya/data/video-projects/p/renders/草稿 1.mp4', 'p')).toBe('renders/草稿 1.mp4');
    expect(projectFilePath('/api/agent-projects/p/files/renders/%E8%8D%89%E7%A8%BF.mp4', 'p')).toBe('renders/草稿.mp4');
    expect(projectFilePath('./plans/production.md', 'p')).toBe('plans/production.md');
  });
  it('rejects traversal, other projects, protocols and invalid encoding', () => {
    for (const href of ['/etc/passwd','/data/video-projects/other/a.mp4','../secret','a/%2e%2e/b','https://example.com/a','//example.com/a','a\\b','%zz']) expect(projectFilePath(href,'p')).toBeNull();
  });
  it('never decodes image or unknown binary files as text', () => {
    expect(filePreviewKind('snapshots/contact-sheet.JPG')).toBe('image');
    expect(filePreviewKind('audio/voice.wav')).toBe('audio');
    expect(filePreviewKind('bundle.zip')).toBe('download');
    expect(filePreviewKind('index.html')).toBe('text');
  });
});
