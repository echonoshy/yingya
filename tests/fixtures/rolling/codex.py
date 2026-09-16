#!/usr/bin/python3
"""Deterministic app-server fixture; never calls a model or paid provider."""
import json
import os
from pathlib import Path
import sys
import threading
import time
import uuid
import urllib.request
import urllib.error
import re
import shutil
import subprocess

lock = threading.Lock()
home = Path(os.environ['CODEX_HOME'])
store = home / 'mock-threads.json'
threads = json.loads(store.read_text()) if store.exists() else {}
release = Path(__file__).resolve().parents[2].name


def send(value):
    with lock:
        print(json.dumps(value), flush=True)


def log(cwd, value):
    path = Path(cwd) / '.yingya/mock.jsonl'
    path.parent.mkdir(exist_ok=True)
    with path.open('a') as file:
        file.write(json.dumps(value) + '\n')


def production_fixture(thread, turn, prompt):
    root = Path(threads[thread]['cwd'])
    marker = root / '.yingya/production-fixture-mode'
    if prompt.lstrip().startswith('继续当前请求 ') and marker.exists():
        if marker.read_text() in ('PRODUCTION_NO_PROGRESS', 'PRODUCTION_CHECK_ONLY'):
            return True
        # Finish the missing seal only after consuming the original job's report.
        report = root / '.yingya/reports/check-fixture.json'
        assert json.loads(report.read_text())['ok'] is True
        source = root / '.yingya/versions/draft-fixture'
        source.mkdir(parents=True)
        shutil.copy2(root / 'index.html', source / 'index.html')
        shutil.copy2(report, source / 'check.json')
        video = source / 'preview.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=0.2',
                        '-c:v', 'libx264', '-threads', '1', str(video)], check=True)
        path = root / '.yingya/manifest.json'
        manifest = json.loads(path.read_text())
        manifest.update(phase='draft_review', dirty=False, currentDraft='draft-fixture',
            checkpoint={'id': 'draft-fixture-review', 'kind': 'draft', 'title': 'fixture', 'summary': '', 'artifactIds': ['video']},
            artifacts=[{'id': 'video', 'kind': 'video', 'label': 'fixture', 'path': str(video.relative_to(root))}],
            versions=[{'id': 'draft-fixture', 'label': 'fixture', 'sourcePath': str(source.relative_to(root)),
                       'videoPath': str(video.relative_to(root)), 'reportPath': str((source / 'check.json').relative_to(root))}])
        path.write_text(json.dumps(manifest))
        log(root, {'event': 'sealed', 'turn': turn})
        return True
    modes = ['PRODUCTION_YIELD', 'PRODUCTION_NO_PROGRESS', 'PRODUCTION_QUESTION', 'PRODUCTION_CHECK_ONLY']
    mode = next((mode for mode in modes if mode in prompt), None)
    if mode is None:
        return False
    marker.write_text(mode)
    (root / 'index.html').write_text('<main data-composition-id="main" data-start="0" data-duration="0.2">fixture</main>')
    path = root / '.yingya/manifest.json'
    manifest = json.loads(path.read_text())
    manifest.update(phase='production', dirty=True, studioEntry='index.html')
    path.write_text(json.dumps(manifest))
    request = re.search(r'当前请求编号：([A-Za-z0-9-]+)', prompt).group(1)
    command = ['python3', os.environ['YINGYA_PRODUCTION_TASK'], 'check', '--request-id', request,
               '--output', '.yingya/reports/check-fixture.json']
    if mode != 'PRODUCTION_CHECK_ONLY':
        command.append('--continue-workflow')
    child = subprocess.Popen(command, cwd=root, stdout=subprocess.PIPE, text=True)
    receipt = json.loads(child.stdout.readline())
    log(root, {'event': 'yielded', 'job': receipt['id'], 'request': request})
    item = {'id': receipt['id'], 'type': 'commandExecution', 'command': 'python3 "$YINGYA_PRODUCTION_TASK" check',
            'cwd': str(root), 'status': 'inProgress', 'exitCode': None, 'commandActions': []}
    send({'method': 'item/started', 'params': {'threadId': thread, 'turnId': turn, 'item': item}})
    def completed():
        output, _ = child.communicate()
        item.update(status='completed' if child.returncode == 0 else 'failed', exitCode=child.returncode, aggregatedOutput=output)
        send({'method': 'item/completed', 'params': {'threadId': thread, 'turnId': turn, 'item': item}})
    threading.Thread(target=completed, daemon=True).start()
    if mode == 'PRODUCTION_QUESTION':
        (root / '.yingya/turn-result.json').write_text(json.dumps({
            'requestId': request, 'disposition': 'needs_input', 'reason': '请选择需要保留的素材。'}))
    return True


def finish(thread, turn, prompt):
    meta = threads[thread]
    if not meta.get('ephemeral'):
        log(meta['cwd'], {'event': 'start', 'turn': turn, 'release': release, 'prompt': prompt})
        if 'MODEL_OVERLOAD' in prompt:
            error = {'message': 'Selected model is at capacity. Please try a different model.',
                     'codexErrorInfo': 'serverOverloaded'}
            send({'method': 'error', 'params': {'threadId': thread, 'turnId': turn,
                  'error': error, 'willRetry': False}})
            send({'method': 'turn/completed', 'params': {'threadId': thread,
                  'turn': {'id': turn, 'status': 'failed', 'error': error}}})
            return
        if 'VOICE_METADATA_PROBE' in prompt:
            probes = {}
            for path in ('health', 'v1/models', 'v1/audio/voices'):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:8791/' + path, timeout=10) as response:
                        probes[path] = {'status': response.status, 'body': json.loads(response.read())}
                except urllib.error.HTTPError as error:
                    probes[path] = {'status': error.code, 'body': error.read().decode()}
            log(meta['cwd'], {'event': 'voice-probes', 'probes': probes})
        if not production_fixture(thread, turn, prompt):
            time.sleep(8 if 'WAIT' in prompt else .1)
        log(meta['cwd'], {'event': 'done', 'turn': turn, 'release': release})
    send({'method': 'item/completed', 'params': {'threadId': thread, 'turnId': turn,
          'item': {'id': 'reply', 'type': 'agentMessage', 'text': '已完成'}}})
    send({'method': 'turn/completed', 'params': {'threadId': thread, 'turn': {'id': turn, 'status': 'completed'}}})


for line in sys.stdin:
    request = json.loads(line)
    method, params = request.get('method'), request.get('params', {})
    if 'id' not in request:
        continue
    result = {}
    if method == 'thread/start':
        thread = str(uuid.uuid4())
        threads[thread] = params
        store.write_text(json.dumps(threads))
        result = {'thread': {'id': thread}}
    elif method == 'thread/resume':
        thread = params['threadId']
        if thread not in threads:
            send({'id': request['id'], 'error': {'code': -1, 'message': 'thread not found'}})
            continue
        log(threads[thread]['cwd'], {'event': 'resume', 'release': release, 'thread': thread})
        result = {'thread': {'id': thread}}
    elif method == 'turn/start':
        thread, turn = params['threadId'], str(uuid.uuid4())
        prompt = '\n'.join(item.get('text', '') for item in params['input'])
        send({'id': request['id'], 'result': {'turn': {'id': turn, 'status': 'inProgress'}}})
        send({'method': 'turn/started', 'params': {'threadId': thread, 'turn': {'id': turn, 'status': 'inProgress'}}})
        threading.Thread(target=finish, args=(thread, turn, prompt), daemon=True).start()
        continue
    send({'id': request['id'], 'result': result})
