import {useCurrentFrame} from 'remotion';
import {Film,Editorial,PAPER,INK,ORANGE,BLUE,enter,ease,tween,mono} from './design';

export function EditCut(){
 const f=useCurrentFrame();const cut=ease(f,32,51);const zip=ease(f,55,80);
 const widths=[270,115*(1-cut),360,100*(1-cut),270];
  return <Film number="04" footer="自动剪辑 / 把节奏留给重点">
  <Editorial style={{position:'absolute',left:100,top:140,fontSize:76}}>Less, but better.</Editorial>
  <div style={{position:'absolute',left:103,top:254,fontSize:29,fontWeight:900,letterSpacing:3}}>收紧停顿，留下重点。</div>
  <div style={{position:'absolute',left:150,top:357,display:'flex',gap:12,transform:`translateX(${zip*37}px) rotate(${tween(f,0,24,-4,0)}deg)`}}>
   {widths.map((width,i)=>{const lift=enter(f,i*3);return <div key={i} style={{position:'relative',height:226,width:width*(i%2?1:lift),overflow:'hidden',flexShrink:0,background:i%2?'#a8a49d':i===2?ORANGE:INK,color:PAPER,opacity:i%2?1-cut:1,boxShadow:'0 17px 24px #25231d18'}}>
    <div style={{position:'absolute',left:0,right:0,top:9,height:8,backgroundImage:'repeating-linear-gradient(90deg, transparent 0 12px, #eeeae199 12px 27px, transparent 27px 39px)'}}/>
    <div style={{position:'absolute',left:0,right:0,bottom:9,height:8,backgroundImage:'repeating-linear-gradient(90deg, transparent 0 12px, #eeeae199 12px 27px, transparent 27px 39px)'}}/>
    {i%2?<div style={{position:'absolute',top:90,left:15,fontFamily:mono,fontSize:17,whiteSpace:'nowrap'}}>··· 1.2 s</div>:<div style={{position:'absolute',inset:'34px 22px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:i===2?62:66,whiteSpace:'nowrap',letterSpacing:-3}}>{['想法','','变成','','画面'][i]}</div>}
    {i%2&&f>28?<div style={{position:'absolute',width:250,height:2,background:ORANGE,top:112,left:-60,rotate:'-48deg'}}/>:null}
   </div>})}
  </div>
  <svg width="1310" height="98" viewBox="0 0 1310 98" style={{position:'absolute',left:145,top:633}}>
   {Array.from({length:138},(_,i)=>{const pause=i>38&&i<59;const h=pause?4:12+Math.sin(i*1.52)**2*49;return <rect key={i} x={i*9.2-(i>58?cut*188:0)} y={45-h/2} width="3" height={h} fill={pause?'#918e88':i<78?INK:BLUE} opacity={pause?1-cut:.7}/>})}
   <line x1={f*14} x2={f*14} y1="0" y2="90" stroke={ORANGE} strokeWidth="2"/>
  </svg>
 </Film>;
}
