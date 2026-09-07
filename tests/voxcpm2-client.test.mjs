import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const client = fileURLToPath(new URL('../skills/voxcpm2-tts/scripts/voxcpm2_tts.mjs', import.meta.url));
async function fixture(t, savedVoice, available = true) {
  const cwd = await mkdtemp(join(tmpdir(), 'yingya-tts-'));
  await mkdir(join(cwd, '.yingya'));
  await writeFile(join(cwd, '.yingya/voice.json'), JSON.stringify({voiceId:savedVoice}));
  const requests = [];
  const voice = {name:'fixed-narrator',ref_text:'固定参考样本原文'};
  const server = createServer(async (req,res) => {
    let raw=''; for await (const chunk of req) raw+=chunk;
    const body=raw?JSON.parse(raw):undefined;
    requests.push({path:req.url,body});
    if(req.url==='/api/voices/resolve') {
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(voice));
    } else if(req.url==='/v1/audio/voices') {
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({uploaded_voices:available?[voice]:[]}));
    } else if(req.url==='/v1/audio/speech') { res.end('test-audio'); }
    else {res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await rm(cwd,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function run(extra=[]) {
    const child=spawn(process.execPath,[client,'--base-url',base,'synthesize','--text','第一段旁白','--output','out.wav',...extra],{cwd,env:{...process.env,YINGYA_API_BASE:base},stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise(resolve=>child.on('close',resolve));
    return {code,stderr};
  }
  return {requests,run,cwd};
}

test('default narration resolves to persisted reference and includes transcript',async t=>{
  const f=await fixture(t,'default');
  assert.equal((await f.run()).code,0);
  assert.deepEqual(f.requests.map(r=>r.path),['/api/voices/resolve','/v1/audio/speech']);
  assert.equal(f.requests[1].body.voice,'fixed-narrator');
  assert.equal(f.requests[1].body.ref_text,'固定参考样本原文');
  assert.equal(await readFile(join(f.cwd,'out.wav'),'utf8'),'test-audio');
});
test('named project voice is used even when --voice is omitted',async t=>{
  const f=await fixture(t,'fixed-narrator');
  assert.equal((await f.run()).code,0);
  assert.equal(f.requests.at(-1).body.voice,'fixed-narrator');
  assert.equal(f.requests.at(-1).body.ref_text,'固定参考样本原文');
});
test('explicit voice cannot override saved project voice silently',async t=>{
  const f=await fixture(t,'fixed-narrator');
  const result=await f.run(['--voice','default']);
  assert.equal(result.code,1);assert.match(result.stderr,/Project voice/);assert.equal(f.requests.length,0);
});
test('missing named voice fails before synthesis',async t=>{
  const f=await fixture(t,'fixed-narrator',false);
  assert.equal((await f.run()).code,1);
  assert.equal(f.requests.some(r=>r.path==='/v1/audio/speech'),false);
});
