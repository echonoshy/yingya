import { gsap } from 'gsap';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
gsap.registerPlugin(ScrambleTextPlugin);

/** GSAP runs only after intent. Preserve glyph cells so decoding never shifts layout. */
export function playTypewriter(host: HTMLElement, glyphs: HTMLElement[], letters: string[]) {
  host.dataset.typing = 'true'; host.dataset.running = 'type';
  const cursor=host.querySelector<HTMLElement>('.hero-type-cursor')!;
  const timeline=gsap.timeline({onComplete:()=>{host.removeAttribute('data-typing');host.removeAttribute('data-running');}});
  glyphs.forEach((glyph,index)=>{
    timeline.set(glyph,{opacity:0},0);
    timeline.set(glyph,{opacity:1},index*.35+.1);
    timeline.to(glyph,{duration:.42,scrambleText:{text:letters[index],chars:'有画面',speed:.3,tweenLength:false},ease:'none'},index*.35+.1);
    timeline.set(cursor,{left:`${(index+1)*100/3}%`,opacity:1},index*.35+.1);
  });
  timeline.to(cursor,{opacity:0,duration:.15,repeat:3,yoyo:true},1.22);
  return ()=>{timeline.kill();glyphs.forEach((glyph,index)=>{glyph.textContent=letters[index];glyph.style.removeProperty('opacity');});cursor.style.removeProperty('opacity');cursor.style.removeProperty('left');};
}
