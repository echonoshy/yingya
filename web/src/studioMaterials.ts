/** Prepared and reviewed media; imports become immutable Vite assets. */
import startPoster from "./assets/studio/01-start-story.webp";
import startVideo from "./assets/studio/01-start-story.mp4";
import thinkingPoster from "./assets/studio/02-thinking.webp";
import thinkingVideo from "./assets/studio/02-thinking.mp4";
import reviewPoster from "./assets/studio/03-review-plan.webp";
import reviewVideo from "./assets/studio/03-review-plan.mp4";
import readyPoster from "./assets/studio/04-ready.webp";
import readyVideo from "./assets/studio/04-ready.mp4";
import recoverPoster from "./assets/studio/05-recover.webp";
import recoverVideo from "./assets/studio/05-recover.mp4";
import assetsPoster from "./assets/studio/06-assets-folder.webp";
import assetsVideo from "./assets/studio/06-assets-folder.mp4";
import makingPoster from "./assets/studio/07-render-reel.webp";
import makingVideo from "./assets/studio/07-render-reel.mp4";
import searchPoster from "./assets/studio/08-search-empty.webp";
import searchVideo from "./assets/studio/08-search-empty.mp4";
import voicePoster from "./assets/studio/09-voice-listen.webp";
import voiceVideo from "./assets/studio/09-voice-listen.mp4";
import waitingPoster from "./assets/studio/10-resting-cloud.webp";
import waitingVideo from "./assets/studio/10-resting-cloud.mp4";
import scene01Poster from "./assets/studio/scene-01-character-hello.webp";
import scene01Video from "./assets/studio/scene-01-character-hello.mp4";
import scene02Poster from "./assets/studio/scene-02-light-door.webp";
import scene02Video from "./assets/studio/scene-02-light-door.mp4";
import scene03Poster from "./assets/studio/scene-03-sunset-city.webp";
import scene03Video from "./assets/studio/scene-03-sunset-city.mp4";
import scene04Poster from "./assets/studio/scene-04-flower-bloom.webp";
import scene04Video from "./assets/studio/scene-04-flower-bloom.mp4";
import scene05Poster from "./assets/studio/scene-05-living-book.webp";
import scene05Video from "./assets/studio/scene-05-living-book.mp4";
import scene06Poster from "./assets/studio/scene-06-paper-rabbit.webp";
import scene06Video from "./assets/studio/scene-06-paper-rabbit.mp4";
import scene07Poster from "./assets/studio/scene-07-flowing-lines.webp";
import scene07Video from "./assets/studio/scene-07-flowing-lines.mp4";
import scene08Poster from "./assets/studio/scene-08-portrait-welcome.webp";
import scene08Video from "./assets/studio/scene-08-portrait-welcome.mp4";

export type StudioMaterial = { poster: string; video: string; label: string };
export const stateMaterials = {
  start: { poster: startPoster, video: startVideo, label: "开始一个故事" },
  thinking: { poster: thinkingPoster, video: thinkingVideo, label: "正在构思" },
  review: { poster: reviewPoster, video: reviewVideo, label: "等待确认" },
  ready: { poster: readyPoster, video: readyVideo, label: "作品已就绪" },
  recover: { poster: recoverPoster, video: recoverVideo, label: "稍后继续" },
  assets: { poster: assetsPoster, video: assetsVideo, label: "整理素材" },
  making: { poster: makingPoster, video: makingVideo, label: "正在制作" },
  search: { poster: searchPoster, video: searchVideo, label: "寻找素材" },
  voice: { poster: voicePoster, video: voiceVideo, label: "听见声音" },
  waiting: { poster: waitingPoster, video: waitingVideo, label: "稍候再见" },
} satisfies Record<string, StudioMaterial>;
export type StudioMaterialName = keyof typeof stateMaterials;
export const characterMaterial: StudioMaterial = { poster: scene01Poster, video: scene01Video, label: "橙发角色" };
export const inspirationScenes = [
  { id: "scene-03", title: "黄昏城市", poster: scene03Poster, video: scene03Video, label: "黄昏城市" },
  { id: "scene-02", title: "走向光门", poster: scene02Poster, video: scene02Video, label: "走向光门" },
  { id: "scene-04", title: "一朵花的开始", poster: scene04Poster, video: scene04Video, label: "一朵花的开始" },
  { id: "scene-05", title: "书页里的故事", poster: scene05Poster, video: scene05Video, label: "书页里的故事" },
  { id: "scene-06", title: "追光的纸兔", poster: scene06Poster, video: scene06Video, label: "追光的纸兔" },
  { id: "scene-07", title: "流动的线", poster: scene07Poster, video: scene07Video, label: "流动的线" },
  { id: "scene-08", title: "竖屏邀请", poster: scene08Poster, video: scene08Video, label: "竖屏邀请" },
] satisfies (StudioMaterial & { id: string; title: string })[];
