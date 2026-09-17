export const creationTasks = [
  { id: "text", name: "文案转视频", input: "粘贴文案或文章", outcome: "把重点组织成镜头，制作文字与图形动画。", label: "要制作的文案", placeholder: "粘贴文章、讲稿或产品介绍，也可以补充希望强调的内容…", instruction: "把下面的文案做成动态视频，提炼重点并设计视觉主体、镜头动作与节奏。先整理制作方案，确认后再制作。", needsFiles: false },
  { id: "web", name: "网页转视频", input: "提供一个公开网页链接", outcome: "提炼网页内容，用页面画面和标注讲清重点。", label: "网页链接", placeholder: "https://example.com/product", instruction: "把这个网页做成介绍视频。先检查是否可读取，提炼重点并规划页面截图、局部聚焦和标注；无法读取时说明需要补充的截图或文案。先整理制作方案，确认后再制作。", needsFiles: false },
  { id: "edit", name: "剪辑已有素材", input: "上传视频、图片或音频", outcome: "先分析素材，再安排保留片段、顺序与补充画面。", label: "想怎样剪辑（选填）", placeholder: "例如：保留产品操作过程，压缩停顿，结尾突出三个卖点…", instruction: "先分析我添加的素材，依据真实内容安排片段取舍、顺序、衔接与需要补充的画面。按创作设置处理原声、字幕与配乐，不把文件名当成内容证据。先给出剪辑方案，确认后再制作。", needsFiles: true },
  { id: "product", name: "产品演示", input: "提供产品说明或截图", outcome: "用画面聚焦、重点标注和动态文字呈现产品价值。", label: "产品与核心卖点", placeholder: "产品是什么、面向谁、希望展示哪些功能？可以同时添加截图和品牌素材。", instruction: "制作产品演示视频，用真实产品资料讲清核心功能与价值，安排界面聚焦、重点标注和动态文字，保留品牌素材。先整理制作方案，缺少资料时指出，不捏造产品功能。", needsFiles: false },
  { id: "knowledge", name: "知识动画", input: "输入知识点或参考资料", outcome: "把原理拆成步骤，用图形、结构和流程讲解。", label: "知识点与参考内容", placeholder: "想解释什么原理？给谁看？粘贴资料或提供可信来源…", instruction: "把下面的知识点做成讲解动画，按问题、逐步讲解、总结组织内容，用图形与镜头变化解释原理，保持事实准确。先整理制作方案，确认后再制作。", needsFiles: false },
  { id: "data", name: "数据故事", input: "粘贴真实数据与来源", outcome: "用数字动画、图表和简短结论讲清变化。", label: "数据、单位与来源", placeholder: "粘贴数据，注明时间范围、单位和来源，以及希望观众看懂的变化…", instruction: "把下面的数据做成解读视频，用动态图表、数字强调和简短结论展示变化。保留数据来源、单位与统计口径，不补造数值或推断没有依据的因果关系。先整理制作方案，确认后再制作。", needsFiles: false },
] as const;
export type CreationTask = (typeof creationTasks)[number];
export function taskPrompt(task: CreationTask, content: string) {
  return `${task.instruction}${content.trim() ? `\n\n${task.label.replace("（选填）", "")}：\n${content.trim()}` : ""}`;
}
