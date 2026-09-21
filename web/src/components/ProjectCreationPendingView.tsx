import { StudioArtwork } from "./StudioTheme";
import { Check, CircleNotch, Paperclip } from "@phosphor-icons/react";

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
      <StudioArtwork variant="workspace"/>
      <div className="creation-pending-copy"><h1>正在创建项目</h1><p>{prompt}</p>{fileCount ? <span><Paperclip/>{fileCount} 个素材</span> : null}</div>
      <ol>{steps.map((step, index) => <li key={step.id} className={index < activeIndex ? "complete" : index === activeIndex ? "active" : ""}>{index < activeIndex ? <Check weight="bold"/> : index === activeIndex ? <CircleNotch className="spin"/> : <i/>}<span>{step.label}</span></li>)}</ol>
    </section>
  </main>;
}
