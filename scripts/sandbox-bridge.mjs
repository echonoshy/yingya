// Runs inside an unshared network namespace. Only this user's gateway is mounted.
import net from 'node:net';
import { spawn } from 'node:child_process';
const socketPath = '/run/yingya-gateway.sock';
const servers = [];
for (const port of [18888, 8797, 8791]) {
  const server = net.createServer(client => {
    const remote = net.connect(socketPath);
    client.on('error', () => remote.destroy()); remote.on('error', () => client.destroy());
    client.pipe(remote).pipe(client);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  servers.push(server);
}
const child = spawn(process.argv[2], process.argv.slice(3), { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
  HTTP_PROXY:'http://127.0.0.1:18888', HTTPS_PROXY:'http://127.0.0.1:18888', ALL_PROXY:'http://127.0.0.1:18888',
  http_proxy:'http://127.0.0.1:18888', https_proxy:'http://127.0.0.1:18888', all_proxy:'http://127.0.0.1:18888',
  NO_PROXY:'127.0.0.1,localhost', no_proxy:'127.0.0.1,localhost', NODE_USE_ENV_PROXY:'1',
}});
// Keep the native child's descriptors separate from Node's inherited stdout.
// Node may put its own output in nonblocking mode. The relay handles EAGAIN
// and backpressure; a large JSON message must not kill Codex's stdout writer.
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.stdin.on('error', error => {
  if (error.code !== 'EPIPE') console.error(error.message);
});
process.stdin.on('end', () => child.stdin.end());
child.on('error', e => { console.error(e.message); process.exit(1); });
child.on('close', (code, signal) => {
  for (const server of servers) server.close();
  process.stdin.unpipe(child.stdin);
  process.stdin.pause();
  // Let the relayed final response drain before exiting.
  process.exitCode = code ?? (signal ? 1 : 0);
});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
