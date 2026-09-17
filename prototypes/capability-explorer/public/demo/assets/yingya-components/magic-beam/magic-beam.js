/*
 * Deterministic video adaptation of Magic UI AnimatedBeam (MIT).
 * Copyright (c) Magic UI. See magic-ui-LICENSE.md and magic-beam.PROVENANCE.json.
 * The original component is preserved verbatim in magic-beam.upstream.tsx.
 */
(function (global) {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  let sequence = 0;

  function finite(value, name, minimum, maximum) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw new TypeError(`${name} must be a finite number from ${minimum} to ${maximum}`);
    }
    return value;
  }

  function text(value, name, maximum) {
    if (typeof value !== 'string' || !value.trim() || [...value].length > maximum) {
      throw new TypeError(`${name} must be a non-empty string of at most ${maximum} characters`);
    }
    return value;
  }

  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('beam-network config is required');
    const startSeconds = finite(input.startSeconds, 'startSeconds', 0, 86400);
    const durationSeconds = finite(input.durationSeconds, 'durationSeconds', .1, 120);
    if (!Array.isArray(input.nodes) || input.nodes.length < 2 || input.nodes.length > 24) throw new TypeError('nodes must contain 2 to 24 labeled nodes');
    const nodes = input.nodes.map((node, index) => ({
      id: text(node?.id, `nodes[${index}].id`, 80),
      label: text(node?.label, `nodes[${index}].label`, 24),
      x: finite(node?.x, `nodes[${index}].x`, 0, 1),
      y: finite(node?.y, `nodes[${index}].y`, 0, 1),
    }));
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    if (nodeMap.size !== nodes.length) throw new TypeError('node IDs must be unique');
    if (!Array.isArray(input.edges) || input.edges.length < 1 || input.edges.length > 48) throw new TypeError('edges must contain 1 to 48 connections');
    const edges = input.edges.map((edge, index) => {
      if (!edge || !nodeMap.has(edge.from) || !nodeMap.has(edge.to) || edge.from === edge.to) throw new TypeError(`edges[${index}] must connect two distinct node IDs`);
      const from = nodeMap.get(edge.from), to = nodeMap.get(edge.to);
      if (from.x === to.x && from.y === to.y) throw new TypeError(`edges[${index}] endpoints must have distinct positions`);
      if (edge.reverse !== undefined && typeof edge.reverse !== 'boolean') throw new TypeError(`edges[${index}].reverse must be a boolean`);
      const duration = finite(edge.durationSeconds ?? durationSeconds * .65, `edges[${index}].durationSeconds`, .01, durationSeconds);
      const delay = finite(edge.delaySeconds ?? 0, `edges[${index}].delaySeconds`, 0, durationSeconds);
      const repeatDelay = finite(edge.repeatDelaySeconds ?? 0, `edges[${index}].repeatDelaySeconds`, 0, durationSeconds);
      const iterations = finite(edge.iterations ?? 1, `edges[${index}].iterations`, 1, 20);
      if (!Number.isInteger(iterations)) throw new TypeError(`edges[${index}].iterations must be an integer`);
      if (delay + duration * iterations + repeatDelay * (iterations - 1) > durationSeconds + 1e-9) throw new TypeError(`edges[${index}] animation must fit within durationSeconds`);
      return {
        from: edge.from, to: edge.to, reverse: edge.reverse ?? false,
        curvature: finite(edge.curvature ?? 0, `edges[${index}].curvature`, -1, 1),
        duration, delay, repeatDelay, iterations,
      };
    });
    return { startSeconds, durationSeconds, nodes, edges };
  }

  function svg(parent, tag, attributes = {}) {
    const element = parent.ownerDocument.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    parent.appendChild(element);
    return element;
  }

  // Upstream Motion easing is cubic-bezier(.16, 1, .3, 1), not a polynomial
  // evaluated directly at progress. Solve its x coordinate before reading y.
  function ease(progress) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let low = 0, high = 1;
    for (let index = 0; index < 30; index++) {
      const t = (low + high) / 2;
      const x = 3 * (1 - t) ** 2 * t * .16 + 3 * (1 - t) * t * t * .3 + t ** 3;
      if (x < progress) low = t; else high = t;
    }
    const t = (low + high) / 2;
    return 1 - (1 - t) ** 3;
  }

  function createBeam(container, input) {
    const config = validate(input);
    if (!container || container.nodeType !== 1 || !container.isConnected || !container.style) throw new TypeError('container must be a connected HTML element');
    if (container.childNodes.length) throw new Error('beam-network container must be empty; existing content is preserved');
    // clientWidth/Height stay in canvas coordinates when the preview scales the
    // composition with CSS transforms. getBoundingClientRect would scale twice.
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) throw new Error('beam-network requires a resolved container width and height');
    const document = container.ownerDocument;
    const root = document.createElement('div');
    root.className = 'ygc-beam-network';
    root.setAttribute('role', 'img');
    const nodeMap = new Map(config.nodes.map(node => [node.id, { ...node, x: node.x * width, y: node.y * height }]));
    root.setAttribute('aria-label', config.edges.map(edge => {
      const from = nodeMap.get(edge.reverse ? edge.to : edge.from), to = nodeMap.get(edge.reverse ? edge.from : edge.to);
      return `${from.label} → ${to.label}`;
    }).join('；'));
    const canvas = svg(root, 'svg', { class: 'ygc-beam-lines', viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
    const definitions = svg(canvas, 'defs');
    let instanceId;
    do { instanceId = `ygc-beam-${++sequence}`; } while (document.getElementById(`${instanceId}-0`));
    const beams = config.edges.map((edge, index) => {
      const start = nodeMap.get(edge.from), end = nodeMap.get(edge.to);
      // Preserved from upstream AnimatedBeam.updatePath: quadratic control x is
      // the endpoint midpoint; control y is startY minus curvature.
      const controlY = start.y - edge.curvature * Math.min(width, height);
      const d = `M ${start.x},${start.y} Q ${(start.x + end.x) / 2},${controlY} ${end.x},${end.y}`;
      svg(canvas, 'path', { d, class: 'ygc-beam-track', 'stroke-linecap': 'round' });
      const light = svg(canvas, 'path', { d, class: 'ygc-beam-light', stroke: `url(#${instanceId}-${index})`, 'stroke-linecap': 'round' });
      const gradient = svg(definitions, 'linearGradient', { id: `${instanceId}-${index}`, gradientUnits: 'userSpaceOnUse' });
      // Exact four-stop structure from Magic UI; the palette belongs to DESIGN.md.
      svg(gradient, 'stop', { class: 'ygc-beam-start', 'stop-opacity': 0 });
      svg(gradient, 'stop', { class: 'ygc-beam-start' });
      svg(gradient, 'stop', { class: 'ygc-beam-stop', offset: '32.5%' });
      svg(gradient, 'stop', { class: 'ygc-beam-stop', offset: '100%', 'stop-opacity': 0 });
      return { ...edge, start, end, light, gradient };
    });
    for (const node of config.nodes) {
      const label = document.createElement('span');
      label.className = 'ygc-beam-node';
      label.style.left = `${node.x * 100}%`;
      label.style.top = `${node.y * 100}%`;
      label.textContent = node.label;
      label.setAttribute('aria-hidden', 'true');
      root.appendChild(label);
    }
    container.appendChild(root);
    let disposed = false;

    function renderAt(globalSeconds) {
      finite(globalSeconds, 'globalSeconds', 0, 86400 + 120);
      if (disposed) return;
      root.style.visibility = globalSeconds < config.startSeconds ? 'hidden' : 'visible';
      const local = Math.max(0, Math.min(config.durationSeconds, globalSeconds - config.startSeconds));
      for (const beam of beams) {
        const elapsed = local - beam.delay;
        const cycle = beam.duration + beam.repeatDelay;
        const iteration = Math.floor(Math.max(0, elapsed) / cycle);
        const cycleTime = Math.max(0, elapsed) - iteration * cycle;
        const active = globalSeconds >= config.startSeconds && elapsed >= 0 && iteration < beam.iterations && cycleTime < beam.duration;
        const progress = ease(cycleTime / beam.duration);
        // Upstream uses forward x1:[10%,110%], x2:[0%,100%], or reversed
        // x1:[90%,-10%], x2:[100%,0%]. Map those coordinates to the connection
        // vector so the same light also travels vertically and right-to-left.
        const first = beam.reverse ? .9 - progress : .1 + progress;
        const second = beam.reverse ? 1 - progress : progress;
        const dx = beam.end.x - beam.start.x, dy = beam.end.y - beam.start.y;
        beam.gradient.setAttribute('x1', String(beam.start.x + dx * first));
        beam.gradient.setAttribute('y1', String(beam.start.y + dy * first));
        beam.gradient.setAttribute('x2', String(beam.start.x + dx * second));
        beam.gradient.setAttribute('y2', String(beam.start.y + dy * second));
        beam.light.setAttribute('opacity', active ? '1' : '0');
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      root.remove();
    }

    renderAt(0);
    return { startSeconds: config.startSeconds, durationSeconds: config.durationSeconds, renderAt, dispose };
  }

  if (!global.YingyaComponents?.define) throw new Error('Load the local Yingya component clock before magic-beam.js');
  global.YingyaComponents.define('beam-network', createBeam);
})(typeof window === 'undefined' ? globalThis : window);
