// Loaded only in the opaque-origin, read-only composition frame.
(() => {
  let playing = true;
  let timeline;
  function fit() {
    const root = document.querySelector('[data-composition-id]');
    if (!root) return;
    const width = Number(root.dataset.width) || root.offsetWidth;
    const height = Number(root.dataset.height) || root.offsetHeight;
    if (!width || !height) return;
    const scale = Math.min(innerWidth / width, innerHeight / height);
    Object.assign(document.documentElement.style, { overflow: 'hidden', width: '100%', height: '100%' });
    Object.assign(document.body.style, { margin: '0', width: `${width}px`, height: `${height}px`, position: 'absolute', left: `${(innerWidth-width*scale)/2}px`, top: `${(innerHeight-height*scale)/2}px`, transformOrigin: '0 0', transform: `scale(${scale})` });
  }
  function apply() {
    const root = document.querySelector('[data-composition-id]');
    timeline = window.__timelines?.[root?.dataset.compositionId] || Object.values(window.__timelines || {})[0];
    if (timeline) { timeline.repeat?.(-1); playing ? timeline.play?.() : timeline.pause?.(); }
    if (!playing) for (const media of document.querySelectorAll('video,audio')) media.pause();
  }
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'yingya-preview-playback' || typeof event.data.playing !== 'boolean') return;
    playing = event.data.playing; for(const media of document.querySelectorAll('video,audio'))delete media.dataset.yingyaAutoplayBlocked; apply();
  });
  function startTime(element) {
    let start=0;
    for (let node=element;node && node !== document.body;node=node.parentElement) start+=Number(node.dataset?.start)||0;
    return start;
  }
  function syncMedia() {
    if (timeline?.time) {
      const time=timeline.time();
      for (const media of document.querySelectorAll('video,audio')) {
        const start=startTime(media), duration=Number(media.dataset.duration)||media.duration;
        if (!playing || time<start || (Number.isFinite(duration) && time>=start+duration)) { if(!media.paused)media.pause(); continue; }
        if (media.readyState>0 && Math.abs(media.currentTime-(time-start))>.3) media.currentTime=Math.max(0,time-start);
        if (media.paused && !media.dataset.yingyaAutoplayBlocked) media.play().catch(()=>{media.dataset.yingyaAutoplayBlocked='true';});
      }
    }
    requestAnimationFrame(syncMedia);
  }
  addEventListener('resize', fit);
  addEventListener('load', () => { fit(); apply(); requestAnimationFrame(syncMedia); });
})();
