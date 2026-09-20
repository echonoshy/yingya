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
export const videoPath = (id: string) => `/marketing/video/${id}.mp4`;
export const posterPath = (id: string) => `/marketing/posters/${id}.jpg`;
