import { describe, expect, it } from 'vitest';
import { projectDetailSchema } from './schemas';
import { workflowState, projectSummary } from './projectState';
const make = () => projectDetailSchema.parse({ id: 'p', title: '视频', status: 'waiting_input', statusLabel: '等待输入', queueDepth: 0, model: 'model', reasoningEffort: 'high', aspectRatio: '9:16', createdAt: 1, updatedAt: 2, messages: [], queue: [], eventCursor: 0, manifest: { schemaVersion: 1, phase: 'briefing', dirty: true, outputSpec: {}, artifacts: [], versions: [], studioEntry: '' } });
describe('workflow status scope', () => {
  it('does not label an unfinished brief as an edited video', () => { const p = make(); expect(workflowState(p).label).toBe('等待补充要求'); expect(workflowState(p).sourceNotice).toBe(''); expect(projectSummary(p).workflowLabel).toBe('等待补充要求'); });
  it('distinguishes draft review from updates to source files', () => {
    const p = make(); p.manifest.phase = 'draft_review'; p.manifest.versions = [{ id:'v1',label:'草稿 1',sourcePath:'index.html',videoPath:'v1.mp4',reportPath:undefined,createdAt:1 }];
    p.manifest.checkpoint = { id:'c1',kind:'draft',title:'检查草稿',summary:'',artifactIds:[] };
    expect(workflowState(p).label).toBe('视频可导出'); expect(workflowState(p).sourceNotice).toBe('');
    p.manifest.checkpoint = undefined;
    expect(workflowState(p).label).toBe('已有视频 · 源文件有更新'); expect(workflowState(p).sourceNotice).toContain('当前视频');
  });
  it('only treats an export of the current version as exported', () => {
    const p = make(); p.manifest.phase = 'draft_review'; p.manifest.dirty = false;
    p.manifest.versions = [{ id:'v2',label:'视频 2',sourcePath:'index.html',videoPath:'v2.mp4',reportPath:undefined,createdAt:2 }];
    p.manifest.artifacts = [{id:'export',kind:'final-video',label:'已导出',path:'final.mp4',version:'v1',metadata:{}}];
    expect(projectSummary(p).workflowStatus).toBe('ready');
    p.manifest.artifacts[0].version = 'v2';
    expect(projectSummary(p).workflowStatus).toBe('completed');
    p.manifest.dirty = true;
    expect(projectSummary(p).workflowStatus).toBe('completed');
    expect(workflowState(p).label).toBe('已导出 · 源文件有更新');
  });
  it('keeps requirements and plan confirmation pending, even with an older video', () => {
    const p = make(); expect(projectSummary(p).workflowStatus).toBe('review');
    p.manifest.phase = 'plan_review'; p.manifest.checkpoint = {id:'plan',kind:'plan',title:'方案',summary:'',artifactIds:[]};
    p.manifest.versions = [{id:'v1',label:'视频',sourcePath:'index.html',videoPath:'v1.mp4',reportPath:undefined,createdAt:1}];
    expect(projectSummary(p).workflowStatus).toBe('review'); expect(workflowState(p).label).toBe('制作方案待确认');
  });
  it('reports UI export as active without an agent turn', () => {
    const p = make(); p.renderJobs = [{id:'render',versionId:'v1',status:'running',quality:'high',resolution:'1080p',fps:30,progress:50,message:'',outputPath:undefined,error:undefined,startedAt:1,updatedAt:2}];
    expect(projectSummary(p).workflowStatus).toBe('active'); expect(workflowState(p).label).toBe('正在导出');
  });
  it('keeps active and failed task states above review metadata', () => {
    const p = make(); p.activeTurnId = 't'; expect(workflowState(p).label).toBe('正在制作');
    p.activeTurnId = undefined; p.status = 'failed'; expect(workflowState(p).label).toBe('制作失败');
  });
});
