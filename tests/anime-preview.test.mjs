import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { chromium } from 'playwright';

const player = await readFile(new URL('../web/preview-player.js', import.meta.url), 'utf8');

function animation() {
  return { duration: 4000, paused: false, seeks: [], pause() { this.paused = true; }, seek(ms) { this.seeks.push(ms); this.currentTime = ms; } };
}

function gsapTimeline(authoredDuration = 4) {
  let time = 0, delay = 0;
  return {
    paused: true, seeks: [], callbacks: 0,
    duration() { return authoredDuration; },
    repeatDelay(value) { if (value !== undefined) delay = value; return delay; },
    repeat(value) { this.repeats = value; },
    time() { const cycle = authoredDuration + delay; return Math.min(time > cycle ? time % cycle || cycle : time, authoredDuration); },
    totalTime() { return time; },
    seek(value, suppressEvents) { time = value; this.seeks.push([value, suppressEvents]); if (!suppressEvents) this.callbacks++; },
    advance(value) { if (!this.paused) time += value; },
    play() { this.paused = false; },
    pause() { this.paused = true; },
  };
}

function harness({ timeline, instances = [], duration = 6, media = [] } = {}) {
  let now = 0;
  const listeners = new Map(), frames = [], positions = [];
  const root = { dataset: { compositionId: 'film', width: '400', height: '600', duration: String(duration) } };
  const parent = { postMessage(message) { positions.push(message); } };
  const window = { __timelines: timeline ? { film: timeline } : {}, __hfAnime: instances };
  const document = {
    querySelector() { return root; }, querySelectorAll() { return media; },
    documentElement: { style: {} }, body: { style: {} },
  };
  const context = { window, document, parent, innerWidth: 400, innerHeight: 600,
    performance: { now: () => now }, requestAnimationFrame: callback => frames.push(callback),
    addEventListener: (event, callback) => listeners.set(event, callback),
  };
  vm.runInNewContext(player, context);
  listeners.get('load')();
  return {
    window, positions, root,
    frame(ms = 16) { now += ms; for (const callback of frames.splice(0)) callback(); },
    message(playing, time, source = parent) { listeners.get('message')({ source, data: { type: 'yingya-preview-playback', playing, time } }); },
  };
}

test('mixed preview follows only GSAP and scrubs both engines with callbacks enabled', () => {
  const timeline = gsapTimeline(), anime = animation();
  const preview = harness({ timeline, instances: [anime], duration: 4 });
  preview.message(false, 3);
  assert.deepEqual(timeline.seeks.at(-1), [3, false]);
  assert.equal(anime.currentTime, 3000);
  preview.message(false, .75);
  assert.equal(anime.currentTime, 750);
  assert.equal(timeline.callbacks, 2);
  preview.frame(2000);
  assert.equal(anime.currentTime, 750);
  assert.equal(anime.paused, true);
  preview.message(true);
  preview.frame(3000);
  assert.equal(anime.currentTime, 750, 'wall time cannot advance Anime independently of GSAP');
  timeline.advance(.5);
  preview.frame();
  assert.equal(anime.currentTime, 1250);
  assert.equal(anime.paused, true);
});

test('declared duration holds GSAP final frame, advances Anime through tail, and resets on loop', () => {
  const timeline = gsapTimeline(4), anime = animation();
  const preview = harness({ timeline, instances: [anime], duration: 6 });
  assert.equal(timeline.duration(), 4, 'authored tweens must keep their original speed');
  assert.equal(timeline.repeatDelay(), 2);
  preview.message(false, 5.5);
  assert.equal(timeline.time(), 4);
  assert.equal(anime.currentTime, 5500);
  preview.frame(300);
  assert.equal(preview.positions.at(-1).time, 5.5);
  preview.message(true);
  timeline.advance(.75);
  preview.frame();
  assert.equal(anime.currentTime, 250);
  preview.message(false, 99);
  assert.equal(anime.currentTime, 6000);
  preview.message(false, 1);
  assert.equal(anime.currentTime, 1000);
});

test('late Anime registrations and replacement registries immediately join a paused playhead', () => {
  const timeline = gsapTimeline();
  const preview = harness({ timeline });
  preview.message(false, 2);
  const first = animation();
  preview.window.__hfAnime.push(first);
  preview.frame();
  assert.equal(first.currentTime, 2000);
  assert.equal(first.paused, true);
  const replacement = animation();
  preview.window.__hfAnime = [replacement];
  preview.frame();
  assert.equal(replacement.currentTime, 2000);
  assert.equal(replacement.paused, true);
});

test('a shorter declared composition clips scrubs and loops without retiming authored GSAP motion', () => {
  const timeline = gsapTimeline(8), anime = animation();
  const preview = harness({ timeline, instances: [anime], duration: 3 });
  preview.message(false, 5);
  assert.equal(timeline.time(), 3);
  assert.equal(anime.currentTime, 3000);
  assert.equal(timeline.duration(), 8);
  preview.message(true, 2.5);
  timeline.advance(.75);
  preview.frame();
  assert.equal(timeline.time(), .25);
  assert.equal(anime.currentTime, 250);
  assert.equal(timeline.seeks.at(-1)[1], false);
});

