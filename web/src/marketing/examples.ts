export const categories = ['全部', '产品演示', '知识动画', '数据故事', '品牌短片'] as const;
export type Category = typeof categories[number];
export type VideoExample = {
  id: string;
  title: string;
  category: Exclude<Category, '全部'>;
  description: string;
  prompt: string;
  source: '映芽原创演示' | 'HyperFrames 官方示例';
};
export const featuredIntro: VideoExample = {
  id: 'yingya-intro-v2',
  title: '66 秒认识映芽',
  category: '产品演示',
  description: '从一句想法到一支作品，看看映芽如何通过对话制作视频。',
  prompt: '用我提供的产品介绍、标识和素材，制作一支约 60 秒的横屏介绍短片。用动态文字和界面演示讲清核心功能，配上有活力的中文旁白与字幕，最后呈现品牌和行动提示。先给出脚本与制作方案，确认后再制作。',
  source: '映芽原创演示',
};
export const featuredLeft: VideoExample = {
  id: 'kinetic-type-hd', title: '让讲解，多一层表达', category: '知识动画',
  description: '人物讲解与动态图文结合，让重点随讲述展开。',
  prompt: '在我提供的人物讲解视频上添加动态图文。保留原始人物画面和声音，用关键词、图形与字幕突出重点，保持内容准确。先确认需要强调的段落与视觉方案。',
  source: 'HyperFrames 官方示例',
};
export const featuredRight: VideoExample = { id: 'product-promo', title: '产品亮相，把卖点放大', category: '产品演示', description: '产品界面、重点功能与节奏转场。', prompt: '用我提供的产品截图和功能说明，制作一支 30 秒的横屏产品演示。先展示使用场景，再依次突出三个核心功能，最后展示产品名称。请先给出制作方案，确认后再开始。', source: 'HyperFrames 官方示例' };
const featuredIds = new Set([featuredLeft.id, featuredIntro.id, featuredRight.id]);
const galleryExamples: VideoExample[] = [
  { id: 'warm-grain', title: '给品牌，一点温度', category: '品牌短片', description: '柔和配色、纸张质感与简洁图形。', prompt: '用我提供的品牌文案和素材，制作一支 15 秒的品牌动效短片。采用柔和绿色与米白色、轻微纸张质感和简洁图形，突出一句核心主张，最后呈现品牌名称。先确认文案与制作方案。', source: 'HyperFrames 官方示例' },
  { id: 'yingya-type', title: '让文字，成为主角', category: '品牌短片', description: '用动态排版，让一句话更有力量。', prompt: '把我提供的品牌文案做成 15 秒的动态文字短片。用大字、字号变化和切换节奏突出关键词，画面简洁，结尾停留品牌名称。先确认文案与节奏方案。', source: '映芽原创演示' },
  { id: 'decision-tree', title: '把复杂知识，讲得简单', category: '知识动画', description: '让概念、关系与思路逐步展开。', prompt: '把我提供的知识点做成 45 秒的讲解动画。用一个具体问题开场，逐步展开概念与关系，配上清晰的图形标注和字幕，最后回顾核心结论。先帮我梳理内容，不添加未经确认的事实。', source: 'HyperFrames 官方示例' },
  { id: 'nyt-graph', title: '让数据，自己讲故事', category: '数据故事', description: '从数字到趋势，把结论讲清楚。', prompt: '根据我上传的数据表和来源，制作 30 秒的数据故事。逐步呈现关键趋势，突出最值得关注的变化，标明单位和数据来源。图表结论停留足够时间，不编造数字。先给出方案供我确认。', source: 'HyperFrames 官方示例' },
  { id: 'yingya-brand', title: '给品牌，一个记忆点', category: '品牌短片', description: '用原创画面与文字，编排品牌情绪。', prompt: '用我提供的品牌图片、标识和文案，制作一支 12 秒的品牌短片。以大画面开场，用三句简短标题推进情绪，最后落到品牌名称。以素材编排和动态文字为主，先确认方案。', source: '映芽原创演示' },
  { id: 'website-story', title: '从网页，到视频', category: '产品演示', description: '用清晰的版式，呈现信息与重点。', prompt: '将我提供的网页内容或截图整理成 30 秒的介绍短片。提炼核心主张，分段呈现重点内容，保持原品牌的颜色与语气。如果网页不能读取，请告诉我需要补充哪些截图或文案。先给出制作方案。', source: 'HyperFrames 官方示例' },
];
export const examples = galleryExamples.filter(example => !featuredIds.has(example.id));
export const videoPath = (id: string) => `/marketing/video/${id === 'decision-tree' ? 'decision-tree-hd' : id}.mp4`;
export const posterPath = (id: string) => id === 'decision-tree'
  ? '/marketing/posters/decision-tree-hd.png'
  : id === 'kinetic-type-hd' || id === 'warm-grain'
  ? `/marketing/posters/${id}.png`
  : `/marketing/posters/${id}.jpg`;
