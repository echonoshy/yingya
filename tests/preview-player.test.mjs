import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const player = await readFile(new URL('../web/preview-player.js', import.meta.url), 'utf8');

function harness(inputs) {
  const listeners = new Map(), frames = [], positions = [], seeks = [];
  let now = 0, time = 0;
  const body = { style: {} };
  const root = { dataset: { compositionId: 'test', width: '320', height: '180' }, parentElement: body };
  const media = inputs.map(input => {
    let currentTime = input.currentTime ?? 0;
    return { dataset: input.dataset ?? {}, duration: input.duration ?? 80, readyState: input.readyState ?? 4,
      parentElement: input.parentStart ? { dataset: { start: String(input.parentStart) }, parentElement: root } : root,
      paused: true, seekCount: 0, plays: 0, pauses: 0,
      get currentTime() { return currentTime; }, set currentTime(value) { currentTime = value; this.seekCount++; },
      pause() { this.paused = true; this.pauses++; },
      play() { this.plays++; if (input.play) return input.play.call(this); this.paused = false; return Promise.resolve(); },
    };
  });
  const parent = { postMessage(value) { positions.push(value); } };
  const timeline = { duration: () => 20, time: () => time, repeat() {}, play() {}, pause() {}, seek(value, suppressEvents) { time = value; seeks.push([value, suppressEvents]); } };
  const document = { body, documentElement: { style: {} }, querySelector: () => root, querySelectorAll: () => media };
  vm.runInNewContext(player, { document, window: { __timelines: { test: timeline } }, parent, innerWidth: 640, innerHeight: 360,
    performance: { now: () => now }, addEventListener: (name, callback) => listeners.set(name, callback), requestAnimationFrame: callback => frames.push(callback) });
  listeners.get('load')();
  return { media, seeks, positions,
    message(playing, at) { listeners.get('message')({ source: parent, data: { type: 'yingya-preview-playback', playing, ...(at === undefined ? {} : { time: at }) } }); },
    tick(at = time, elapsed = 16) { time = at; now += elapsed; frames.shift()(); },
  };
}

test('trimmed clips start at 13s / 53s, with accumulated timeline starts', async () => {
  const h = harness([{ dataset: { start: '0', duration: '8', mediaStart: '13' } },
    { parentStart: 5, dataset: { start: '3', duration: '12', mediaStart: '53' } }]);
  h.tick(0);
  assert.equal(h.media[0].currentTime, 13);
  assert.equal(h.media[1].currentTime, 53);
  assert.equal(h.media[1].plays, 0);
  await Promise.resolve();
  h.message(true, 8); h.tick();
  assert.equal(h.media[1].currentTime, 53);
  assert.equal(h.media[1].plays, 1);
  assert.equal(h.media[0].paused, true);
  assert.ok(h.media[0].currentTime < 21);
  assert.deepEqual(h.seeks.at(-1), [8, false], 'seeking must update scene/camera callbacks');
});

test('paused scrubbing seeks media without playing or repeatedly seeking a stationary frame', () => {
  const h = harness([{ dataset: { duration: '8', mediaStart: '13' } }]);
  h.message(false, 5); h.tick();
  assert.equal(h.media[0].currentTime, 18);
  assert.equal(h.media[0].plays, 0);
  const seeks = h.media[0].seekCount;
  for (let i = 0; i < 30; i++) h.tick();
  assert.equal(h.media[0].seekCount, seeks);
  assert.equal(h.media[0].paused, true);
  assert.ok(h.positions.length >= 1, '250ms position reporting remains active while paused');
});

test('late metadata applies the latest paused source position', () => {
  const h = harness([{ readyState: 0, dataset: { start: '8', duration: '12', mediaStart: '53' } }]);
  h.message(false, 9); h.tick();
  assert.equal(h.media[0].seekCount, 0);
  h.message(false, 11); h.tick();
  h.media[0].readyState = 1; h.tick();
  assert.equal(h.media[0].currentTime, 56);
  assert.equal(h.media[0].plays, 0);
});

test('source duration bounds playback and a zero-length clip never plays', () => {
  const h = harness([{ duration: 55, dataset: { start: '8', duration: '12', mediaStart: '53' } },
    { dataset: { duration: '0', mediaStart: '13' } }]);
  h.tick(9);
  assert.equal(h.media[0].currentTime, 54);
  assert.equal(h.media[1].plays, 0);
  h.tick(10);
  assert.equal(h.media[0].paused, true);
  assert.ok(h.media[0].currentTime < 55 && h.media[0].currentTime >= 54.9);
});

test('HyperFrames playback-start alias takes precedence, and normal playback avoids constant correction', () => {
  const h = harness([{ dataset: { duration: '12', mediaStart: '13', playbackStart: '53' } }]);
  h.tick(0);
  assert.equal(h.media[0].currentTime, 53);
  const seeks = h.media[0].seekCount;
  h.tick(.1); h.tick(.2);
  assert.equal(h.media[0].seekCount, seeks);
});

test('pending play is not issued every frame and intentional AbortError does not block future playback', async () => {
  let reject;
  const h = harness([{ dataset: { duration: '12', mediaStart: '53' }, play() { return new Promise((_, fail) => { reject = fail; }); } }]);
  h.tick(); h.tick(); h.tick();
  assert.equal(h.media[0].plays, 1);
  reject({ name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.media[0].dataset.yingyaAutoplayBlocked, undefined);
  h.tick();
  assert.equal(h.media[0].plays, 2);
});
