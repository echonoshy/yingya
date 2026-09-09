import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

// Exercise the real sandbox bridge with an inherited nonblocking output pipe,
// the condition that broke native Codex stdout after a large Base64 response.
test('sandbox relay preserves large output and the next reply under backpressure', async () => {
  const bridge = new URL('../scripts/sandbox-bridge.mjs', import.meta.url).pathname;
  const driver = String.raw`
import subprocess,sys,os,fcntl,time,json
bridge,node=sys.argv[1:]
def nonblocking():
 for fd in (1,2):fcntl.fcntl(fd,fcntl.F_SETFL,fcntl.fcntl(fd,fcntl.F_GETFL)|os.O_NONBLOCK)
child_code="import sys,fcntl,os; sys.stdin.readline(); assert not(fcntl.fcntl(1,fcntl.F_GETFL)&os.O_NONBLOCK); sys.stdout.write('A'*2097152+'\\n'); sys.stdout.flush(); sys.stdin.readline(); print('NEXT_REPLY',flush=True); sys.stderr.write('E'*131072)"
wrapper="process.argv=['node',...process.argv.slice(1)]; await import(process.argv[1]); process.stdout._handle.setBlocking(false);"
p=subprocess.Popen(['bwrap','--unshare-net','--ro-bind','/','/',node,'--input-type=module','-e',wrapper,bridge,sys.executable,'-c',child_code],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,preexec_fn=nonblocking)
time.sleep(.2)
p.stdin.write(b'continue\n'); p.stdin.flush()
time.sleep(.2)
out,err=p.communicate(b'next\n',timeout=10)
assert p.returncode==0,(p.returncode,err[-1000:])
assert out==b'A'*2097152+b'\nNEXT_REPLY\n',(len(out),out[-100:])
assert err==b'E'*131072,(len(err),err[-100:])
print('large response and next reply intact')
`;
  const { stdout } = await promisify(execFile)('python3', ['-c', driver, bridge, process.execPath], { timeout: 15000 });
  assert.match(stdout, /next reply intact/);
});
