import { z } from "zod";

export const productWorkflowSchema = z.enum(["product-intro", "feature-launch", "walkthrough"]);
export type ProductWorkflowId = z.infer<typeof productWorkflowSchema>;
export const productWorkflows = [
  { id: "product-intro", name: "产品介绍", caption: "讲清产品价值", input: "粘贴产品链接，或描述你想介绍的内容…", duration: 30, audience: "第一次了解产品的人", structure: "产品价值 → 核心功能 → 使用入口", sampleTitle: "映芽 · 从内容到视频" },
  { id: "feature-launch", name: "新功能发布", caption: "展示这次更新", input: "这次更新了什么？添加功能截图、录屏或更新说明…", duration: 25, audience: "已经了解产品的用户", structure: "更新亮点 → 实际演示 → 如何使用", sampleTitle: "映芽 · 准确修改每一镜" },
  { id: "walkthrough", name: "操作讲解", caption: "让步骤一目了然", input: "上传操作录屏，告诉我需要讲解的任务和关键步骤…", duration: 35, audience: "第一次使用这项功能的人", structure: "操作目标 → 关键步骤 → 完成结果", sampleTitle: "映芽 · 制作第一条视频" },
] as const;
export function productWorkflow(id: ProductWorkflowId | null | undefined) {
  return productWorkflows.find(item => item.id === id);
}
