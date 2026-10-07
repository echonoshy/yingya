import { UpdateBadge } from '../components/AppUpdate';
import './marketing.css';
import './homeStage.css';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Globe, Scroll, Palette, FilmStrip } from '@phosphor-icons/react';
import { BrandLogo } from './BrandLogo';
import { saveHomeDraft, type HomeSource } from './homeDraft';
import { ActionDialog } from '../components/ActionDialog';
import { HomeBrand } from './HomeBrand';
import { MotionReel } from './MotionReel';
import { InspirationGallery } from './InspirationGallery';
import { HeroType } from './HeroType';
import { PaperDelivery } from '../components/PaperDelivery';
import { ReferenceGallery } from './ReferenceGallery';
import { briefSources } from '../creationBrief';

type Info = 'about' | 'help' | 'contact';
const sourceIcons = { reference: FilmStrip, website: Globe, script: Scroll, style: Palette };
const sources = briefSources.map(item => ({ ...item, icon: sourceIcons[item.id] }));
const titles: Record<Info, string> = { about: '关于映芽', help: '创作帮助', contact: '联系我们' };

function HomeComposer({ prompt, onPrompt, inspirationError, delivery, source, onSource }: { prompt: string; onPrompt: (value: string) => void; inspirationError: string; delivery: number; source: HomeSource; onSource: (source: HomeSource) => void }) {
  const sourcesRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const selected = sources.find(item => item.id === source)!;
  const suggestion = selected.prompts[0];
  useEffect(() => {
    const group = sourcesRef.current;
    if (!group) return;
    const measure = () => {
      const active = group.querySelector<HTMLElement>('button[aria-pressed="true"]')!;
      const x = active.offsetLeft;
      const width = active.offsetWidth;
      group.style.setProperty('--source-x', `${x}px`);
      group.style.setProperty('--source-width', `${width}`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    group.querySelectorAll('button').forEach(button => observer.observe(button));
    return () => observer.disconnect();
  }, [source]);
  useEffect(() => {
    if (focused || prompt) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let timer = 0;
    const run = () => {
      window.clearTimeout(timer);
      if (preference.matches) { setTyped(suggestion); return; }
      setTyped('');
      let position = 0;
      const tick = () => {
        setTyped(suggestion.slice(0, ++position));
        if (position < suggestion.length) timer = window.setTimeout(tick, 85);
      };
      timer = window.setTimeout(tick, 400);
    };
    run(); preference.addEventListener('change', run);
    return () => { window.clearTimeout(timer); preference.removeEventListener('change', run); };
  }, [suggestion, focused, prompt]);
  function start(event: FormEvent) {
    event.preventDefault();
    try { saveHomeDraft(prompt.trim(), source); window.location.assign('/app#/'); }
    catch { setError('输入暂时无法保留，请复制内容后进入创作'); }
  }
  return <form className="home-composer" onSubmit={start} aria-label="准备视频创作">
    <PaperDelivery cue={delivery}/>
    <div ref={sourcesRef} className="home-sources" role="group" aria-label="选择创作起点">{sources.map(item => <button key={item.id} type="button" aria-pressed={source === item.id} onClick={() => onSource(item.id)}><item.icon aria-hidden="true"/>{item.label}</button>)}<span className="home-source-underline" aria-hidden="true" /></div>
    <label className="home-input-label" htmlFor="home-idea">{selected.title}</label>
    <p id="home-source-help" className="home-source-help">{selected.help}</p>
    <div className="home-input-row"><div className="home-input-wrap">
      <textarea id="home-idea" rows={2} value={prompt} maxLength={6000} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={event => { onPrompt(event.target.value); setError(''); }} placeholder={focused ? selected.hint : ''} aria-describedby="home-source-help" />
      {!prompt && !focused ? <div key={source} className="home-typewriter" aria-hidden="true"><span>{typed}</span><span className="home-caret" /></div> : null}
    </div><button className="home-start" type="submit">准备创作<ArrowRight aria-hidden="true" /></button></div>
    {error ? <p className="home-error" role="alert">{error} <a href="/app#/">进入创作</a></p> : null}
    {inspirationError ? <p className="home-error" role="alert">{inspirationError}</p> : null}
  </form>;
}

function InfoContent({ info }: { info: Info }) {
  if (info === 'about') return <div className="home-info-body"><p className="home-info-lead">把值得讲的内容，做成值得看的视频</p><p>映芽帮助你把资料、网页、想法和已有素材，制作成能独立讲解、可以直接分享的视频</p><p>先一起理清讲法，再确认方案、制作视频。你可以通过对话继续修改，不必从时间线和图层开始</p><p>适合知识讲解、课程介绍、产品说明，以及需要把内容讲清楚的时刻</p><a href="/app#/">开始创作<ArrowRight aria-hidden="true" /></a></div>;
  if (info === 'contact') return <div className="home-info-body"><p className="home-info-lead">获取邀请码，或需要协助？</p><p>欢迎发邮件给我们，说明你的需求或遇到的问题</p><p><a href="mailto:echonoshy@gmail.com">echonoshy@gmail.com</a></p><p className="home-info-lead">提交问题或建议</p><p>请在 GitHub Issues 描述你想完成的事情、操作步骤和遇到的现象</p><a href="https://github.com/echonoshy/yingya/issues/new" target="_blank" rel="noopener noreferrer">提交问题或建议<ArrowRight aria-hidden="true" /></a><p className="home-info-note">公开反馈请勿包含密码、账户信息或未公开的客户资料</p></div>;
  return <div className="home-info-body home-help"><p className="home-info-lead">带上内容与参考，一起做好视频</p>
    <details open><summary>怎样开始创作？</summary><p>提供参考视频链接、想复刻的网站、剧本或视觉风格，并说明希望保留和改变的部分。具体内容与清楚的参考，能帮助我们一起确定更好的画面</p><p>例如：把这篇文章做成一分钟中文讲解视频，给第一次接触这个概念的人看</p></details>
    <details><summary>点击“准备创作”会直接制作视频吗？</summary><p>不会。首页会把你填写的内容带到创作页，你可以继续补充。可以先生成参考图，再点击“生成图文方案”，查看关键画面并确认后制作视频</p></details>
    <details><summary>怎样修改视频？</summary><p>在制作工作台描述修改要求。指出时间点、画面或具体文字，会更方便准确修改；需要大幅调整方向时，可以重新讨论方案</p></details>
    <details><summary>作品和素材在哪里？</summary><p>登录后从“项目”打开已有任务，从“素材”查找或上传文件。已有作品与素材会保留在你的账户中</p></details>
    <details><summary>任务失败或页面关闭了怎么办？</summary><p>从“项目”重新打开任务查看进度。如果页面提示失败，保留内容并按提示重试；需要反馈时记录任务名称和错误提示</p></details>
    <details><summary>如何登录或注册？</summary><p>已有账号可使用邮箱和密码登录；新账号需要邀请码。邀请码、密码重置或首次激活请联系管理员或邀请人</p></details>
  </div>;
}

export function MarketingPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [source, setSource] = useState<HomeSource>('reference');
  const [inspirationError, setInspirationError] = useState('');
  const [delivery, setDelivery] = useState(0);
  const hasIdea = Boolean(prompt.trim());
  const chooseInspiration = (value: string) => {
    const next = prompt.includes(value) ? prompt : prompt.trim() ? `${prompt} ${value}` : value;
    const fits = next.length <= 6000;
    if (fits) { setPrompt(next); setInspirationError(''); setDelivery(value => value + 1); }
    else setInspirationError('输入已接近 6000 字，请精简后再添加灵感。原有内容已保留。');
    const input = document.getElementById('home-idea');
    document.querySelector('.marketing-page')?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    input?.focus({ preventScroll: true });
    return fits;
  };
  return <div className="marketing-page home-stage">
    <a className="marketing-skip" href="#main-content">跳到主要内容</a>
    <header className="stage-header"><HomeBrand /><nav aria-label="官网导航"><a className="home-references-link" href="#style-references" onClick={event => { event.preventDefault(); document.getElementById("style-references")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); document.getElementById("references-title")?.focus({ preventScroll: true }); }}>风格参考</a><a className="home-process-link" href="#creation-process" onClick={event => { event.preventDefault(); document.getElementById("creation-process")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }}>能做什么</a><UpdateBadge /><a href="/app#/">进入工作室<ArrowRight aria-hidden="true" /></a></nav></header>
    <main id="main-content" tabIndex={-1}>
      <section className="home-hero" data-has-idea={hasIdea || undefined} aria-labelledby="marketing-title">
        <div className="home-intro">
          <div className="home-poster"><HeroType/></div>
          <div className="home-subtitle"><p>带上参考、剧本与风格，让想法更有画面。</p><p className="home-english" lang="en">Start with a reference. Shape your story.</p></div>
        </div>
        <HomeComposer source={source} onSource={setSource} delivery={delivery} prompt={prompt} inspirationError={inspirationError} onPrompt={value => { setPrompt(value); setInspirationError(''); }}/>
        <MotionReel suspended={previewOpen}/>
      </section>
      <ReferenceGallery onOpenChange={setPreviewOpen} onChoose={clip => {
        const added = chooseInspiration(`参考视频：${new URL(clip.src, window.location.origin).href}\n想借鉴「${clip.title}」的风格，请先结合我的内容与主题，准备图片参考和关键画面，再一起确定方案。`);
        if (added) setSource('reference');
        requestAnimationFrame(() => document.getElementById('home-idea')?.focus({ preventScroll: true }));
        return added;
      }}/>
      <InspirationGallery onChoose={chooseInspiration} suspended={previewOpen}/>
    </main>
    <footer className="home-footer"><BrandLogo compact /><nav aria-label="了解映芽">{(['about', 'help', 'contact'] as const).map(item => <button key={item} type="button" onClick={() => setInfo(item)}>{item === 'about' ? '关于我们' : item === 'help' ? '帮助文档' : '联系我们'}</button>)}</nav></footer>
    {info ? <ActionDialog title={titles[info]} className="home-info-dialog" onClose={() => setInfo(null)}><InfoContent info={info} /></ActionDialog> : null}
  </div>;
}
