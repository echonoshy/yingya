// A single absolute-time contract for reusable DOM, React and WebGL scenes.
// HyperFrames and Yingya's preview both emit hf-seek; no animation clock here.
(function (global) {
  'use strict';
  if (global.YingyaComponents) return;
  const factories = new Map();
  const instances = new Set();
  const mounted = new WeakMap();
  let currentTime = 0;
  function seconds(value) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError('Video time must be finite nonnegative seconds');
    return value;
  }
  function register(instance) {
    if (!instance || typeof instance.renderAt !== 'function' || typeof instance.dispose !== 'function') {
      throw new TypeError('A component needs renderAt(globalSeconds) and dispose()');
    }
    for (const record of instances) if (record.instance === instance) return record.handle;
    const record = { instance, loaded: !instance.ready, disposed: false, error: null, ready: null, time: currentTime };
    const draw = time => {
      seconds(time);
      if (record.disposed) return;
      record.time = time;
      if (record.error) throw record.error;
      if (!record.loaded) return record.ready;
      try {
        const pending = instance.renderAt(time);
        if (pending && typeof pending.then === 'function') {
          return Promise.resolve(pending).catch(error => { record.error = error; throw error; });
        }
      } catch (error) { record.error = error; throw error; }
    };
    record.handle = Object.freeze({
      ready: record.ready,
      startSeconds: instance.startSeconds || 0,
      durationSeconds: instance.durationSeconds,
      renderAt: draw,
      dispose() {
        if (record.disposed) return;
        record.disposed = true;
        instances.delete(record);
        instance.dispose();
      },
    });
    instances.add(record);
    try {
      record.ready = instance.ready ? Promise.resolve(instance.ready).then(() => {
        if (record.disposed) return;
        record.loaded = true;
        return draw(record.time);
      }).catch(error => { record.error = error; throw error; }) : Promise.resolve(draw(currentTime));
    } catch (error) {
      record.handle.dispose();
      throw error;
    }
    // Keep failures observable to capture without an unhandled rejection while
    // the engine starts. Every seek also waits for its own frame commit.
    record.ready.catch(() => {});
    // ready is assigned after first-frame validation, before returning a handle.
    record.handle = Object.freeze({ ...record.handle, ready: record.ready });
    return record.handle;
  }
  function renderAt(time) {
    currentTime = seconds(time);
    const pending = [];
    for (const record of instances) {
      try { pending.push(record.handle.renderAt(time)); }
      catch (error) { pending.push(Promise.reject(error)); }
    }
    return Promise.all(pending);
  }
  function define(id, factory) {
    if (typeof id !== 'string' || !id || typeof factory !== 'function') throw new TypeError('Expected component id and factory');
    if (factories.has(id) && factories.get(id) !== factory) throw new Error(`Component already defined: ${id}`);
    factories.set(id, factory);
  }
  function createScene(container, config) {
    const factory = factories.get(config?.component);
    if (!factory) throw new Error(`Load the installed component script first: ${config?.component}`);
    if (mounted.has(container)) throw new Error('Container already has a component; dispose it before mounting again');
    const raw = factory(container, config);
    const handle = register(raw);
    const managed = Object.freeze({ ...handle, dispose() { handle.dispose(); mounted.delete(container); } });
    mounted.set(container, managed);
    return managed;
  }
  global.addEventListener('hf-seek', event => {
    try {
      const pending = renderAt(event.detail.time);
      if (typeof event.detail.waitUntil === 'function') event.detail.waitUntil(pending);
      else pending.catch(error => { global.dispatchEvent(new CustomEvent('yingya-component-error', { detail: { message: error.message } })); });
    } catch (error) {
      if (typeof event.detail?.waitUntil === 'function') event.detail.waitUntil(Promise.reject(error));
      else global.dispatchEvent(new CustomEvent('yingya-component-error', { detail: { message: error.message } }));
    }
  });
  global.YingyaComponents = Object.freeze({
    version: '1.0.0', define, register, createScene, renderAt,
    get size() { return instances.size; },
    get durationSeconds() { return Math.max(0, ...[...instances].map(({ handle }) => handle.startSeconds + (handle.durationSeconds || 0))); },
  });
})(window);
