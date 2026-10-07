import { ArrowRight, Check } from '@phosphor-icons/react';
import { useState } from 'react';
import './inspiration.css';
import { KineticType } from '../components/KineticType';
import { ShowcasePlayer } from './ShowcasePlayer';
import { creationCapabilities as inspirations, type CreationDirection } from './creationCapabilities';

export function InspirationGallery({ onChoose, suspended = false }: { onChoose: (prompt: string) => boolean; suspended?: boolean }) {
  const [selected, setSelected] = useState<CreationDirection>('effects');
  const [added, setAdded] = useState(false);
  const inspiration = inspirations.find(item => item.id === selected)!;
  return <section id="creation-process" className="home-inspiration" aria-labelledby="inspiration-title">
    <header className="inspiration-header">
      <h2 id="inspiration-title">从素材出发，<br/><span className="inspiration-handwriting"><KineticType text="让视频更出彩。" reveal/></span></h2>
      <div><p className="home-english" lang="en">Cut. Create. Make it yours.</p><p>让文案动起来，把口播剪利落，<br className="inspiration-desktop-break"/>用声音讲故事，用动画讲清数据。</p></div>
    </header>
    <div className="inspiration-grid" role="group" aria-label="选择视频功能">{inspirations.map((item, index) => <button key={item.id} type="button" className="inspiration-pick" aria-pressed={selected === item.id} aria-controls="inspiration-demo" onClick={() => { setSelected(item.id); setAdded(false); }}>
      <span className="inspiration-number">0{index + 1}</span>{' '}<span className="inspiration-feature"><strong><span className="inspiration-full-title">{item.title}</span><span className="inspiration-short-title" aria-hidden="true">{item.shortTitle}</span></strong><span>{item.description}</span></span><span className="inspiration-action" aria-hidden="true">{selected === item.id ? <Check/> : <ArrowRight/>}</span>
    </button>)}</div>
    <div id="inspiration-demo" className="inspiration-example" role="region" aria-label={`${inspiration.title}示例与用途`}>
      <div className="inspiration-film-meta"><span>原创短片示例</span><span>{inspiration.clip.duration} 秒 · {inspiration.clip.hasAudio ? '可开启声音' : '无声短片'}</span></div>
      <ShowcasePlayer key={selected} clip={inspiration.clip} playWhenVisible loop suspended={suspended}/>
      <p className="inspiration-sample">{inspiration.sample}</p>
      <div className="inspiration-detail"><h3>{inspiration.headline}</h3><p>{inspiration.detail}</p><p className="inspiration-uses"><span>可以用来做</span>{inspiration.uses}</p></div>
      <div className="inspiration-start"><button type="button" onClick={() => { if (onChoose(inspiration.prompt)) setAdded(true); }}>用这个功能开始<ArrowRight aria-hidden="true"/></button><p>添加你的素材与要求，确认方案后再制作</p></div>
    </div>
    <span className="sr-only" role="status">{added ? '功能要求已补充到输入框，原有内容已保留' : `已选择${inspiration.title}，可观看短片并阅读用途`}</span>
  </section>;
}
