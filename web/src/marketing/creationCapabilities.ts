import effectsVideo from '../assets/capability-reels/effects.mp4';
import effectsPoster from '../assets/capability-reels/effects.jpg';
import voiceVideo from '../assets/capability-reels/voice.mp4';
import voicePoster from '../assets/capability-reels/voice.jpg';
import chartsVideo from '../assets/capability-reels/charts.mp4';
import chartsPoster from '../assets/capability-reels/charts.jpg';
import editVideo from '../assets/capability-reels/edit.mp4';
import editPoster from '../assets/capability-reels/edit.jpg';
import type { ShowcaseClip } from './showcaseMedia';

export type CreationDirection = 'effects' | 'voice' | 'charts' | 'edit';
type Capability = {
  id: CreationDirection; title: string; shortTitle: string; description: string; headline: string;
  detail: string; uses: string; sample: string; prompt: string; clip: ShowcaseClip;
};
export const creationCapabilities: Capability[] = [
  {
    id: 'effects', title: '文字动画与视觉特效', shortTitle: '文字动画与特效',
    description: '字形动画、粒子聚散、几何变化与立体效果',
    headline: '让文字与图形，成为画面的主角。',
    detail: '为标题、标语和产品卖点设计字形动画，用粒子聚散、几何变化、遮罩转场与立体效果连接画面。把一句文案，做成有节奏、有层次的视觉表达。',
    uses: '动态海报、品牌短片、片头片尾、产品宣传',
    sample: '粒子字形 · 从球体到文字，再散开重组',
    prompt: '请为我的内容制作文字动画与视觉特效，结合字形变化、粒子聚散、几何图形、遮罩转场或立体效果，突出标题与重点信息。先给出视觉方案，确认后再制作。',
    clip: { id: 'capability-effects', title: '粒子字形与视觉特效示例', english: 'From dots to ideas.', duration: 5, src: effectsVideo, poster: effectsPoster, hasAudio: false },
  },
  {
    id: 'voice', title: '自动配音和字幕', shortTitle: '自动配音和字幕',
    description: '文稿变旁白，字幕跟随语音，重点逐字呈现',
    headline: '文稿变旁白，录音变字幕。',
    detail: '将文稿生成旁白，也能为已有口播识别并对齐字幕。搭配逐字高亮与关键词强调，让教程、知识和故事既能听懂，静音时也能看懂。',
    uses: '知识讲解、操作教程、有声故事、口播字幕',
    sample: '中文旁白 · 开启声音，观看逐字跟读',
    prompt: '请根据我的文稿生成中文旁白，或为我提供的口播识别字幕，按实际语音时间对齐并突出关键词。先确认内容、音色与字幕样式，给出方案后再制作。',
    clip: { id: 'capability-voice', title: '自动配音和字幕示例', english: 'A voice. A story.', duration: 6, src: voiceVideo, poster: voicePoster, hasAudio: true },
  },
  {
    id: 'charts', title: '动态图表', shortTitle: '动态图表',
    description: '把数字、趋势和对比，做成看得懂的动画',
    headline: '让数据的变化，直接被看见。',
    detail: '将表格中的数字做成动态柱状图、趋势曲线、占比或排名变化，按讲解节奏突出增长、差异与拐点。标清数据来源和统计口径，把一页报告讲得更明白。',
    uses: '业务复盘、调研报告、年度总结、科普对比',
    sample: '立体柱图 · 画面数值仅为示例',
    prompt: '请将我提供的数据制作成动态图表，根据内容选择柱状图、趋势曲线、占比或排名动画，突出关键变化，标明来源与统计口径，不编造数据。先给出讲解方案，确认后再制作。',
    clip: { id: 'capability-charts', title: '立体动态图表示例', english: 'Growth, in motion.', duration: 5, src: chartsVideo, poster: chartsPoster, hasAudio: false },
  },
  {
    id: 'edit', title: '自动剪辑', shortTitle: '自动剪辑',
    description: '挑选精彩片段、收紧停顿，整理叙述节奏',
    headline: '从长素材里，剪出值得看的重点。',
    detail: '从口播、访谈或课程中挑选重点，收紧多余停顿与重复表达，保留完整语义。结合补充画面、字幕与音乐，整理成适合分享的短视频。',
    uses: '访谈切片、课程精华、产品讲解、活动回顾',
    sample: '胶片精剪 · 收紧空白，留下重点',
    prompt: '请帮我自动剪辑视频：从原片挑选重点片段，收紧多余停顿与重复表达，保留完整语义，结合补充画面、字幕与音乐整理叙述节奏。先给出剪辑方案，确认后再制作。',
    clip: { id: 'capability-edit', title: '自动剪辑示例', english: 'Less, but better.', duration: 5, src: editVideo, poster: editPoster, hasAudio: false },
  },
];
