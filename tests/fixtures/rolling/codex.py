#!/usr/bin/python3
"""Deterministic app-server fixture; never calls a model or paid provider."""
import json
import os
from pathlib import Path
import sys
import threading
import time
import uuid

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


def finish(thread, turn, prompt):
    meta = threads[thread]
    if not meta.get('ephemeral'):
        log(meta['cwd'], {'event': 'start', 'turn': turn, 'release': release, 'prompt': prompt})
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
