import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, ChatCircleText, DownloadSimple, FileText, ListChecks } from '@phosphor-icons/react';
import './workflowShowcase.css';

const steps = [
  { Icon: FileText, label: '提供素材与要求' },
  { Icon: ListChecks, label: '确认方案' },
  { Icon: ChatCircleText, label: '用自然语言修改' },
  { Icon: DownloadSimple, label: '导出成片' },
];

export function WorkflowShowcase() {
  const ref = useRef<HTMLOListElement>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setRevealed(true); observer.disconnect(); }
    }, { threshold: .15 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <ol ref={ref} data-revealed={revealed} className="workflow-showcase" aria-label="视频制作流程">
    {steps.map(({ Icon, label }, index) => <li key={label} style={{ '--step-index': index } as CSSProperties}>
      <Icon className="workflow-icon" aria-hidden="true" /><span>{label}</span>
      {index < steps.length - 1 && <ArrowRight className="workflow-connector" aria-hidden="true" />}
    </li>)}
  </ol>;
}
