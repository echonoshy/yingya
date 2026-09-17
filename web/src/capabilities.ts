import type { PresentationChoice } from "./presentation";
export const categories = ['全部', '产品展示', '知识讲解', '数据故事'];
export const capabilities = [
  { id: 'model-stage', name: '3D 产品展示', description: '围绕你的模型，展示外观与细节。', image: '/capabilities/v1/assets/headphones.png', alt: '暖灰背景中的石墨色耳机概念效果图', provider: 'Three.js', meta: '需要模型', categories: ['产品展示'], summary: '用灯光与镜头运动，呈现产品的外观和细节。', variants: ['缓慢旋转', '镜头环绕', '静态展示'], requirement: '已有 3D 模型', requirementHint: '推荐上传 GLB 文件', boundary: '展示你提供的模型，不会自动生成模型。', uses: '产品介绍、外观展示、品牌短片。', provenance: '使用已接入的 model-stage 组件。播放示例使用仓库自带的几何模型，可切换旋转、环绕和静态展示。耳机图片仅示意视觉方向，不对应已提供的模型。' },
  { id: 'flow-path', name: '流程演示', description: '让步骤依次展开，讲清先后关系。', image: '/capabilities/v1/assets/flow-path.png', alt: '内容、分析、成片三个依次连接的流程节点', provider: 'Anime.js', meta: '动态组件', categories: ['知识讲解', '产品展示'], summary: '沿着清晰的路径，逐步展开你的讲解。', variants: ['三步流程', '四步讲解', '五步展开'], requirement: '有顺序的步骤与说明', requirementHint: '准备 2–5 个阶段及简短文字', boundary: '适合线性流程；复杂分支可使用关系连线。', uses: '操作指引、工作流程、知识讲解。', provenance: '调用现有 flow-path 组件，真实播放路径绘制和节点出现；正式创作时根据你的文案替换内容。' },
  { id: 'infographic', name: '信息图解', description: '把复杂内容整理成结构与层次。', image: '/capabilities/v1/assets/infographic.png', alt: '文案、素材与要求经过映芽组织为方案、预览和成片的结构图', provider: 'Baoyu', meta: '布局参考', categories: ['知识讲解', '数据故事'], summary: '先组织内容关系，再安排每一层信息如何出现。', variants: ['结构拆解', '层级讲解', '前后对比'], requirement: '要解释的内容与关系', requirementHint: '提供文案、资料或参考图', boundary: '当前接入布局与图解参考，完整 Baoyu 工作流未接入。', uses: '系统介绍、概念解释、知识动画。', provenance: '参考已收录的 Baoyu 信息布局、结构拆解和图解方法。此图片是布局示意，不是 Baoyu 自动生成或运行的成片。选择会保存为制作要求。' },
  { id: 'title-reveal', name: '动态标题', description: '用文字节奏，突出开场与重点。', image: '/capabilities/v1/assets/title-reveal.png', alt: '让想法，流动起来的动态标题与蓝色强调线', provider: 'Anime.js', meta: '动态组件', categories: ['产品展示', '知识讲解'], summary: '让一句重要的话，按照恰当的节奏进入画面。', variants: ['开场标题', '章节提示', '结尾主张'], requirement: '一句简洁的标题', requirementHint: '可以同时提供副标题与品牌用色', boundary: '保持文字可编辑；短句更适合逐字揭示。', uses: '视频开场、章节过渡、品牌主张。', provenance: '使用现有 title-reveal 组件。示例播放真实逐字揭示和强调线动画，可切换不同文案场景。' },
  { id: 'number-compare', name: '数据对比', description: '让真实数据的变化更容易看懂。', image: '/capabilities/v1/assets/number-compare.png', alt: '示例数据 12 份与 48 份的双指标对比', provider: 'Anime.js', meta: '需要数据', categories: ['数据故事'], summary: '让数字变化与对比关系，成为叙事的重点。', variants: ['前后对比', '两项指标', '变化结果'], requirement: '两组数值、单位与来源', requirementHint: '粘贴数据，或添加有来源的资料', boundary: '示例数字仅演示效果，正式视频使用真实数据。', uses: '成果汇报、数据故事、变化说明。', provenance: '使用现有 number-compare 组件。动态数字来自演示配置，底线为装饰，不表示比例。' },
  { id: 'beam-network', name: '关系连线', description: '展示分支、汇聚与信息流向。', image: '/capabilities/v1/assets/beam-network.png', alt: '文案、图片、声音汇聚成故事，再形成视频的连线示例', provider: 'Magic UI', meta: '动态组件', categories: ['知识讲解', '数据故事'], summary: '让看不见的关系，通过连接与流动清晰呈现。', variants: ['多路汇聚', '分支展开', '系统连接'], requirement: '节点名称与连接关系', requirementHint: '说明谁连接谁，以及信息流向', boundary: '按真实关系编排，连接动画不替代事实依据。', uses: '系统介绍、协作流程、产品原理。', provenance: '使用已适配的 beam-network 组件，源自 Magic UI 的公开连线实现。这里播放真实组件，不代表整个上游组件库均已适配视频。' },
] as const;

export type Capability = (typeof capabilities)[number];
export const variantKeys = {
  "model-stage": ["turntable", "orbit", "still"],
  "flow-path": ["three-steps", "four-steps", "five-steps"],
  "infographic": ["structure", "hierarchy", "comparison"],
  "title-reveal": ["opening", "chapter", "closing"],
  "number-compare": ["before-after", "metrics", "change"],
  "beam-network": ["converge", "branch", "system"],
} as const;
export function presentationLabel(choice: PresentationChoice) {
  const item = capabilities.find(item => item.id === choice.capabilityId)!;
  const index = (variantKeys[item.id] as readonly string[]).indexOf(choice.variant);
  return `${item.name} · ${item.variants[index]}`;
}

export const capabilityInputHints: Record<Capability["id"], string> = {
  "model-stage": "上传模型后，描述产品、要展示的细节和镜头节奏。",
  "flow-path": "按顺序列出步骤，每步补充一句说明。",
  "infographic": "提供要解释的内容，说明层级、组成或对比关系。",
  "title-reveal": "写下标题和副标题，说明它用于开场、章节还是结尾。",
  "number-compare": "提供两组数值、单位、时间范围及来源。",
  "beam-network": "列出节点名称，以及谁连接谁、信息流向哪里。",
};
export const capabilityExamples: Record<Capability["id"], string> = {
  "model-stage": "用我上传的模型展示产品外观，镜头缓慢环绕，再突出我指定的细节。",
  "flow-path": "把下面的流程做成逐步展开的动画，每一步出现时突出对应说明。",
  "infographic": "把下面的知识点整理成有层次的图解，先展示整体，再逐层解释。",
  "title-reveal": "把我提供的标题做成视频开场，文字分段出现，最后强调关键词。",
  "number-compare": "用我提供的数据展示前后变化，保留单位、时间范围和数据来源。",
  "beam-network": "把下面的节点和连接关系做成动画，让观众看清信息如何流动。",
};
