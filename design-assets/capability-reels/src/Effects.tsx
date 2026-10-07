import {useLayoutEffect,useRef} from 'react';
import {useCurrentFrame} from 'remotion';
import points from './glyph-points.json';
import {Film,Editorial,ORANGE,PAPER,ease,rng,tween} from './design';

export function Effects(){
 const f=useCurrentFrame();const ref=useRef<HTMLCanvasElement>(null);const form=ease(f,6,43)*(1-ease(f,95,139));
 useLayoutEffect(()=>{
  const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.clearRect(0,0,1600,900);const rotate=f*Math.PI/75;const count=points.length;
  const plotted=points.map(([tx,ty],i)=>{
   const phi=Math.acos(1-2*(i+.5)/count),theta=i*2.39996323;
   const radius=252+Math.sin(i*1.3)*12;
   const sx=Math.sin(phi)*Math.cos(theta+rotate)*radius;
   const sy=Math.cos(phi)*radius;
   const sz=Math.sin(phi)*Math.sin(theta+rotate)*radius;
   const drift=Math.sin(form*Math.PI)*Math.sin(i*1.7+f/13)*170;
   const x=sx*(1-form)+tx*form+drift;
   const y=sy*(1-form)+ty*form+Math.cos(i*2.1)*drift*.55;
   const z=sz*(1-form)+(rng(i+5)-.5)*48*form;
   const depth=1300/(1300-z);return {x:800+x*depth,y:419+y*depth,z,depth,i};
  }).sort((a,b)=>a.z-b.z);
  for(const p of plotted){
   const light=.23+.7*(p.z+280)/560;
   ctx.fillStyle=p.i%29===0?`rgba(245,88,48,${light})`:p.i%41===0?`rgba(126,151,234,${light})`:`rgba(236,234,230,${light})`;
   const size=(.8+rng(p.i)*1.3)*p.depth;
   ctx.beginPath();ctx.arc(p.x,p.y,size,0,Math.PI*2);ctx.fill();
   if(form>.03&&form<.97&&p.i%9===0){ctx.strokeStyle='rgba(210,215,236,.12)';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+(p.x-800)*.035*Math.sin(form*Math.PI),p.y+(p.y-419)*.035);ctx.stroke();}
  }
 },[f,form]);
 return <Film dark number="01" footer="文字动画 / 粒子与形态">
  <canvas ref={ref} width={1600} height={900} style={{position:'absolute',inset:0}}/>
  <Editorial style={{position:'absolute',left:110,top:688,fontSize:79,color:PAPER}}>From dots to <span style={{color:ORANGE}}>ideas.</span></Editorial>
  <div style={{position:'absolute',right:106,bottom:160,fontSize:27,letterSpacing:3,opacity:tween(f,20,43)}}>{form>.8?'聚成一个想法。':'让想法，有形状。'}</div>
 </Film>;
}