test('invalid or zero root duration falls back to the authored GSAP duration', () => {
  for (const duration of [0, -1, 'NaN']) {
    const timeline = gsapTimeline(4), anime = animation();
    const preview = harness({ timeline, instances: [anime], duration });
    preview.message(false, 9);
    assert.equal(timeline.time(), 4);
    assert.equal(anime.currentTime, 4000);
    assert.equal(timeline.repeatDelay(), 0);
  }
});

test('pending playback survives late engine registration and timeline replacement', () => {
  const preview = harness();
  preview.message(false, 3);
  preview.frame(1000);
  const timeline = gsapTimeline(), anime = animation();
  preview.window.__timelines.film = timeline;
  preview.window.__hfAnime.push(anime);
  preview.frame();
  assert.equal(timeline.time(), 3);
  assert.equal(timeline.paused, true);
  assert.equal(anime.currentTime, 3000);
  const replacement = gsapTimeline();
  preview.window.__timelines.film = replacement;
  preview.frame();
  assert.equal(replacement.time(), 3);
  assert.equal(replacement.paused, true);
});

test('Anime-only previews support pause, backward seek, declared-duration loops and late GSAP adoption', () => {
  const anime = animation(), preview = harness({ instances: [anime], duration: 6 });
  preview.frame(5000);
  assert.equal(anime.currentTime, 5000);
  preview.message(false);
  preview.frame(3000);
  assert.equal(anime.currentTime, 5000);
  preview.message(true);
  preview.frame(1250);
  assert.equal(anime.currentTime, 250);
  preview.message(false, 1.5);
  assert.equal(anime.currentTime, 1500);
  const timeline = gsapTimeline();
  preview.window.__timelines.film = timeline;
  preview.frame();
  assert.equal(timeline.time(), 1.5);
  assert.equal(timeline.paused, true);
});

test('Anime-only previews infer finite duration when the root omits it', () => {
  const anime = animation(), preview = harness({ instances: [anime], duration: 0 });
  preview.frame(4250);
  assert.equal(anime.currentTime, 250);
  preview.message(false, 99);
  assert.equal(anime.currentTime, 4000);
});

