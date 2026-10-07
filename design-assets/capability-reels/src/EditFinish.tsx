import {useCurrentFrame} from 'remotion';
import {Film,Editorial,ORANGE,enter,tween} from './design';
export function EditFinish(){
 const f=useCurrentFrame();const p=enter(f);return <Film dark number="04" footer="自动剪辑 / 把节奏留给重点">
  <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:365,lineHeight:1,letterSpacing:-24,transform:`scale(${1.12-p*.12})`,opacity:p}}>CUT<span style={{color:ORANGE,display:'inline-block',transform:`translateY(${Math.sin(f/14)*6}px)`}}>.</span></div>
  <Editorial style={{position:'absolute',left:0,right:0,textAlign:'center',top:623,fontSize:63,opacity:tween(f,8,23)}}>Every second counts.</Editorial>
 </Film>;
}
