import { validateDocument, sceneSchedule, documentDuration } from "./model.mjs";
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const js = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
export const fontFamilies = {
  sans: '"Noto Sans SC Variable",sans-serif',
  serif: '"Noto Serif SC Variable",serif',
  mono: '"Fragment Mono","Noto Sans SC Variable",monospace',
};
// Exactly this output is used by the live canvas and immutable render snapshots.
export function compileHTML(document, options = {}) {
  const doc = validateDocument(document),
    duration = documentDuration(doc),
    scheduled = sceneSchedule(doc);
  const assetUrl = options.assetUrl ?? ((path) => path);
  const motions = [],
    media = [];
  const content = scheduled
    .map((scene, index) => {
      const sid = `scene-${scene.id}`;
      motions.push(
        `tl.set(${js("#" + sid)},{visibility:'visible'},${scene.start});tl.set(${js("#" + sid)},{visibility:'hidden'},${scene.start + scene.duration});`,
      );
      const elements = [...scene.elements]
        .sort(
          (a, b) =>
            doc.tracks.findIndex((t) => t.id === a.trackId) -
            doc.tracks.findIndex((t) => t.id === b.trackId),
        )
        .map((el) => {
          const eid = `element-${el.id}`,
            start = scene.start + el.start,
            track = doc.tracks.find((t) => t.id === el.trackId),
            volume = track.muted ? 0 : el.volume;
          const style = `${el.kind === "text" ? "padding:.1em 0;" : ""}left:${el.x}px;top:${el.y}px;width:${el.width}px;height:${el.height}px;transform:rotate(${el.rotation}deg);opacity:${el.opacity};border-radius:${el.radius}px;color:${el.color};font-family:${fontFamilies[el.font]};font-size:${el.fontSize}px;font-weight:${el.fontWeight};text-align:${el.align};object-fit:${el.fit};${el.kind === "shape" ? `background:${el.fill};` : ""}`;
          const common = `id="${eid}" class="element" data-element-id="${el.id}" data-scene-id="${scene.id}" style="${escape(style)}"`;
          const timing = `data-start="${start}" data-duration="${el.duration}" data-media-start="${el.sourceIn}" data-track-index="${doc.tracks.indexOf(track)}" data-volume="${volume}"`;
          motions.push(
            `tl.set(${js("#" + eid)},{visibility:'visible'},${start});tl.set(${js("#" + eid)},{visibility:'hidden'},${start + el.duration});`,
          );
          if (el.animation !== "none") {
            const from =
              el.animation === "rise"
                ? { y: 28, opacity: 0 }
                : el.animation === "scale"
                  ? { scale: 0.94, opacity: 0 }
                  : { opacity: 0 };
            motions.push(
              `tl.fromTo(${js("#" + eid)},${js(from)},{opacity:${el.opacity},y:0,scale:1,duration:${Math.min(0.6, el.duration / 3)},ease:'power2.out',immediateRender:false},${start});`,
            );
          }
          if (el.kind === "text")
            return `<div ${common}>${escape(el.text)}</div>`;
          if (el.kind === "shape") return `<div ${common}></div>`;
          if (el.kind === "image")
            return `<img ${common} src="${escape(assetUrl(el.source))}" alt="${escape(el.name)}"/>`;
          media.push({
            id: eid,
            start,
            duration: el.duration,
            sourceIn: el.sourceIn,
            volume,
          });
          return `<${el.kind} ${common} ${timing} src="${escape(assetUrl(el.source))}" preload="auto" ${el.kind === "video" ? "playsinline" : ""}></${el.kind}>`;
        })
        .join("\n");
      return `<section id="${sid}" class="scene" style="z-index:${index};background:${scene.background}">${elements}</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="${escape(options.gsapUrl ?? "assets/editor-runtime/gsap.js")}"></script><style>${options.fontCss ?? ""}
*{box-sizing:border-box}html,body{margin:0;width:${doc.width}px;height:${doc.height}px;overflow:hidden;background:#ffffff}#main{position:relative;width:${doc.width}px;height:${doc.height}px;overflow:hidden}.scene{position:absolute;inset:0;visibility:hidden}.element{position:absolute;visibility:hidden;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;overflow:hidden;margin:0}audio{display:none}
</style></head><body><main id="main" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${doc.width}" data-height="${doc.height}">${content}</main><script>
const tl=gsap.timeline({paused:true});${motions.join("\n")}tl.to({}, {duration:.001},${Math.max(0, duration - 0.001)});window.__timelines={main:tl};tl.seek(0);
${
  options.interactive
    ? `const clips=${js(media)};let playing=false,position=0,stamp=0,notified=0;const end=${duration};
function sync(time,play){position=Math.max(0,Math.min(end,time));tl.seek(Math.min(position,Math.max(0,end-.001)));for(const c of clips){const m=document.getElementById(c.id),active=position>=c.start&&position<c.start+c.duration; m.volume=Math.min(1,c.volume);if(active){const target=c.sourceIn+position-c.start;if(Math.abs(m.currentTime-target)>.12)m.currentTime=target;if(play)m.play().catch(()=>{});else m.pause();}else m.pause();}const now=performance.now();if(!play||now-notified>=50){notified=now;parent.postMessage({type:'yingya-editor-time',time:position,playing:play},'*');}}
addEventListener('message',e=>{if(e.source!==parent)return;if(e.data?.type==='yingya-editor-seek'){playing=!!e.data.playing;stamp=performance.now();sync(Number.isFinite(e.data.time)?e.data.time:position,playing);}});
function tick(now){if(playing){const t=position+(now-stamp)/1000;if(t>=end)playing=false;sync(t,playing);}stamp=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);
document.addEventListener('click',e=>{const el=e.target.closest('[data-element-id]');if(el)parent.postMessage({type:'yingya-editor-select',elementId:el.dataset.elementId,sceneId:el.dataset.sceneId},'*');});parent.postMessage({type:'yingya-editor-ready'},'*');`
    : ""
}
</script></body></html>`;
}