test('playback messages require the parent and preserve media pause and interval synchronization', () => {
  const timeline = gsapTimeline();
  const media = { dataset: { start: '1', duration: '2' }, paused: true, readyState: 1, currentTime: 0,
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  const preview = harness({ timeline, media: [media] });
  preview.message(false, 2, {});
  assert.equal(timeline.paused, false);
  assert.equal(timeline.time(), 0);
  timeline.advance(1.5);
  preview.frame();
  assert.equal(media.currentTime, .5);
  assert.equal(media.paused, false);
  preview.message(false);
  assert.equal(media.paused, true);
  preview.message(true, 3.5);
  preview.frame();
  assert.equal(media.paused, true);
  preview.message(false, -5);
  assert.equal(timeline.time(), 0);
});

test('real Anime.js and GSAP render deterministic text through seek, hold, pause and repeat at scaled speed', async t => {
  // Browser plugin not available. Reuse the installed Playwright browser without a service.
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const [gsap, anime] = await Promise.all([
    readFile(new URL('../runtime/editorial/vendor/gsap-3.14.2.min.js', import.meta.url), 'utf8'),
    readFile(new URL('../runtime/animejs/anime.umd.min.js', import.meta.url), 'utf8'),
  ]);
  await page.clock.install();
  await page.route('https://anime-preview.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><title>映芽动画预览测试</title></head><body>
    <main data-composition-id="film" data-duration="6" data-width="400" data-height="600"><h1>同步动画</h1><output id="gsap"></output><output id="anime"></output></main>
    <script>${gsap}</script><script>${anime}</script><script>
    window.gsapValue = {value:0}; window.animeValue = {value:0};
    window.mainTimeline = gsap.timeline({paused:true}).to(gsapValue, {value:40, duration:4, ease:'none', onUpdate() {document.querySelector('#gsap').textContent = gsapValue.value.toFixed(2);}});
    window.animeTimeline = anime.animate(animeValue, {value:[0,60], duration:6000, ease:'linear', autoplay:false, onUpdate() {document.querySelector('#anime').textContent = animeValue.value.toFixed(2);}});
    window.__timelines = {film:mainTimeline}; window.__hfAnime = [animeTimeline];
    window.control = (playing, time) => dispatchEvent(new MessageEvent('message', {source:window, data:{type:'yingya-preview-playback', playing, time}}));
    </script><script>${player}</script></body></html>` }));
  await page.goto('https://anime-preview.test/');
  assert.equal(await page.title(), '映芽动画预览测试');
  assert.equal(await page.locator('h1').textContent(), '同步动画');
  await page.evaluate(() => control(false, 5.5));
  assert.equal(await page.locator('#gsap').textContent(), '40.00');
  assert.equal(await page.locator('#anime').textContent(), '55.00');
  await page.evaluate(() => control(false, 1));
  const initial = await page.locator('main').textContent();
  assert.equal(await page.locator('#gsap').textContent(), '10.00');
  assert.equal(await page.locator('#anime').textContent(), '10.00');
  await page.evaluate(() => control(false, 4));
  await page.evaluate(() => control(false, 1));
  assert.equal(await page.locator('main').textContent(), initial);
  await page.clock.runFor(500);
  assert.equal(await page.locator('main').textContent(), initial);
  await page.evaluate(() => { mainTimeline.timeScale(2); control(true, 5.5); });
  await page.clock.runFor(500);
  const state = await page.evaluate(() => ({ anime: animeValue.value, gsap: gsapValue.value, paused: animeTimeline.paused, time: mainTimeline.time(), duration: mainTimeline.duration() }));
  assert.ok(state.time > .3 && state.time < .8, JSON.stringify(state));
  assert.ok(Math.abs(state.anime - state.gsap) < .5, JSON.stringify(state));
  assert.equal(state.paused, true);
  assert.equal(state.duration, 4);
  await page.evaluate(() => { control(false, 2); window.lateValue = {value:0}; __hfAnime.push(anime.animate(lateValue, {value:[0,60], duration:6000, ease:'linear', autoplay:false})); });
  await page.clock.runFor(32);
  assert.equal(await page.evaluate(() => lateValue.value), 20);
  await page.evaluate(() => { document.querySelector('main').dataset.duration = '3'; control(false, 5); });
  assert.equal(await page.locator('#gsap').textContent(), '30.00');
  assert.equal(await page.locator('#anime').textContent(), '30.00');
  await page.evaluate(() => control(true, 2.5));
  await page.clock.runFor(500);
  const clipped = await page.evaluate(() => ({ time: mainTimeline.time(), anime: animeValue.value, gsap: gsapValue.value }));
  assert.ok(clipped.time > .3 && clipped.time < .8, JSON.stringify(clipped));
  assert.ok(Math.abs(clipped.anime - clipped.gsap) < .5, JSON.stringify(clipped));
  assert.deepEqual(errors, []);
});

test('real reusable scenes render future children identically on fresh arbitrary seeks and backward replay', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const [anime, scenes, css] = await Promise.all([
    readFile(new URL('../runtime/animejs/anime.umd.min.js', import.meta.url), 'utf8'),
    readFile(new URL('../runtime/animejs/scenes.js', import.meta.url), 'utf8'),
    readFile(new URL('../runtime/animejs/scenes.css', import.meta.url), 'utf8'),
  ]);
  for (const [width, height] of [[1280, 720], [720, 1280]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://anime-scenes.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><style>${css}
      html,body {margin:0;} main {position:relative;width:${width}px;height:${height}px;} section {position:absolute;inset:0;}
      </style></head><body><main><section id="title"></section><section id="flow"></section><section id="numbers"></section></main>
      <script>${anime}</script><script>${scenes}</script><script>
      YingyaAnime.createScene(document.querySelector('#title'), {component:'title-reveal',startSeconds:0,durationSeconds:5,title:'让想法，流动起来',subtitle:'把内容变成故事'});
      YingyaAnime.createScene(document.querySelector('#flow'), {component:'flow-path',startSeconds:5,durationSeconds:5,title:'每一步都清晰',nodes:[{label:'内容'},{label:'分析'},{label:'成片'}]});
      YingyaAnime.createScene(document.querySelector('#numbers'), {component:'number-compare',startSeconds:10,durationSeconds:5,title:'让变化一眼可见',metrics:[{label:'起点',value:12},{label:'结果',value:48}],footnote:'示例数据'});
      </script></body></html>` }));
    async function stateAt(time) {
      return page.evaluate(time => {
        window.__hfAnime.forEach(timeline => { timeline.pause(); timeline.seek(time * 1000); });
        return [...document.querySelectorAll('.yga-title,.yga-char,.yga-accent,.yga-subtitle,.yga-node-marker,.yga-node-copy,.yga-flow-line,.yga-flow-dot,.yga-metric,.yga-value,.yga-footnote')].map(element => {
          const style = getComputedStyle(element);
          return { text: element.textContent, opacity: style.opacity, transform: style.transform, dash: style.strokeDasharray, dashOffset: style.strokeDashoffset };
        });
      }, time);
    }
    const baseline = new Map();
    for (const time of [0, 1, 3, 6, 8, 11, 13, 14.3]) {
      await page.goto('https://anime-scenes.test/');
      baseline.set(time, await stateAt(time));
    }
    for (const time of [13, 3, 8, 1, 11, 6, 14.3, 0, 13]) {
      assert.deepEqual(await stateAt(time), baseline.get(time), `${width}×${height} at ${time}s must not depend on previous seeks`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
});
