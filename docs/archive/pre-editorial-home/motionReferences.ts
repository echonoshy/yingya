import type { VideoExample } from './examples';
export const motionGroups = ['全部', '角色故事', '品牌展示', '空间动效'] as const;
export type MotionReference = VideoExample & {
  label: string;
  webp: string;
  summary: string;
  group: Exclude<typeof motionGroups[number], '全部'>;
  width: number;
  height: number;
};
function reference(name: string, label: string, original: string, group: MotionReference['group'], summary: string, width = 640, height = 474): MotionReference {
  return {
    id: `motion-${name}`, label, title: `${label} · ${original}`, group, summary, width, height,
    webp: `/marketing/motion/${name}.webp`, category: group === '品牌展示' ? '产品演示' : '品牌短片',
    description: `MotionSites 动效参考：${summary}`, source: '第三方效果参考',
    prompt: `用我提供的文案和素材制作一支 15 秒短片，参考「${label}」的视觉节奏：${summary}。保持主体清晰，加入简短中文标题，先确认脚本和制作方案。`,
  };
}
export const motionReferences: MotionReference[] = [
  reference('rabbit', '卡通兔子', 'Pulse 3D', '角色故事', '鲜明配色，让角色成为画面的主角。'),
  reference('flower', '悬浮花朵', '3D Story', '空间动效', '通透的花瓣缓缓舒展，营造轻盈的空间感。'),
  reference('books', '立体书架', 'Book Hero', '品牌展示', '一本本展开，把内容变成可浏览的展览。', 640, 472),
  reference('toy', '口袋里的童话', '3D Collectible Hero', '角色故事', '柔软的玩具质感，配上俏皮的人物动作。', 640, 470),
  reference('ocean', '一方海洋', 'Immersive Ocean', '空间动效', '把海底装进小小空间，光线与鱼群一起游动。', 640, 478),
  reference('bloom', '花间来信', 'Bloom', '品牌展示', '花朵、玻璃与柔和光线，衬托精致的产品。', 640, 478),
  reference('clouds', '云上画廊', 'Golden Portal', '角色故事', '云层与飞鸟穿过画面，让故事有了纵深。', 640, 470),
  reference('portal', '梦境入口', 'Dreamcore Landing', '空间动效', '从洞口望向另一个世界，层次逐步展开。', 640, 468),
  reference('flow', '流动的线条', 'Future-State', '空间动效', '细长光线聚合、散开，形成连续的节奏。', 640, 470),
  reference('terrain', '山脉的纹理', 'Interactive Discovery', '空间动效', '起伏地形与细节纹理，呈现有机的变化。'),
  reference('air', '轻盈呼吸', 'Pureflow', '品牌展示', '人物近景与产品信息相接，表达简洁直接。', 640, 468),
  reference('beauty', '日常之美', 'Beauty Store', '品牌展示', '低饱和画面和留白，把目光留给产品。', 366, 640),
];
