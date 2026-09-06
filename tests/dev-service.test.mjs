import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('tmux lifecycle preserves environment and isolates service ownership', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
  const dir = await mkdtemp(join(tmpdir(), 'yingya-service-check-'));
  const socket = `yingya-service-test-${process.pid}`;
  const tmuxBin = execFileSync('which', ['tmux'], {encoding:'utf8'}).trim();
  const tmux = args => execFileSync(tmuxBin, ['-L',socket,...args], {encoding:'utf8'});
  const env = {...process.env, PATH: `${dir}:${process.env.PATH}`, HTTPS_PROXY: 'http://127.0.0.1:19999'};
  const run = action => execFileSync('bash', ['scripts/dev-service.sh','frontend',action], {cwd:root, env, encoding:'utf8'});
  try {
    await writeFile(join(dir,'tmux'), `#!/usr/bin/env bash\nexec '${tmuxBin}' -L '${socket}' "$@"\n`, {mode:0o755});
    await writeFile(join(dir,'npm'), '#!/usr/bin/env bash\nexec sleep 300\n', {mode:0o755});
    tmux(['new-session','-d','-s','unrelated','sleep','300']);
    assert.match(run('start'), /Started: tmux=yingya-frontend port=8798/);
    const pid = tmux(['display-message','-p','-t','=yingya-frontend:','#{pane_pid}']).trim();
    assert.match(run('start'), /Already running/);
    assert.equal(tmux(['display-message','-p','-t','=yingya-frontend:','#{pane_pid}']).trim(), pid);
    assert.match(run('status'), /Running: tmux=yingya-frontend port=8798/);
    assert.match(run('status'), /pane=%\d+ command=\S+ pid=\d+/);
    run('logs');
    let currentPath = '';
    for (let i = 0; i < 40; i++) {
      currentPath = tmux(['display-message','-p','-t','=yingya-frontend:','#{pane_current_path}']).trim();
      if (currentPath === root) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(currentPath, root);
    assert.equal(tmux(['show-environment','-t','yingya-frontend','HTTPS_PROXY']).trim(), 'HTTPS_PROXY=http://127.0.0.1:19999');
    env.HTTPS_PROXY = 'http://127.0.0.1:20000';
    assert.match(run('restart'), /Started/);
    assert.notEqual(tmux(['display-message','-p','-t','=yingya-frontend:','#{pane_pid}']).trim(), pid);
    assert.equal(tmux(['show-environment','-t','yingya-frontend','HTTPS_PROXY']).trim(), 'HTTPS_PROXY=http://127.0.0.1:20000');
    assert.match(run('stop'), /Stopped/);
    tmux(['has-session','-t','=unrelated']);
    assert.throws(() => run('status'));
  } finally {
    try { tmux(['kill-server']); } catch {}
    await rm(dir,{recursive:true,force:true});
  }
});
