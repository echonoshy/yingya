import {loadFont} from '@remotion/fonts';
import {AbsoluteFill, Easing, interpolate, spring, staticFile} from 'remotion';
import type {CSSProperties, ReactNode} from 'react';

export const PAPER='#eeeae1', INK='#111216', ORANGE='#f04c24', BLUE='#3154de';
export const sans='Example Sans, sans-serif', serif='Example Editorial, serif', mono='Example Mono, monospace';
export const fontsReady=Promise.all([
 loadFont({family:'Example Sans',url:staticFile('fonts/Sans.woff2'),weight:'900'}),
 loadFont({family:'Example Serif',url:staticFile('fonts/Serif.woff2'),weight:'700'}),
 loadFont({family:'Example Editorial',url:staticFile('fonts/Editorial.ttf'),style:'italic'}),
 loadFont({family:'Example Mono',url:staticFile('fonts/Mono.woff2')}),
]);
export const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
export const tween=(f:number,a:number,b:number,x=0,y=1)=>interpolate(f,[a,b],[x,y],clamp);
export const ease=(f:number,a:number,b:number,x=0,y=1)=>interpolate(f,[a,b],[x,y],{...clamp,easing:Easing.bezier(.65,0,.2,1)});
export const enter=(f:number,delay=0)=>spring({frame:f-delay,fps:30,config:{damping:18,stiffness:115}});
export const rng=(n:number)=>{const x=Math.sin(n*127.13+43.71)*43758.5453;return x-Math.floor(x);};
export function Film({children,dark=false,color,footer,number}:{children:ReactNode;dark?:boolean;color?:string;footer:string;number:string}){
 return <AbsoluteFill style={{background:color??(dark?INK:PAPER),color:dark?PAPER:INK,fontFamily:sans,overflow:'hidden'}}>
  <AbsoluteFill style={{background:dark?'radial-gradient(ellipse at 52% 43%, #25273366, #0005)':'radial-gradient(ellipse at 52% 45%, #fff9, #6b64531c)'}}/>
  {children}
  <AbsoluteFill style={{pointerEvents:'none',backgroundImage:`url(${staticFile('grain.png')})`,backgroundSize:'512px 512px',backgroundPosition:'93px 67px',mixBlendMode:'soft-light',opacity:.14}}/>
  <AbsoluteFill style={{pointerEvents:'none',boxShadow:`inset 0 0 150px ${dark?'#0006':'#31281812'}`}}/>
  <div style={{position:'absolute',left:62,top:45,fontFamily:mono,fontSize:15,letterSpacing:3,opacity:.64}}>YINGYA / MOTION STUDIES</div>
  <div style={{position:'absolute',right:64,top:45,fontFamily:mono,fontSize:15,letterSpacing:2,opacity:.64}}>{number} — 04</div>
  <div style={{position:'absolute',left:64,bottom:44,fontFamily:mono,fontSize:17,letterSpacing:2,opacity:.7}}>{footer}</div>
  <div style={{position:'absolute',right:64,bottom:43,width:8,height:8,borderRadius:'50%',background:ORANGE}}/>
 </AbsoluteFill>;
}
export function Editorial({children,style}:{children:ReactNode;style?:CSSProperties}){return <div style={{fontFamily:serif,fontStyle:'italic',fontWeight:400,letterSpacing:-3,...style}}>{children}</div>;}
