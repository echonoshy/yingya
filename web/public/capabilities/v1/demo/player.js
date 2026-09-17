const params = new URLSearchParams(location.search);
const component = params.get('component') || 'beam-network';
const variant = Math.max(0, Math.min(2, Number(params.get('variant')) || 0));
const stage = document.querySelector('#scene');
let handle, timeline, animation = 0, playing = false, time = 0, last = 0, lastNotify = 0;
function tell(type, data = {}) { parent.postMessage({ type, ...data }, location.origin); }
function draw(value) { time = Math.max(0, Math.min(6, value)); if (timeline) timeline.seek(time * 1000); if (handle) handle.renderAt(time); window.demoTime = time; }
function state() { tell('demo-state', { time, playing }); }
function stop() { playing = false; cancelAnimationFrame(animation); state(); }
function tick(now) { if (!playing) return; draw(time + Math.min((now - last) / 1000, .1)); last = now; if (time >= 6) { stop(); return; } if (now - lastNotify > 80) { state(); lastNotify = now; } animation = requestAnimationFrame(tick); }
function play() { if (playing) return; if (time >= 6) draw(0); playing = true; last = performance.now(); state(); animation = requestAnimationFrame(tick); }
window.addEventListener('message', event => { if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'demo-control') return; const { action, value } = event.data; if (action === 'play') play(); if (action === 'pause') stop(); if (action === 'seek') { stop(); draw(Number(value) || 0); state(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('pagehide', () => { stop(); handle?.dispose(); timeline?.pause(); });
try {
  await document.fonts.ready;
  if (component === 'beam-network') {
    const title = document.createElement('h1'); title.textContent = ['让素材，汇成故事', '从一个想法，展开更多可能', '让关系，清晰可见'][variant]; stage.append(title);
    const network = document.createElement('div'); network.id = 'network'; stage.append(network);
    const nodes = [{id:'text',label:'文案',x:.14,y:.18},{id:'image',label:'图片',x:.14,y:.5},{id:'audio',label:'声音',x:.14,y:.82},{id:'story',label:'组织镜头',x:.5,y:.5},{id:'film',label:'生成视频',x:.85,y:.5}];
    const edges = [{from:'text',to:'story',durationSeconds:3},{from:'image',to:'story',delaySeconds:.3,durationSeconds:3},{from:'audio',to:'story',delaySeconds:.6,durationSeconds:3},{from:'story',to:'film',delaySeconds:1.8,durationSeconds:3}];
    if (variant === 1) { nodes.forEach(node => { node.x = 1 - node.x; }); edges.forEach(edge => { [edge.from, edge.to] = [edge.to, edge.from]; }); }
    if (variant === 2) { nodes[0].label='输入'; nodes[1].label='处理'; nodes[2].label='反馈'; nodes[3].label='系统'; nodes[4].label='输出'; }
    handle = window.YingyaComponents.createScene(network, { component, startSeconds:0, durationSeconds:6, nodes, edges }); await handle.ready;
  } else if (component === 'model-stage') {
    await import('./assets/yingya-components/three-model/model-scene.js');
    const model = document.createElement('div'); model.id = 'model'; stage.append(model);
    const note = document.createElement('p'); note.className='model-note'; note.textContent='原创几何模型 · Three.js 组件运行示例'; stage.append(note);
    handle = window.YingyaComponents.createScene(model, { component, modelUrl:'assets/yingya-components/three-model/sample-model.glb',startSeconds:0,durationSeconds:6,width:800,height:540,motion:['turntable','orbit','still'][variant],turns:.6,animationClip:null }); await handle.ready;
  } else {
    const config = {component,startSeconds:0,durationSeconds:6,title:'让想法，流动起来'};
    if (component === 'title-reveal') Object.assign(config,{title:['让想法，流动起来','第二章 · 看见变化','把内容，做成故事'][variant],eyebrow:'映芽 · 动画镜头',subtitle:'把内容变成看得见的故事'});
    else if (component === 'flow-path') Object.assign(config,{title:'每一步，都清晰可见',nodes:[{label:'内容',detail:'放入你的素材'},{label:'分析',detail:'找到表达重点'},{label:'成片',detail:'组合成一个故事'},...(variant > 0 ? [{label:'修改',detail:'打磨内容与节奏'}] : []),...(variant > 1 ? [{label:'导出',detail:'保存完整视频'}] : [])]});
    else if (component === 'number-compare') Object.assign(config,{title:['让变化，一眼可见','两项指标，清楚呈现','让结果，更有说服力'][variant],metrics:[{label:'起点',value:[12,24,36][variant],unit:'份'},{label:'结果',value:[48,72,96][variant],unit:'份'}],footnote:'示例数据 · 用于展示数字动画'});
    else throw new Error('Unsupported demo');
    timeline = window.YingyaAnime.createScene(stage, config);
  }
  draw(params.has('snapshot') ? 4.5 : 0); window.demoReady = true; window.seekDemo = value => { stop(); draw(value); }; tell('demo-ready'); state(); if (!params.has('snapshot')) play();
} catch (error) { stop(); stage.textContent=''; const notice = document.createElement('div'); notice.id='error'; notice.textContent='组件加载失败，请返回后重试。'; stage.append(notice); tell('demo-error', { message: String(error) }); console.error(error); }
