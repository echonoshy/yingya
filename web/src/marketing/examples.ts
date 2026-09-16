export const categories = ['全部', '产品演示', '知识动画', '数据故事', '品牌短片'] as const;
export type Category = typeof categories[number];
export type VideoExample = {
  id: string;
  title: string;
  category: Exclude<Category, '全部'>;
  description: string;
  prompt: string;
  source: '映芽原创演示' | '第三方效果参考';
};
export const featuredIntro: VideoExample = {
  id: 'yingya-intro-v4',
  title: '66 秒认识映芽',
  category: '产品演示',
  description: '从一句想法到一支作品，看看映芽如何通过对话制作视频。',
  prompt: '用我提供的产品介绍、标识和素材，制作一支约 60 秒的横屏介绍短片。用动态文字和界面演示讲清核心功能，配上有活力的中文旁白与字幕，最后呈现品牌和行动提示。先给出脚本与制作方案，确认后再制作。',
  source: '映芽原创演示',
};
export const examples: VideoExample[] = [
  { id: 'yingya-type', title: '让文字，成为主角', category: '品牌短片', description: '用动态排版，让一句话更有力量。', prompt: '把我提供的品牌文案做成 15 秒的动态文字短片。用大字、字号变化和切换节奏突出关键词，画面简洁，结尾停留品牌名称。先确认文案与节奏方案。', source: '映芽原创演示' },
  { id: 'yingya-brand', title: '给品牌，一个记忆点', category: '品牌短片', description: '用原创画面与文字，编排品牌情绪。', prompt: '用我提供的品牌图片、标识和文案，制作一支 12 秒的品牌短片。以大画面开场，用三句简短标题推进情绪，最后落到品牌名称。以素材编排和动态文字为主，先确认方案。', source: '映芽原创演示' },
  { id: 'website-story', title: '从网页，到视频', category: '产品演示', description: '用清晰的版式，呈现信息与重点。', prompt: '将我提供的网页内容或截图整理成 30 秒的介绍短片。提炼核心主张，分段呈现重点内容，保持原品牌的颜色与语气。如果网页不能读取，请告诉我需要补充哪些截图或文案。先给出制作方案。', source: '第三方效果参考' },
];
export const videoPath = (id: string) => `/marketing/video/${id}.mp4`;
export const posterPath = (id: string) => `/marketing/posters/${id}.jpg`;
