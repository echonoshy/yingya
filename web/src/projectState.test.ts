import { describe, expect, it } from 'vitest';
import { projectDetailSchema } from './schemas';
import { workflowState, projectSummary } from './projectState';
const make = () => projectDetailSchema.parse({ id: 'p', title: '视频', status: 'waiting_input', statusLabel: '等待输入', queueDepth: 0, model: 'model', reasoningEffort: 'high', aspectRatio: '9:16', createdAt: 1, updatedAt: 2, messages: [], queue: [], eventCursor: 0, manifest: { schemaVersion: 1, phase: 'briefing', dirty: true, outputSpec: {}, artifacts: [], versions: [], studioEntry: '' } });
describe('workflow status scope', () => {
  it('does not label an unfinished brief as an edited video', () => { const p = make(); expect(workflowState(p).label).toBe('等待补充要求'); expect(workflowState(p).sourceNotice).toBe(''); expect(projectSummary(p).workflowLabel).toBe('等待补充要求'); });
  it('distinguishes draft review from updates to source files', () => {
    const p = make(); p.manifest.phase = 'draft_review'; p.manifest.versions = [{ id:'v1',label:'草稿 1',sourcePath:'index.html',videoPath:'v1.mp4',reportPath:undefined,createdAt:1 }];
    p.manifest.checkpoint = { id:'c1',kind:'draft',title:'检查草稿',summary:'',artifactIds:[] };
    expect(workflowState(p).label).toBe('草稿待确认'); expect(workflowState(p).sourceNotice).toBe('');
    p.manifest.checkpoint = undefined;
    expect(workflowState(p).label).toBe('修改待检查'); expect(workflowState(p).sourceNotice).toContain('当前草稿');
  });
  it('keeps active and failed task states above review metadata', () => {
    const p = make(); p.activeTurnId = 't'; expect(workflowState(p).label).toBe('正在制作');
    p.activeTurnId = undefined; p.status = 'failed'; expect(workflowState(p).label).toBe('制作失败');
  });
});
