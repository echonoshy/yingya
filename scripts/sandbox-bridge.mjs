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
const child = spawn(process.argv[2], process.argv.slice(3), { stdio: 'inherit', env: { ...process.env,
  HTTP_PROXY:'http://127.0.0.1:18888', HTTPS_PROXY:'http://127.0.0.1:18888', ALL_PROXY:'http://127.0.0.1:18888',
  http_proxy:'http://127.0.0.1:18888', https_proxy:'http://127.0.0.1:18888', all_proxy:'http://127.0.0.1:18888',
  NO_PROXY:'127.0.0.1,localhost', no_proxy:'127.0.0.1,localhost', NODE_USE_ENV_PROXY:'1',
}});
child.on('error', e => { console.error(e.message); process.exit(1); });
child.on('exit', (code, signal) => { for(const s of servers)s.close(); process.exit(code ?? (signal ? 1 : 0)); });
for(const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
