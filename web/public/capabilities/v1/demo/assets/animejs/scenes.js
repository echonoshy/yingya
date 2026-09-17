/* Yingya reusable motion scenes. Anime.js 4.5.0 is vendored separately. */
(function (global) {
  'use strict';

  const mounted = new WeakMap();
  const kinds = ['title-reveal', 'flow-path', 'number-compare'];
  const SVG = 'http://www.w3.org/2000/svg';

  function text(value, name, limit, optional = false) {
    if (optional && value === undefined) return '';
    if (typeof value !== 'string' || (!optional && !value.trim()) || [...value].length > limit) {
      throw new TypeError(`${name} must be ${optional ? 'a' : 'a non-empty'} string of at most ${limit} characters`);
    }
    return value;
  }

  function finite(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new TypeError(`${name} must be a finite number from ${min} to ${max}`);
    }
    return value;
  }

  function validateConfig(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('scene config is required');
    if (!kinds.includes(input.component)) throw new TypeError(`component must be one of: ${kinds.join(', ')}`);
    const config = {
      component: input.component,
      startSeconds: finite(input.startSeconds, 'startSeconds', 0, 86400),
      durationSeconds: finite(input.durationSeconds, 'durationSeconds', 2, 120),
      title: text(input.title, 'title', input.component === 'title-reveal' ? 44 : 28),
      eyebrow: text(input.eyebrow, 'eyebrow', 28, true),
    };
    if (input.component === 'title-reveal') {
      config.subtitle = text(input.subtitle, 'subtitle', 100, true);
    } else if (input.component === 'flow-path') {
      if (!Array.isArray(input.nodes) || input.nodes.length < 2 || input.nodes.length > 5) {
        throw new TypeError('nodes must contain 2 to 5 labeled nodes');
      }
      config.nodes = input.nodes.map((node, index) => ({
        label: text(node?.label, `nodes[${index}].label`, 12),
        detail: text(node?.detail, `nodes[${index}].detail`, 32, true),
      }));
    } else {
      if (!Array.isArray(input.metrics) || input.metrics.length !== 2) throw new TypeError('metrics must contain exactly two metrics');
      config.metrics = input.metrics.map((metric, index) => {
        const decimals = finite(metric?.decimals === undefined ? 0 : metric.decimals, `metrics[${index}].decimals`, 0, 2);
        if (!Number.isInteger(decimals)) throw new TypeError('decimals must be an integer');
        return {
          label: text(metric?.label, `metrics[${index}].label`, 20),
          value: finite(metric?.value, `metrics[${index}].value`, -9999999999999, 9999999999999),
          from: finite(metric?.from === undefined ? 0 : metric.from, `metrics[${index}].from`, -9999999999999, 9999999999999),
          unit: text(metric?.unit, `metrics[${index}].unit`, 8, true),
          decimals,
        };
      });
      config.footnote = text(input.footnote, 'footnote', 100, true);
    }
    return config;
  }

  function element(parent, tag, className, content) {
    const node = parent.ownerDocument.createElement(tag);
    node.className = className;
    if (content !== undefined) node.textContent = content;
    parent.appendChild(node);
    return node;
  }

  function svgElement(parent, tag, attributes) {
    const node = parent.ownerDocument.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    parent.appendChild(node);
    return node;
  }

  function header(root, config, tl, at, span) {
    const group = element(root, 'header', 'yga-heading');
    if (config.eyebrow) {
      const eyebrow = element(group, 'p', 'yga-eyebrow', config.eyebrow);
      tl.add(eyebrow, { opacity: [0, 1], x: [-18, 0], duration: span * .19, ease: 'outQuart' }, at);
    }
    const title = element(group, 'h2', 'yga-title', config.title);
    return { group, title };
  }

  function titleReveal(root, config, tl, at, span, anime) {
    const { group, title } = header(root, config, tl, at, span);
    // Split only characters, synchronously. Fixed-canvas capture must retain the
    // exact node references; the pinned splitter's resize watcher is unnecessary.
    const split = anime.splitText(title, { words: false, chars: { class: 'yga-char' }, lines: false });
    split.resizeObserver.disconnect();
    const count = split.chars.length;
    title.style.setProperty('--yga-title-size', `${Math.min(10.6, 230 / Math.max(20, count))}cqw`);
    tl.add(split.chars, {
      y: ['.65em', '0em'], opacity: [0, 1], rotate: [5, 0],
      duration: span * .25,
      delay: anime.stagger(Math.min(42, span * .24 / Math.max(1, count - 1))),
      ease: 'outExpo',
    }, at + span * .05);
    const accent = element(group, 'div', 'yga-accent');
    accent.setAttribute('aria-hidden', 'true');
    tl.add(accent, { scaleX: [0, 1], duration: span * .25, ease: 'outCirc' }, at + span * .20);
    if (config.subtitle) {
      const subtitle = element(root, 'p', 'yga-subtitle', config.subtitle);
      tl.add(subtitle, { y: [22, 0], opacity: [0, 1], duration: span * .23, ease: 'outCubic' }, at + span * .34);
    }
  }

  function flowPath(root, config, tl, at, span, anime) {
    const { title } = header(root, config, tl, at, span);
    tl.add(title, { y: [24, 0], opacity: [0, 1], duration: span * .20, ease: 'outCubic' }, at + span * .03);
    const diagram = element(root, 'div', 'yga-flow');
    const list = element(diagram, 'ol', 'yga-nodes');
    const nodes = config.nodes.map((item, index) => {
      const node = element(list, 'li', 'yga-node');
      const marker = element(node, 'div', 'yga-node-marker', String(index + 1).padStart(2, '0'));
      marker.setAttribute('aria-hidden', 'true');
      const copy = element(node, 'div', 'yga-node-copy');
      element(copy, 'h3', 'yga-node-label', item.label);
      if (item.detail) element(copy, 'p', 'yga-node-detail', item.detail);
      return node;
    });
    // Layout once, then give path geometry to Anime.js. No measurements in a tween.
    const box = diagram.getBoundingClientRect();
    if (!box.width || !box.height) throw new Error('flow-path needs a connected container with a resolved width and height');
    const positions = nodes.map(node => {
      const marker = node.querySelector('.yga-node-marker').getBoundingClientRect();
      return { x: marker.left - box.left + marker.width / 2, y: marker.top - box.top + marker.height / 2 };
    });
    const svg = svgElement(diagram, 'svg', { class: 'yga-flow-svg', viewBox: `0 0 ${box.width} ${box.height}`, 'aria-hidden': 'true' });
    const path = svgElement(svg, 'path', {
      class: 'yga-flow-line',
      d: positions.map((p, index) => `${index ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
      fill: 'none',
    });
    const dot = svgElement(svg, 'circle', { class: 'yga-flow-dot', cx: 0, cy: 0, r: Math.min(box.width, box.height) * .028 });
    const start = at + span * .17;
    const travel = span * .48;
    tl.add(anime.svg.createDrawable(path), { draw: ['0 0', '0 1'], duration: travel, ease: 'linear' }, start);
    const motion = anime.svg.createMotionPath(path);
    tl.add(dot, { translateX: motion.translateX, translateY: motion.translateY, duration: travel, ease: 'linear' }, start);
    tl.add(dot, { opacity: [0, 1], duration: span * .04, ease: 'outQuad' }, start);
    nodes.forEach((node, index) => {
      const marker = node.querySelector('.yga-node-marker');
      const copy = node.querySelector('.yga-node-copy');
      const arrival = start + index * travel / Math.max(1, nodes.length - 1);
      tl.add(marker, { scale: [.65, 1], opacity: [0, 1], duration: span * .12, ease: 'outBack' }, arrival);
      tl.add(copy, { y: [18, 0], opacity: [0, 1], duration: span * .13, ease: 'outQuart' }, arrival + span * .015);
    });
  }

  function numberCompare(root, config, tl, at, span) {
    const { title } = header(root, config, tl, at, span);
    tl.add(title, { y: [24, 0], opacity: [0, 1], duration: span * .20, ease: 'outCubic' }, at + span * .02);
    const grid = element(root, 'div', 'yga-metrics');
    config.metrics.forEach((metric, index) => {
      const card = element(grid, 'section', `yga-metric yga-metric-${index + 1}`);
      const label = element(card, 'h3', 'yga-metric-label', metric.label);
      const row = element(card, 'div', 'yga-value-row');
      const format = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: metric.decimals, maximumFractionDigits: metric.decimals });
      const maxChars = Math.max(format.format(metric.value).length, format.format(metric.from).length);
      row.style.setProperty('--yga-number-size', `${Math.min(11.5, 58 / Math.max(5, maxChars))}cqw`);
      const value = element(row, 'span', 'yga-value', format.format(metric.from));
      if (metric.unit) element(row, 'span', 'yga-unit', metric.unit);
      const rail = element(card, 'div', 'yga-metric-rail');
      rail.setAttribute('aria-hidden', 'true');
      const fill = element(rail, 'div', 'yga-metric-fill');
      const enter = at + span * (.15 + index * .11);
      tl.add(card, { opacity: [0, 1], y: [30, 0], duration: span * .22, ease: 'outQuart' }, enter);
      tl.add(label, { opacity: [0, 1], x: [-12, 0], duration: span * .16, ease: 'outCirc' }, enter + span * .03);
      tl.add(value, { textContent: [metric.from, metric.value], modifier: current => format.format(current), duration: span * .40, ease: 'outExpo' }, enter + span * .10);
      tl.add(fill, { scaleX: [0, 1], duration: span * .42, ease: 'outCubic' }, enter + span * .07);
    });
    if (config.footnote) {
      const note = element(root, 'p', 'yga-footnote', config.footnote);
      tl.add(note, { opacity: [0, 1], duration: span * .15, ease: 'outQuad' }, at + span * .64);
    }
  }

  function createScene(container, input) {
    const config = validateConfig(input);
    if (!container || container.nodeType !== 1 || !container.isConnected || !container.style) {
      throw new TypeError('container must be a connected HTML element');
    }
    const existing = mounted.get(container);
    if (existing) {
      if (existing.key !== JSON.stringify(config)) throw new Error('container already has a scene; use a separate empty container');
      return existing.timeline;
    }
    if (container.childNodes.length) throw new Error('container must be empty; existing content is never replaced');
    const anime = global.anime;
    if (!anime?.createTimeline || !anime?.splitText || !anime?.svg?.createMotionPath) throw new Error('Load the local Anime.js 4.5.0 bundle before scenes.js');
    if (global.__hfAnime !== undefined && !Array.isArray(global.__hfAnime)) throw new TypeError('window.__hfAnime must be an array');
    const root = element(container, 'div', `yga-scene yga-${config.component}`);
    const content = element(root, 'div', 'yga-content');
    const tl = anime.createTimeline({ autoplay: false, defaults: { ease: 'outCubic' } });
    const start = config.startSeconds * 1000;
    // Leave a deliberate reading hold at the end. The composition data-duration
    // is authoritative; no invisible timers or padding tweens extend this timeline.
    const span = config.durationSeconds * 1000;
    const at = start + Math.min(200, span * .06);
    try {
      ({ 'title-reveal': titleReveal, 'flow-path': flowPath, 'number-compare': numberCompare })[config.component](content, config, tl, at, span, anime);
      tl.pause();
      // Anime v4 lazily renders future children. Visit the finite end once, then
      // rewind synchronously so a first seek to an arbitrary frame has the same
      // state as a backward seek (including children whose entrance is later).
      tl.seek(tl.duration, true);
      tl.seek(0, true);
      tl.yingyaScene = Object.freeze({ ...config, startMilliseconds: start });
      global.__hfAnime = global.__hfAnime || [];
      global.__hfAnime.push(tl);
      mounted.set(container, { key: JSON.stringify(config), timeline: tl });
      return tl;
    } catch (error) {
      tl.revert();
      root.remove();
      throw error;
    }
  }

  global.YingyaAnime = Object.freeze({ version: '1.0.0', animeVersion: '4.5.0', createScene, validateConfig });
})(typeof window === 'undefined' ? globalThis : window);
