import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Cube, DotsSix, TextT } from '@phosphor-icons/react';
import { usePlayMotion } from '../components/KineticType';
import './heroType.css';

type Treatment = 'depth' | 'particles' | 'type';
const treatments = [{ id: 'depth', label: '立体', icon: Cube }, { id: 'particles', label: '粒子', icon: DotsSix }, { id: 'type', label: '打字', icon: TextT }] as const;
const letters = Array.from('有画面');

/** The real heading is always accessible; effects only paint its decorative copy. */
export function HeroType() {
  const [mode, setMode] = useState<Treatment>('depth');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = useRef<() => void>(() => undefined);
  const animate = usePlayMotion();

  useEffect(() => {
    const host = root.current, trigger = button.current, surface = canvas.current;
    if (!host || !trigger || !surface) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const face = trigger.querySelector<HTMLElement>('.hero-type-face')!;
    const glyphs = Array.from(trigger.querySelectorAll<HTMLElement>('.kinetic-letter'));
    let disposed = false, visible = true, generation = 0, raf = 0;
    let disposeText: (() => void) | undefined;
    const stop = () => {
      ++generation; cancelAnimationFrame(raf); raf = 0; disposeText?.(); disposeText = undefined;
      surface.getContext('2d')?.clearRect(0, 0, surface.width, surface.height);
      trigger.removeAttribute('data-particles'); trigger.removeAttribute('data-typing'); trigger.removeAttribute('data-running');
      face.style.removeProperty('transform');
      face.style.removeProperty('opacity');
      glyphs.forEach((el, index) => { el.getAnimations().forEach(a => a.cancel()); el.textContent = letters[index]; });
      trigger.querySelector('.hero-type-cursor')?.getAnimations().forEach(a => a.cancel());
    };
    const permitted = () => !disposed && visible && !document.hidden && !preference.matches;
    const particleBurst = async () => {
      const ticket = generation;
      await document.fonts.ready;
      if (!permitted() || ticket !== generation) return;
      const context = surface.getContext('2d');
      if (!context) return;
      const rect = trigger.getBoundingClientRect(), width = rect.width + 96, height = rect.height + 96;
      const dpr = Math.min(devicePixelRatio, 2);
      surface.width = Math.ceil(width*dpr); surface.height = Math.ceil(height*dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const mask = document.createElement('canvas'); mask.width = Math.ceil(width); mask.height = Math.ceil(height);
      const ink = mask.getContext('2d', { willReadFrequently: true });
      if (!ink) return;
      ink.textBaseline = 'alphabetic';
      glyphs.forEach(glyph => {
        const style = getComputedStyle(glyph), box = glyph.getBoundingClientRect();
        ink.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = ink.measureText(glyph.textContent || '');
        const fontHeight = (metrics.fontBoundingBoxAscent || Number.parseFloat(style.fontSize)) + (metrics.fontBoundingBoxDescent || 0);
        const baseline = (box.height-fontHeight)/2 + (metrics.fontBoundingBoxAscent || Number.parseFloat(style.fontSize));
        ink.fillText(glyph.textContent || '', box.left-rect.left+48, box.top-rect.top+48+baseline);
      });
      const pixels = ink.getImageData(0, 0, mask.width, mask.height).data;
      const points: {x:number;y:number;dx:number;dy:number;size:number;blue:boolean}[]=[];
      const step=rect.width < 220 ? 2.5 : 3.6;
      for(let y=0;y<mask.height;y+=step) for(let x=0;x<mask.width;x+=step) {
        if(pixels[(Math.floor(y)*mask.width+Math.floor(x))*4+3] < 150) continue;
        const seed=Math.sin(x*12.9898+y*78.233)*43758.5453, n=seed-Math.floor(seed);
        const angle=n*Math.PI*2, radius=18+n*58;
        points.push({x,y,dx:Math.cos(angle)*radius,dy:Math.sin(angle)*radius,size:step*.34,blue:n>.76});
      }
      const started=performance.now(); trigger.dataset.particles='true'; trigger.dataset.running='particles';
      const draw=(now:number)=>{
        if(!permitted()||ticket!==generation){stop();return;}
        const t=(now-started)/1000;
        const scatter=t<.65 ? Math.sin(t/.65*Math.PI/2) : t<1 ? 1 : Math.pow(Math.max(0,1-(t-1)/1.3),3);
        context.clearRect(0,0,width,height);
        context.globalAlpha=t>2.3 ? Math.max(0,1-(t-2.3)/.35) : 1;
        for(const point of points){
          const x=point.x+point.dx*scatter, y=point.y+point.dy*scatter;
          context.fillStyle=point.blue?'#1468f3':'#111310';context.beginPath();context.arc(x,y,point.size*(1+scatter*.7),0,Math.PI*2);context.fill();
        }
        face.style.opacity=String(t>2.3 ? Math.min(1,(t-2.3)/.35) : 0);
        if(t<2.65) raf=requestAnimationFrame(draw);else {face.style.removeProperty('opacity');stop();}
      };
      raf=requestAnimationFrame(draw);
    };
    run.current = () => {
      if(mode!=='depth') stop();
      face.style.removeProperty('opacity');
      if(!permitted()) {stop();return;}
      if(mode==='particles') { void particleBurst(); return; }
      if(mode==='type') {
        const ticket=generation;
        void import('./typewriterEffect').then(({playTypewriter})=>{
          if(!permitted()||generation!==ticket) return;
          disposeText=playTypewriter(trigger,glyphs,letters);
        }).catch(()=>stop());
        return;
      }
      glyphs.forEach((glyph,index)=>animate(glyph,[
        {transform:'perspective(700px) rotateX(0deg) rotateY(0deg) translateZ(0)'},
        {transform:`perspective(700px) rotateX(-24deg) rotateY(${index%2?-28:24}deg) translateZ(28px) translateY(-.07em)`,offset:.32},
        {transform:'perspective(700px) rotateX(12deg) rotateY(-8deg) translateZ(10px)',offset:.7},
        {transform:'perspective(700px) rotateX(0deg) rotateY(0deg) translateZ(0)'},
      ],1050,index*80));
    };
    const synchronize=()=>{if(!permitted()){stop();face.style.removeProperty('opacity');}};
    const editing=(event:FocusEvent)=>{if(event.target instanceof Element && event.target.matches('input,textarea')) {stop();face.style.removeProperty('opacity');}};
    const observer=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);synchronize();});observer.observe(host);
    preference.addEventListener('change',synchronize);document.addEventListener('visibilitychange',synchronize);
    document.addEventListener('focusin',editing);
    let previousWidth = trigger.clientWidth, previousHeight = trigger.clientHeight;
    const resize=new ResizeObserver(()=>{
      const changed = previousWidth !== trigger.clientWidth || previousHeight !== trigger.clientHeight;
      previousWidth = trigger.clientWidth; previousHeight = trigger.clientHeight;
      if(changed && trigger.hasAttribute('data-particles')) {stop();face.style.removeProperty('opacity');}
    });resize.observe(trigger);
    return ()=>{disposed=true;stop();face.style.removeProperty('opacity');observer.disconnect();resize.disconnect();preference.removeEventListener('change',synchronize);document.removeEventListener('visibilitychange',synchronize);document.removeEventListener('focusin',editing);run.current=()=>undefined;};
  },[mode,animate]);

  // Mode selection runs after its effect is ready; no automatic loop on page load.
  const pending = useRef(false);
  useEffect(()=>{if(pending.current){pending.current=false;run.current();}},[mode]);
  const tilt=(event:PointerEvent<HTMLButtonElement>)=>{
    if(mode!=='depth'||event.pointerType!=='mouse'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const rect=event.currentTarget.getBoundingClientRect();
    const x=(event.clientX-rect.left)/rect.width-.5,y=(event.clientY-rect.top)/rect.height-.5;
    const face=event.currentTarget.querySelector<HTMLElement>('.hero-type-face');
    if(face)face.style.transform=`perspective(700px) rotateX(${-y*14}deg) rotateY(${x*17}deg)`;
  };
  return <div ref={root} className="hero-type" data-treatment={mode}>
    <h1 id="marketing-title"><span>让想法，</span><span className="home-title-answer">
      <button ref={button} type="button" className="playful-word home-selected-word" onClick={()=>run.current()} onPointerMove={tilt} onPointerLeave={()=>button.current?.querySelector<HTMLElement>('.hero-type-face')?.style.removeProperty('transform')} aria-label="有画面 点字玩一下">
        <span className="sr-only">有画面</span>
        <span className="hero-type-face kinetic-type" aria-hidden="true">{letters.map((letter,index)=><span className="kinetic-hit" key={index}><span className="kinetic-letter" data-letter={letter}>{letter}</span></span>)}</span>
        <canvas ref={canvas} className="hero-type-particles" aria-hidden="true"/>
        <span className="hero-type-cursor" aria-hidden="true"/>
        <i className="home-title-selection" aria-hidden="true"/><span className="playful-word-hint" aria-hidden="true">点字玩一下</span>
      </button>。</span></h1>
    <div className="hero-type-tools" role="group" aria-label="标题特效">{treatments.map(({id,label,icon:Icon})=><button type="button" key={id} aria-pressed={mode===id} onClick={()=>{if(mode===id)run.current();else{pending.current=true;setMode(id);}}}><Icon aria-hidden="true"/><span>{label}</span></button>)}</div>
  </div>;
}
