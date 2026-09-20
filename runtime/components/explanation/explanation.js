/* Yingya original explanation components. Absolute scene time, no wall clock. */
(function(global) {
  'use strict';
  const kinds=['concept','process','compare','data','cause','footage'];
  function node(tag,cls,text) { const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=String(text);return el; }
  function finite(n,name) { if(typeof n!=='number'||!Number.isFinite(n))throw new TypeError(`${name} must be finite`);return n; }
  for(const kind of kinds) global.YingyaComponents.define(`explain-${kind}`,(container,config)=>{
    if(!global.gsap)throw new Error('Load local GSAP before explanation components');
    const start=finite(config.startSeconds,'startSeconds'),duration=finite(config.durationSeconds,'durationSeconds');
    if(start<0||duration<=0)throw new Error('Invalid scene timing');
    if(!Array.isArray(config.items)||!config.items.length||config.items.length>6)throw new Error('Supply one to six explanatory items');
    const root=node('section',`explain-scene explain-${kind}`),heading=node('h2','explain-title',config.title),body=node('div','explain-body');
    root.append(heading,body);container.append(root);body.style.setProperty("--explain-columns",Math.max(1,Math.min(kind==='compare'?2:3,config.items.length-(kind==='concept'?1:0))));
    const objects=[];
    const values=kind==='data'?config.items.map(i=>finite(i.value,'data value')):[];
    if(values.some(n=>n<0))throw new Error('This bar component supports nonnegative data; choose another truthful scale for signed values');
    const max=kind==='data'?finite(config.maxValue??Math.max(...values,1),'maxValue'):1;
    if(max<=0||values.some(n=>n>max))throw new Error('Scale must contain every value');
    let media=null,seekPromise=Promise.resolve();
    if(kind==='footage') {
      if(typeof config.mediaSrc!=='string'||!config.mediaSrc)throw new Error('Footage needs an actual mediaSrc');
      media=node(config.mediaType==='video'?'video':'img','explain-media');media.src=config.mediaSrc;
      if(media.tagName==='VIDEO'){media.muted=true;media.playsInline=true;media.preload='auto';}else media.alt=config.mediaAlt||config.title||'说明素材';
      const frame=node("div","explain-media-frame"); frame.append(media); body.append(frame);
      if(config.focus){const r=config.focus;if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1||r.y+r.height>1)throw new Error('Invalid normalized focus');const focus=node('div','explain-focus');Object.assign(focus.style,{left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.width*100}%`,height:`${r.height*100}%`});frame.append(focus);objects.push(focus);}
    }
    config.items.forEach((item,index)=>{
      if(typeof item.label!=='string'||!item.label.trim())throw new Error('Each item needs a label');
      const card=node('div','explain-item');
      if(kind==='process'||kind==='cause')card.append(node('span','explain-step',String(index+1).padStart(2,'0')));
      card.append(node('h3','',item.label));if(item.detail)card.append(node('p','',item.detail));
      if(kind==='data'){const track=node('div','explain-track'),bar=node('div','explain-bar');bar.style.width=`${item.value/max*100}%`;track.append(bar);card.append(track,node('span','explain-value',`${item.value}${config.unit||''}`));objects.push(bar);}
      body.append(card);objects.push(card);
    });
    if(config.note)root.append(node('p','explain-note',config.note));
    const tl=global.gsap.timeline({paused:true});
    tl.fromTo(heading,{opacity:0,y:12},{opacity:1,y:0,duration:.45},0);
    objects.forEach((el,i)=>tl.fromTo(el,{opacity:0,y:16},{opacity:1,y:0,duration:.45},Math.min(.35+i*.28,duration*.4)));
    const ready=Promise.all([document.fonts.ready,media?new Promise((resolve,reject)=>{if(media.tagName==='IMG'&&media.complete&&media.naturalWidth)return resolve();if(media.tagName==='VIDEO'&&media.readyState>=1)return resolve();const timer=setTimeout(()=>reject(new Error('Explanation media load timed out')),15000);media.addEventListener(media.tagName==='VIDEO'?'loadedmetadata':'load',()=>{clearTimeout(timer);resolve();},{once:true});media.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Explanation media failed'));},{once:true});}):Promise.resolve()]);
    return {startSeconds:start,durationSeconds:duration,ready,
      renderAt(time){const local=Math.max(0,Math.min(duration,time-start));root.style.visibility=time>=start&&time<start+duration?'visible':'hidden';tl.totalTime(local,false);
        if(media?.tagName==='VIDEO'){const target=Math.min(Math.max(0,media.duration-.001),(config.sourceIn||0)+local);seekPromise=seekPromise.then(()=>new Promise((resolve,reject)=>{media.pause();if(Math.abs(media.currentTime-target)<.001&&!media.seeking)return resolve();const timer=setTimeout(()=>{media.removeEventListener('seeked',done);reject(new Error('Video seek timed out'));},10000);function done(){clearTimeout(timer);resolve();}media.addEventListener('seeked',done,{once:true});media.currentTime=target;}));return seekPromise;}
      },dispose(){tl.kill();if(media?.tagName==='VIDEO'){media.pause();media.removeAttribute('src');media.load();}root.remove();}
    };
  });
})(window);
