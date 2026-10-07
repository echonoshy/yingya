import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('gateway preserves protocol headers, propagates disconnects, and survives upstream abort', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'yingya-gateway-'));
  const socketPath = join(root, 'gateway.sock');
  const observed = new Map();
  const upstream = http.createServer((req, res) => {
    observed.set(req.url, { headers: req.headers, closed: false });
    res.on('close', () => { observed.get(req.url).closed = true; });
    if (req.url === '/api/headers') { res.end(JSON.stringify(req.headers)); return; }
    if (req.url === '/api/before') return;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: first\n\n');
    if (req.url === '/api/broken') setTimeout(() => res.destroy(), 20);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const gateway = spawn(process.execPath, [new URL('../scripts/sandbox-gateway.mjs', import.meta.url).pathname], {
    env: { ...process.env, YINGYA_GATEWAY_SOCKET: socketPath, YINGYA_SERVICE_TOKEN: 'host-token', YINGYA_BACKEND_BASE: `http://127.0.0.1:${upstream.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = ''; gateway.stderr.on('data', b => { stderr += b; });
  t.after(async () => {
    const exited = once(gateway, 'exit'); gateway.kill(); await exited;
    upstream.closeAllConnections(); upstream.close();
    await rm(root, { recursive: true, force: true });
  });
  await once(gateway.stdout, 'data');
  const request = (path, callback) => http.get({ socketPath, path: `http://127.0.0.1:8797${path}`, headers: { 'session-id': 'session', 'thread-id': 'thread', 'x-client-request-id': 'request', authorization: 'private-client', cookie: 'private-cookie' } }, callback);
  const headers = await new Promise((resolve, reject) => {
    request('/api/headers', res => { let text='';res.on('data', b => { text += b; }); res.on('end', () => resolve(JSON.parse(text))); }).on('error', reject);
  });
  assert.equal(headers['session-id'], 'session');
  assert.equal(headers['thread-id'], 'thread');
  assert.equal(headers['x-client-request-id'], 'request');
  assert.equal(headers.authorization, 'Bearer host-token');
  assert.equal(headers.cookie, undefined);
  const waitFor = async fn => {
    for (let i=0;i<100;i++) { if(fn())return; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.fail('connection did not close');
  };
  const before = request('/api/before'); before.on('error', () => {});
  await waitFor(() => observed.has('/api/before')); before.destroy();
  await waitFor(() => observed.get('/api/before').closed);
  await new Promise((resolve, reject) => {
    request('/api/after', res => { res.on('error', () => {});res.once('data', () => { res.destroy();resolve(); }); }).on('error', reject);
  });
  await waitFor(() => observed.get('/api/after').closed);
  await new Promise((resolve, reject) => {
    request('/api/broken', res => { res.resume(); res.on('aborted', resolve);res.on('error', () => {});res.on('end', () => reject(new Error('broken stream appeared successful'))); }).on('error', reject);
  });
  assert.equal(gateway.exitCode, null, stderr);
  assert.equal(stderr, '');
});

test('gateway permits the bundled H3 service without opening other ports or shared job listing', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'yingya-h3-gateway-'));
  const socketPath = join(root, 'gateway.sock');
  const observed = [];
  const service = http.createServer((req, res) => {
    observed.push({ path: req.url, method: req.method, headers: req.headers });
    req.resume(); req.on('end', () => res.end(JSON.stringify({ ok: true })));
  });
  service.listen(0, '127.0.0.1'); await once(service, 'listening');
  // Redirect only the approved H3 destination at the transport boundary. The
  // gateway still performs its real URL/method/path authorization beforehand.
  const preload = `import http from 'node:http'; const original = http.request;
    http.request = function(options, callback) {
      if (options.hostname === '140.143.229.103' && String(options.port) === '8910')
        options = {...options, hostname: '127.0.0.1', port: ${service.address().port}};
      return original.call(this, options, callback);
    };`;
  const gateway = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, new URL('../scripts/sandbox-gateway.mjs', import.meta.url).pathname], {
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', YINGYA_GATEWAY_SOCKET: socketPath, YINGYA_SERVICE_TOKEN: 'secret-user-token', YINGYA_BACKEND_BASE: 'http://127.0.0.1:1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    const exited = once(gateway, 'exit'); gateway.kill(); await exited;
    service.closeAllConnections(); service.close(); await rm(root, { recursive: true, force: true });
  });
  await once(gateway.stdout, 'data');
  const request = (url, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: url, method, headers: { cookie: 'private-cookie' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject); req.end();
  });
  const base = 'http://140.143.229.103:8910';
  for (const [method, path] of [['GET','/api/health'], ['GET','/api/capabilities'], ['POST','/api/jobs'], ['GET','/api/jobs/job-1'], ['GET','/api/jobs/job-1/video'], ['GET','/api/jobs/job-1/frame/last'], ['POST','/api/jobs/job-1/cancel']]) {
    assert.equal(await request(base + path, method), 200, path);
  }
  assert.equal(observed.length, 7);
  for (const req of observed) {
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.host, '140.143.229.103:8910');
  }
  for (const url of [base + '/api/jobs', base + '/admin', 'http://140.143.229.103:8911/api/health', 'http://127.0.0.1:8910/api/health', 'http://10.0.0.1/api/health', 'http://140.143.229.104:8910/api/health']) {
    assert.equal(await request(url), 403, url);
  }
  assert.equal(await request(base + '/api/jobs/job-1', 'DELETE'), 403);
  assert.equal(observed.length, 7);
});
