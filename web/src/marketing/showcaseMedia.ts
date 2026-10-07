import hd0 from '../assets/showcase/intro-1-1440.mp4';
import poster0 from '../assets/showcase/intro-1.webp';
import hd1 from '../assets/showcase/demo-1-1080.mp4';
import poster1 from '../assets/showcase/demo-1.webp';
import hd2 from '../assets/showcase/demo-2-1080.mp4';
import poster2 from '../assets/showcase/demo-2.webp';
import hd3 from '../assets/showcase/demo-3-1080.mp4';
import poster3 from '../assets/showcase/demo-3.webp';
import hd4 from '../assets/showcase/demo-4-1080.mp4';
import poster4 from '../assets/showcase/demo-4.webp';
import hd5 from '../assets/showcase/demo-5-1080.mp4';
import poster5 from '../assets/showcase/demo-5.webp';
import hd6 from '../assets/showcase/demo-6-1080.mp4';
import poster6 from '../assets/showcase/demo-6.webp';

import hd7 from '../assets/showcase/demo-7-1080.mp4';
import poster7 from '../assets/showcase/demo-7.webp';
import hd8 from '../assets/showcase/demo-8-1080.mp4';
import poster8 from '../assets/showcase/demo-8.webp';
import hd9 from '../assets/showcase/demo-9-1080.mp4';
import poster9 from '../assets/showcase/demo-9.webp';

export type ShowcaseClip = { id: string; title: string; english: string; duration: number; src: string; poster: string; hasAudio?: boolean };
export const filmTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

const clips: ShowcaseClip[] = [
  { id: "intro-1", title: "YingYa 宣传片", english: "From a single point to a world in motion.", duration: 15.019, src: hd0, poster: poster0 },
  { id: "demo-1", title: "弹幕与节拍", english: "Kinetic lyrics", duration: 44.608, src: hd1, poster: poster1 },
  { id: "demo-2", title: "手绘剪辑室", english: "Illustrated editing", duration: 30.016, src: hd2, poster: poster2 },
  { id: "demo-3", title: "轻盈的界面", english: "Interface motion", duration: 30.016, src: hd3, poster: poster3 },
  { id: "demo-4", title: "文字的情绪", english: "Words in motion", duration: 50.539, src: hd4, poster: poster4 },
  { id: "demo-5", title: "字符小剧场", english: "Character stories", duration: 46.805, src: hd5, poster: poster5 },
  { id: "demo-6", title: "形态实验", english: "Form & motion", duration: 30.016, src: hd6, poster: poster6 },
  { id: "demo-7", title: "代码万花筒", english: "A kaleidoscope of code", duration: 25.003, src: hd7, poster: poster7 },
  { id: "demo-8", title: "从诗句到比特", english: "From poetry to bits", duration: 24, src: hd8, poster: poster8 },
  { id: "demo-9", title: "云间列车", english: "Cloud Express", duration: 18.005, src: hd9, poster: poster9 },
];
export const introFilm = clips[0];
export const referenceFilms = clips.slice(1);
