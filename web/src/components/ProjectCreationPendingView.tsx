import { Check, CircleNotch, FilmSlate, Paperclip, Sparkle } from "@phosphor-icons/react";

export type ProjectCreationStage = "creating" | "uploading" | "starting" | "opening";

const steps: Array<{ id: ProjectCreationStage; label: string }> = [
  { id: "creating", label: "建立项目空间" },
  { id: "uploading", label: "整理创作素材" },
  { id: "starting", label: "启动创作助手" },
  { id: "opening", label: "打开工作区" },
];

export function ProjectCreationPendingView({ prompt, fileCount, stage }: { prompt: string; fileCount: number; stage: ProjectCreationStage }) {
  const activeIndex = steps.findIndex(step => step.id === stage);
  return <main className="creation-pending" aria-busy="true" aria-live="polite">
    <section className="creation-pending-card">
      <div className="creation-pending-mark"><FilmSlate weight="duotone"/><span><Sparkle weight="fill"/></span></div>
      <div className="creation-pending-copy"><small>新视频项目</small><h1>正在准备你的创作空间</h1><p>{prompt}</p>{fileCount ? <span><Paperclip/>{fileCount} 个素材正在安全加入项目</span> : null}</div>
      <ol>{steps.map((step, index) => <li key={step.id} className={index < activeIndex ? "complete" : index === activeIndex ? "active" : ""}>{index < activeIndex ? <Check weight="bold"/> : index === activeIndex ? <CircleNotch className="spin"/> : <i/>}<span>{step.label}</span></li>)}</ol>
      <p className="creation-pending-hint">项目已在本地持久保存。即使连接短暂波动，也不会重复创建任务。</p>
    </section>
  </main>;
}
