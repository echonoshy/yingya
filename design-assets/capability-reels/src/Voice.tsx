import {Audio,Sequence,staticFile,useCurrentFrame} from 'remotion';
import {Film,Editorial,ORANGE,INK,PAPER,BLUE,enter,ease,tween} from './design';
import captions from './voice-captions.json';

export function Voice(){
 const f=useCurrentFrame();const ms=(f-12)/30*1000;const second=ms>=2200;const words=captions.filter(c=>second?c.startMs>=2200:c.startMs<2200);
 const sweep=ease(f,65,81);const active=words.findIndex(c=>ms>=c.startMs&&ms<c.endMs);
 return <Film number="02" footer="自动配音 / 字幕随声而动">
  <Sequence from={12}><Audio src={staticFile('voice.wav')} volume={1.25}/></Sequence>
  <div style={{position:'absolute',left:111,top:145,width:64,height:64,background:ORANGE,borderRadius:64,scale:1+Math.sin(f/3)*.035}}/>
  <Editorial style={{position:'absolute',left:196,top:133,fontSize:77}}>A voice. A story.</Editorial>
  <div style={{position:'absolute',left:103,top:second?300:310,right:100,display:'flex',flexWrap:'wrap',alignContent:'flex-start',fontSize:second?118:171,lineHeight:1.32,letterSpacing:-7}}>
   {words.map((word,i)=>{const start=word.startMs/1000*30+12;const e=enter(f,start);return <span key={word.startMs} style={{display:'contents'}}>{word.text==='都'?<span style={{flexBasis:'100%',height:0}}/>:null}<span style={{display:'inline-block',position:'relative',color:ms>=word.startMs?INK:'#bbb7af',transform:`translateY(${ms>=word.startMs?(1-e)*24:0}px)`}}>{word.text}<span style={{position:'absolute',left:3,right:0,bottom:2,height:8,background:i===active?ORANGE:'transparent'}}/></span></span>})}
  </div>
  <div style={{position:'absolute',left:112,bottom:148,width:1375,height:1,background:'#201e1926'}}/>
  <div style={{position:'absolute',left:112,bottom:145,width:tween(f,12,147)*1375,height:6,background:BLUE}}/>
  <div style={{position:'absolute',right:108,top:170,fontSize:26,color:'#7b776f',letterSpacing:2}}>让每一个字，被听见。</div>
  <div style={{position:'absolute',inset:0,pointerEvents:'none',background:PAPER,opacity:Math.sin(sweep*Math.PI)*.06}}/>
 </Film>;
}
