// Loaded only in the opaque-origin, read-only composition frame.
(() => {
  let playing = true;
  let timeline;
  let heldTimeline;
  let pendingTime;
  const pendingPlay = new WeakSet();
  let fallbackTime = 0;
  let lastTick = performance.now();
  let lastReported = performance.now();
  const rootElement = () => document.querySelector('[data-composition-id]');
  const animeInstances = () => Array.isArray(window.__hfAnime) ? window.__hfAnime : [];
  const hasComponents = () => (window.YingyaComponents?.size || 0) > 0;
  const findTimeline = () => window.__timelines?.[rootElement()?.dataset.compositionId] || Object.values(window.__timelines || {})[0];
  function duration() {
    const declared = Number(rootElement()?.dataset.duration);
    if (Number.isFinite(declared) && declared > 0) return declared;
    if (timeline) return (Number(timeline.duration?.()) || 0) + (timeline === heldTimeline ? Number(timeline.repeatDelay()) || 0 : 0);
    return Math.max(0, window.YingyaComponents?.durationSeconds || 0, ...animeInstances().map(instance => Number.isFinite(instance?.duration) ? instance.duration / 1000 : 0));
  }
  function currentTime() {
    const now = performance.now();
    if (timeline?.time) {
      fallbackTime = timeline.time();
      // repeatDelay holds the authored final frame without stretching its tweens.
      // totalTime keeps advancing through that tail and respects GSAP timeScale.
      if (timeline === heldTimeline) {
        const total = timeline.totalTime(), cycle = Number(timeline.duration()) + Number(timeline.repeatDelay());
        if (cycle > 0) fallbackTime = total > cycle ? total % cycle || cycle : total;
      }
      // Export ends at the declared composition duration, even when authored
      // tweens extend beyond it. Loop that same interval without retiming them.
      const end = duration();
      if (end > 0 && playing && fallbackTime >= end) {
        fallbackTime %= end;
        timeline.seek?.(fallbackTime, false);
      }
    } else if (playing && (animeInstances().length || hasComponents())) {
      fallbackTime += Math.max(0, now - lastTick) / 1000;
      const cycle = duration();
      if (cycle > 0 && fallbackTime > cycle) fallbackTime %= cycle;
    }
    lastTick = now;
    return fallbackTime;
  }
  function syncAnime(time) {
    // Anime never runs a second clock. Re-read the registry so late instances
    // and replacements immediately join the current frame, including on pause.
    for (const instance of animeInstances()) {
      instance?.pause?.();
      instance?.seek?.(time * 1000);
    }
  }
  function syncComponents(time) {
    if (!window.YingyaComponents) return;
    // Same resource-aware seek event used by the offline HyperFrames renderer.
    // Preserve the pending promise for paused frame capture and diagnostics.
    const pending = [];
    window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time, waitUntil: promise => pending.push(Promise.resolve(promise)) } }));
    window.__yingyaPreviewReady = Promise.all(pending);
    window.__yingyaPreviewReady.catch(error => {
      window.__yingyaComponentError = error.message;
      parent.postMessage({ type: 'yingya-preview-error', message: error.message }, '*');
    });
  }
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
    const next = findTimeline();
    if (next !== timeline) {
      timeline?.pause?.();
      timeline = next;
      heldTimeline = undefined;
      if (pendingTime === undefined && fallbackTime > 0) pendingTime = fallbackTime;
    }
    if (timeline) {
      const declared = Number(rootElement()?.dataset.duration), authored = Number(timeline.duration?.());
      if (Number.isFinite(declared) && declared > authored && timeline.repeatDelay && timeline.totalTime) {
        timeline.repeatDelay(Math.max(Number(timeline.repeatDelay()) || 0, declared - authored));
        heldTimeline = timeline;
      }
      timeline.repeat?.(-1);
    }
    if (pendingTime !== undefined) {
      const end = duration();
      fallbackTime = end > 0 ? Math.min(pendingTime, end) : pendingTime;
      // GSAP suppresses callbacks by default; composition onUpdate handlers
      // must render when the user scrubs both forwards and backwards.
      timeline?.seek?.(fallbackTime, false);
      if (timeline || animeInstances().length || hasComponents()) pendingTime = undefined;
    }
    if (timeline) playing ? timeline.play?.() : timeline.pause?.();
    lastTick = performance.now();
    const time = currentTime();
    syncAnime(time);
    syncComponents(time);
    if (!playing) for (const media of document.querySelectorAll('video,audio')) media.pause();
  }
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'yingya-preview-playback' || typeof event.data.playing !== 'boolean') return;
    currentTime();
    if (Number.isFinite(event.data.time)) pendingTime = Math.max(0, event.data.time);
    playing = event.data.playing; for(const media of document.querySelectorAll('video,audio'))delete media.dataset.yingyaAutoplayBlocked; apply();
  });
  function startTime(element) {
    let start=0;
    for (let node=element;node && node !== document.body;node=node.parentElement) start+=Number(node.dataset?.start)||0;
    return start;
  }
  function syncMedia() {
    if (findTimeline() !== timeline || pendingTime !== undefined) apply();
    const time = currentTime();
    syncAnime(time);
    syncComponents(time);
    if (timeline?.time || animeInstances().length || hasComponents()) {
      if (performance.now() - lastReported >= 250) {
        parent.postMessage({ type: 'yingya-preview-position', time }, '*');
        lastReported = performance.now();
      }
      for (const media of document.querySelectorAll('video,audio')) {
        const start=startTime(media);
        // Match HyperFrames: data-playback-start supersedes its legacy alias.
        const offset=Number(media.dataset.playbackStart ?? media.dataset.mediaStart);
        const mediaStart=Number.isFinite(offset) ? Math.max(0,offset) : 0;
        const authoredDuration=Number(media.dataset.duration);
        const available=Number.isFinite(media.duration) ? Math.max(0,media.duration-mediaStart) : Infinity;
        const duration=Math.min(Number.isFinite(authoredDuration) && authoredDuration>=0 ? authoredDuration : Infinity,available);
        const active=time>=start && time<start+duration;
        if ((!playing || !active) && !media.paused) media.pause();
        // Paused scrubbing still decodes the requested source frame. Preposition
        // upcoming clips too, so their first visible frame never comes from 0s.
        // Stay just inside the exclusive source-out boundary when holding a cut.
        const local=Math.max(0,Math.min(time-start,Math.max(0,duration-.001)));
        const sourceLimit=Number.isFinite(media.duration) ? Math.max(0,media.duration-.001) : Infinity;
        const target=Math.min(sourceLimit,mediaStart+local);
        const tolerance=playing && active && !media.paused ? .3 : .015;
        if (media.readyState>0 && Number.isFinite(target) && Math.abs(media.currentTime-target)>tolerance) {
          try { media.currentTime=target; } catch { /* Metadata may still be arriving; retry next frame. */ }
        }
        if (playing && active && media.readyState>0 && media.paused && !pendingPlay.has(media) && !media.dataset.yingyaAutoplayBlocked) {
          pendingPlay.add(media);
          Promise.resolve(media.play()).catch(error=>{
            if (playing && error?.name!=='AbortError') media.dataset.yingyaAutoplayBlocked='true';
          }).finally(()=>pendingPlay.delete(media));
        }
      }
    }
    requestAnimationFrame(syncMedia);
  }
  addEventListener('resize', fit);
  addEventListener('load', () => { fit(); apply(); requestAnimationFrame(syncMedia); });
})();
