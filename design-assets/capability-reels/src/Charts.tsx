import {useCurrentFrame} from 'remotion';
import {Film,Editorial,PAPER,ORANGE,BLUE,INK,enter,ease,tween,mono} from './design';

type Block={x:number;y:number;z:number;height:number;tone:number};
const project=(x:number,y:number,z:number)=>[860+(x-y)*67,440+(x+y)*35-z] as const;
function Cube({x,y,z,height,tone}:Block){
 const [cx,cy]=project(x,y,z);const top=cy-height;
 const shades=[['#eeeae1','#d1cec8','#a9a7a3'],['#5574ed',BLUE,'#213795'],['#ff7957',ORANGE,'#b93216'],['#34363d',INK,'#090a0e']][tone];
 return <g stroke={tone===0?'#8b8982':'#11121633'} strokeWidth="1.2" strokeLinejoin="round"><path d={`M${cx} ${top}l67 35-67 35-67-35Z`} fill={shades[0]}/><path d={`M${cx-67} ${top+35}l67 35v${height}l-67-35Z`} fill={shades[1]}/><path d={`M${cx} ${top+70}l67-35v${height}l-67 35Z`} fill={shades[2]}/></g>;
}
export function Charts(){
 const f=useCurrentFrame();const lift=ease(f,15,100);const blocks:Block[]=[];
 for(let y=0;y<5;y++)for(let x=0;x<7;x++){
  const group=x<2?0:x<4?1:2;const featured=y===1||y===2;const stagger=enter(f,10+(x+y)*3);
  const tiers=featured?[2,4,6][group]:1;const tierHeight=featured?[42,68,86][group]*3/tiers:28;
  for(let z=0;z<tiers;z++){const growth=featured?enter(f,20+z*6+x*4):stagger;const h=tierHeight*Math.max(0,growth);blocks.push({x,y,z:z*tierHeight*Math.max(0,growth),height:h,tone:featured?(group===2?2:group===1?1:0):(x+y)%5===0?3:0});}
 }
 blocks.sort((a,b)=>(a.x+a.y)-(b.x+b.y)||a.z-b.z);
 return <Film number="03" footer="动态图表 / 示例数据">
  <Editorial style={{position:'absolute',left:100,top:133,fontSize:96}}>Growth, in motion.</Editorial>
  <div style={{position:'absolute',left:107,top:278,fontSize:29,letterSpacing:3}}>把变化，讲清楚。</div>
  <svg width="1600" height="900" viewBox="0 0 1600 900" style={{position:'absolute',inset:0,transform:`translateY(${(1-lift)*30}px)`}}>
   <defs><filter id="blockShadow" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="17"/></filter></defs>
   <path d="M866 503L1429 747 1050 865 477 619Z" fill="#51463a" opacity=".15" filter="url(#blockShadow)"/>
   <g transform="translate(25 -78)">{blocks.map((block,i)=><Cube key={i} {...block}/>)}</g>
  </svg>
  <div style={{position:'absolute',left:107,top:435,fontSize:107,lineHeight:1,letterSpacing:-7,fontVariantNumeric:'tabular-nums'}}>{Math.round(42+44*lift)}<span style={{fontSize:44,letterSpacing:-2,color:ORANGE}}> %</span></div>
  <div style={{position:'absolute',left:113,top:577,fontFamily:mono,fontSize:23,color:'#77746d'}}>42 → 68 → 86</div>
  <div style={{position:'absolute',left:113,top:636,fontSize:24,color:'#77746d',opacity:tween(f,65,95)}}>三期变化，逐步呈现。</div>
  <div style={{position:'absolute',right:108,top:149,display:'flex',gap:12,alignItems:'center',fontFamily:mono,fontSize:19,color:'#77746d'}}><span style={{width:11,height:11,background:ORANGE}}/>2023 — 2025</div>
  <div style={{position:'absolute',left:1030,bottom:129,background:PAPER,padding:'8px 18px',fontSize:21,letterSpacing:4}}>从数字，到发现。</div>
 </Film>;
}
