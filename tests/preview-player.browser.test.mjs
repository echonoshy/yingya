import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

// Independent playback regression: actual H.264 frames in the same opaque
// sandbox as product previews. No gateway, project data, or external network.
test('preview decodes source 13/53, scrubs while paused, and retries late metadata', { timeout: 60000 }, async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'yingya-preview-player-'));
  let browser, server;
  try {
    const mediaPath = path.join(scratch, 'source.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90:r=10:d=80',
      '-vf', "drawbox=color=green:t=fill:enable='gte(t,13)*lt(t,17)',drawbox=color=magenta:t=fill:enable='gte(t,17)*lt(t,21)',drawbox=color=yellow:t=fill:enable='gte(t,21)*lt(t,53)',drawbox=color=blue:t=fill:enable='gte(t,53)*lt(t,55)',drawbox=color=cyan:t=fill:enable='gte(t,55)'",
      '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaPath], { timeout: 20000 });
    const [video, player, gsap] = await Promise.all([
      readFile(mediaPath), readFile(new URL('../web/preview-player.js', import.meta.url)),
      readFile(new URL('../runtime/editorial/vendor/gsap-3.14.2.min.js', import.meta.url)),
    ]);
    const composition = `<!doctype html><title>Trimmed preview regression</title><style>
      body{margin:0;background:white}main{position:relative;width:320px;height:180px}section{position:absolute;inset:0}video{width:100%;height:100%}
      </style><main data-composition-id="main" data-width="320" data-height="180" data-duration="20">
      <section id="first"><video id="a" crossorigin="anonymous" src="/source.mp4" muted preload="auto" data-start="0" data-duration="8" data-media-start="13"></video></section>
      <section id="second"><video id="b" crossorigin="anonymous" src="/source.mp4" muted preload="auto" data-start="8" data-duration="12" data-media-start="53"></video></section></main>
      <script src="/gsap.js"></script><script>
      const clock={time:0}, tl=gsap.timeline({paused:true});
      function display(){ document.querySelector('#first').style.visibility=clock.time<8?'visible':'hidden'; document.querySelector('#second').style.visibility=clock.time>=8?'visible':'hidden'; }
      tl.to(clock,{time:20,duration:20,ease:'none',onUpdate:display},0); display(); window.__timelines={main:tl};
      </script><script src="/preview-player.js"></script>`;
    server = createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      const resources = {
        '/': ['text/html', '<!doctype html><title>Preview test host</title><iframe title="Preview" sandbox="allow-scripts" src="/composition" style="border:0;width:640px;height:360px"></iframe>'],
        '/composition': ['text/html', composition], '/gsap.js': ['application/javascript', gsap],
        '/preview-player.js': ['application/javascript', player], '/source.mp4': ['video/mp4', video],
      };
      const found = resources[request.url];
      if (!found) { response.writeHead(404); response.end(); return; }
      if (request.url === '/source.mp4') {
        response.setHeader('Accept-Ranges', 'bytes');
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
        if (range) {
          const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
          response.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${video.length}`, 'Content-Length': end - start + 1 });
          response.end(video.subarray(start, end + 1)); return;
        }
      }
      response.setHeader('Content-Type', found[0]); response.end(found[1]);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.HYPERFRAMES_BROWSER_PATH ? { executablePath: process.env.HYPERFRAMES_BROWSER_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    assert.equal(await page.title(), 'Preview test host');
    const frame = page.frames().find(candidate => candidate.url() === `${origin}/composition`);
    assert.ok(frame);
    const seek = async (time, playing = false) => page.evaluate(({ time, playing }) => document.querySelector('iframe').contentWindow.postMessage({ type: 'yingya-preview-playback', playing, time }, '*'), { time, playing });
    const decoded = async (id, time, rgb) => {
      await frame.waitForFunction(({ id, time, rgb }) => {
        const media = document.getElementById(id);
        if (media.readyState < 2 || media.seeking || Math.abs(media.currentTime - time) > .05) return false;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d'); context.drawImage(media, 0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).every((value, index) => Math.abs(value - rgb[index]) < 25);
      }, { id, time, rgb }, { timeout: 10000 }).catch(async error => {
        console.error(errors, await frame.locator(`#${id}`).evaluate(media => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d'); context.drawImage(media, 0, 0, 1, 1);
          return { time: media.currentTime, duration: media.duration, readyState: media.readyState, seeking: media.seeking, error: media.error?.message, pixel: Array.from(context.getImageData(0, 0, 1, 1).data), timeline: window.__timelines.main.time() };
        }));
        throw error;
      });
      assert.equal(await frame.locator(`#${id}`).evaluate(media => media.paused), true);
    };
    await seek(0); await decoded('a', 13, [0, 128, 0]);
    await page.screenshot({ path: path.join(scratch, 'source-13-desktop.png') });
    await seek(5); await decoded('a', 18, [255, 0, 255]);
    await seek(8); await decoded('b', 53, [0, 0, 255]);
    assert.equal(await frame.locator('#second').evaluate(node => getComputedStyle(node).visibility), 'visible');
    assert.equal(await frame.locator('#first').evaluate(node => getComputedStyle(node).visibility), 'hidden');
    assert.ok(await frame.locator('#a').evaluate(media => media.paused && media.currentTime < 21 && media.currentTime > 20.9));
    await page.screenshot({ path: path.join(scratch, 'source-53-desktop.png') });
    await seek(10); await decoded('b', 55, [0, 255, 255]);
    await seek(8, true);
    await frame.waitForFunction(() => { const media = document.getElementById('b'); return !media.paused && media.currentTime > 53.1 && media.currentTime < 54; });
    await seek(8); await decoded('b', 53, [0, 0, 255]);

    let releaseMetadata;
    const metadataGate = new Promise(resolve => { releaseMetadata = resolve; });
    await page.route('**/late.mp4', async route => {
      await metadataGate;
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
      await route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', headers: {
        'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${video.length}` } : {}),
      }, body: video.subarray(start, end + 1) });
    });
    await frame.locator('#b').evaluate(media => { media.src = '/late.mp4'; media.load(); });
    await frame.waitForFunction(() => document.getElementById('b').readyState === 0);
    await seek(9); await seek(11); releaseMetadata();
    await decoded('b', 56, [0, 255, 255]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('iframe').evaluate(node => { node.style.width = '374px'; node.style.height = '210px'; });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seek(8); await decoded('b', 53, [0, 0, 255]);
    await page.screenshot({ path: path.join(scratch, 'source-53-mobile.png') });
    assert.deepEqual(errors, []);
    console.log(`Preview browser screenshots: ${scratch}`);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    // Keep screenshots for visual review; the generated fixture is disposable.
    await rm(path.join(scratch, 'source.mp4'), { force: true });
  }
});
