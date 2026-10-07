import { Check, CircleNotch } from '@phosphor-icons/react';
import type { ProjectDetail } from '../types';

const stages = ['准备内容', '审阅方案', '制作视频', '观看与修改'];

export function ProjectJourney({ project, onSelect }: { project: ProjectDetail; onSelect: (stage: number) => void }) {
  const working = Boolean(project.activeTurnId || project.queueDepth || project.renderJobs.some(job => job.status === 'running' || job.status === 'queued'));
  const video = project.manifest.versions.some(version => Boolean(version.videoPath));
  const phase = project.manifest.phase;
  const current = phase === 'plan_review' ? 1 : phase === 'briefing' ? 0 : video ? working ? 2 : 3 : working ? 2 : project.manifest.checkpoint?.kind === 'plan' ? 1 : 0;
  return <nav className="project-journey" aria-label="创作阶段"><ol>{stages.map((label, index) => <li key={label} data-complete={index < current || undefined} data-current={index === current || undefined}><button type="button" aria-current={index === current ? 'step' : undefined} onClick={() => onSelect(index)}><span className="journey-number">{index < current ? <Check/> : index === current && working ? <CircleNotch className="spin"/> : String(index + 1).padStart(2, '0')}</span><span>{label}</span></button></li>)}</ol></nav>;
}
