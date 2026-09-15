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
