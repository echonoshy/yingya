#!/usr/bin/env python3
"""Real Rust APIs + workers + nginx in isolated tmux, with a fake Codex protocol."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.request
import uuid

REPO = Path(__file__).resolve().parents[1]
BINARY = REPO / 'target/debug/yingya-server'


class RollingRuntime(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='yingya-rolling-'))
        self.data, self.runtime, self.releases = [self.root / name for name in ('data', 'runtime', 'releases')]
        for path in [self.data, self.runtime / 'codex-home/skills', self.releases, self.root / 'bin']:
            path.mkdir(parents=True)
        (self.runtime / 'codex-home/auth.json').write_text('{"OPENAI_API_KEY":"fake-never-sent"}')
        self.socket = 'yingya-rolling-' + uuid.uuid4().hex[:12]
        self.tmux = shutil.which('tmux')
        wrapper = self.root / 'bin/tmux'
        wrapper.write_text(f'#!/bin/sh\nexec {self.tmux} -L {self.socket} "$@"\n')
        wrapper.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + ':' + os.environ['PATH'],
                        YINGYA_APP_DATA_DIR=str(self.data), YINGYA_RUNTIME_DIR=str(self.runtime),
                        YINGYA_CODEX_HOME=str(self.runtime / 'codex-home'), YINGYA_ENV_FILE=str(self.root / 'empty.env'))
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.base = f'http://127.0.0.1:{self.port}'
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.cookie = ''
        self.make_release('v1')
        self.make_release('v2')
        self.make_release('bad', broken=True)
        result = subprocess.check_output([str(BINARY), 'admin-create', 'rollingtester', 'rolling@example.com'], env=self.env, cwd=REPO, text=True)
        self.user = json.loads(result)

    def make_release(self, name, broken=False):
        root = self.releases / name
        root.mkdir()
        for folder in ['scripts', 'skills']:
            shutil.copytree(REPO / folder, root / folder, ignore=shutil.ignore_patterns('__pycache__'))
        (root / 'node_modules/.bin').mkdir(parents=True)
        shutil.copy2(REPO / 'tests/fixtures/rolling/codex.py', root / 'node_modules/.bin/codex')
        (root / 'node_modules/.bin/codex').chmod(0o755)
        hyperframes = root / 'node_modules/.bin/hyperframes'
        hyperframes.write_text('#!/bin/sh\nexit 1\n')
        hyperframes.chmod(0o755)
        (root / 'web-dist/static').mkdir(parents=True)
        if not broken:
            (root / 'web-dist/index.html').write_text(f'<!doctype html><title>{name}</title>')
        (root / f'web-dist/static/{name}.js').write_text(f'const version="{name}";')
        shutil.copy2(BINARY, root / 'yingya-server')
        (root / 'release.json').write_text(json.dumps({'id': name, 'binary': str(root / 'yingya-server'), 'resources': str(root)}))

    def release(self, name, expect_success=True):
        result = subprocess.run(['python3', str(REPO / 'scripts/release.py'), 'activate', name,
            '--data', str(self.data), '--runtime', str(self.runtime), '--releases', str(self.releases),
            '--env-file', str(self.root / 'empty.env'), '--port', str(self.port)],
            cwd=REPO, env=self.env, capture_output=True, text=True, timeout=60)
        if expect_success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        print(result.stdout, flush=True)
        return result

    def request(self, path, data=None, method=None):
        headers = {'Cookie': self.cookie, 'Content-Type': 'application/json'}
        request = urllib.request.Request(self.base + path,
            data=None if data is None else json.dumps(data).encode(), headers=headers, method=method)
        with self.opener.open(request, timeout=45) as response:
            if response.headers.get('Set-Cookie'):
                self.cookie = response.headers['Set-Cookie'].split(';')[0]
            raw = response.read()
            return json.loads(raw) if response.headers.get('Content-Type', '').startswith('application/json') else raw

    def worker(self):
        path = self.data / 'deployment/registry.sqlite'
        with sqlite3.connect(path) as db:
            db.row_factory = sqlite3.Row
            row = db.execute('SELECT * FROM workers WHERE user=?', (self.user['id'],)).fetchone()
            return dict(row) if row else None

    def wait(self, fn, timeout=35):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                result = fn()
                if result:
                    return result
            except (OSError, ValueError, sqlite3.Error):
                pass
            time.sleep(.1)
        self.fail('timed out waiting for runtime condition')

    def log(self, project):
        path = self.data / 'users' / self.user['id'] / 'projects' / project / '.yingya/mock.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def seed_completed_render(self):
        project = self.request('/api/agent-projects', {'prompt': 'render recovery fixture', 'model': 'gpt-5.6-terra', 'reasoningEffort': 'high', 'aspectRatio': '16:9'})['id']
        root = self.data / 'users' / self.user['id'] / 'projects' / project
        version = 'draft-test'
        source = root / '.yingya/versions' / version
        source.mkdir(parents=True)
        (source / 'index.html').write_text('<html><body>render fixture</body></html>')
        (root / 'index.html').write_text('<html><body>persistent preview</body></html>')
        manifest_path = root / '.yingya/manifest.json'
        manifest = json.loads(manifest_path.read_text())
        manifest.update(phase='draft_review', dirty=True, currentDraft=version,
            versions=[{'id': version, 'label': 'fixture', 'sourcePath': f'.yingya/versions/{version}', 'videoPath': f'.yingya/versions/{version}/preview.mp4'}])
        manifest_path.write_text(json.dumps(manifest))
        job = str(uuid.uuid4())
        output = root / f'.yingya/exports/{version}-landscape-30fps-{job}.mp4'
        output.parent.mkdir(exist_ok=True)
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
            'color=c=black:s=16x16:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(output)], check=True)
        shutil.copy2(output, source / 'preview.mp4')
        # Simulate the crash window after output rename and before completion
        # registration. A rerender would fail: the fixture HyperFrames exits 1.
        (root / '.yingya/render-jobs.json').write_text(json.dumps([{
            'id': job, 'versionId': version, 'status': 'running', 'quality': 'high',
            'resolution': 'landscape', 'fps': 30, 'progress': 96, 'attempts': 1,
            'message': 'registering', 'startedAt': 1, 'updatedAt': 1}]))
        preview = self.request(f'/api/agent-projects/{project}/studio', {})['previewUrl']
        return project, job, output, hashlib.sha256(output.read_bytes()).hexdigest(), preview

    def test_rolling_handoff_crash_recovery_rollback_and_failed_candidate(self):
        self.release('v1')
        self.request('/api/auth/login', {'email': 'rolling@example.com', 'password': self.user['password']})
        project = self.request('/api/agent-projects', {'prompt': 'test', 'model': 'gpt-5.6-terra', 'reasoningEffort': 'high'})['id']
        prefix = '/api/agent-projects/' + project
        first = self.request(prefix + '/turns', {'text': 'WAIT original task', 'clientRequestId': str(uuid.uuid4())})
        self.wait(lambda: any(x['event'] == 'start' for x in self.log(project)))
        original = self.worker()
        errors, stop = [], threading.Event()
        def probe():
            while not stop.is_set():
                try:
                    with self.opener.open(self.base + '/health', timeout=2) as response:
                        if response.status != 200: errors.append(response.status)
                except Exception as error: errors.append(str(error))
                time.sleep(.03)
        monitoring = threading.Thread(target=probe)
        monitoring.start()
        try:
            self.release('v2')
            self.assertEqual(self.request('/health')['release'], 'v2')
            self.assertEqual(self.worker()['instance'], original['instance'], 'active task must keep its original worker')
            second = self.request(prefix + '/turns', {'text': 'second task', 'clientRequestId': str(uuid.uuid4())})
            self.assertEqual(second['status'], 'queued')
            self.wait(lambda: self.worker()['release'] == 'v2')
            self.wait(lambda: len([x for x in self.log(project) if x['event'] == 'done']) == 2)
            events = self.log(project)
            starts = [x for x in events if x['event'] == 'start']
            self.assertEqual([x['release'] for x in starts], ['v1', 'v2'])
            self.assertTrue(any(x['event'] == 'resume' and x['release'] == 'v2' for x in events))
            self.assertEqual(self.request('/static/v1.js'), b'const version="v1";')
            detail = self.request(prefix)
            self.assertTrue(all(next(m for m in detail['messages'] if m.get('turnId') == turn['turnId'])['status'] == 'completed' for turn in [first, second]))
            # Crash an actual worker process; original payload remains recoverable
            # and uncertain paid work must not be silently replayed.
            render_project, render_job, output, output_digest, preview = self.seed_completed_render()
            crash = self.request(prefix + '/turns', {'text': 'WAIT crash task', 'model': 'gpt-5.6-terra', 'reasoningEffort': 'high', 'clientRequestId': str(uuid.uuid4())})
            self.wait(lambda: len([x for x in self.log(project) if x['event'] == 'start']) == 3)
            victim = self.worker()
            pid = subprocess.check_output([self.tmux, '-L', self.socket, 'display-message', '-p', '-t', '=' + victim['session'] + ':', '#{pane_pid}'], text=True).strip()
            os.kill(int(pid), 9)
            self.wait(lambda: self.worker()['instance'] != victim['instance'])
            self.wait(lambda: any(j['id'] == render_job and j['status'] == 'completed' for j in self.request('/api/agent-projects/' + render_project)['renderJobs']))
            rendered = self.request('/api/agent-projects/' + render_project)
            self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), output_digest)
            self.assertEqual(len([a for a in rendered['manifest']['artifacts'] if a['id'] == 'final-' + render_job]), 1)
            cookie = self.cookie
            self.cookie = ''
            try:
                self.assertIn(b'persistent preview', self.request(preview))
            finally:
                self.cookie = cookie
            restored = self.request(prefix)
            self.assertTrue(restored['queuePaused'])
            self.assertEqual(restored['queue'][0]['id'], crash['turnId'])
            self.assertTrue(restored['queue'][0]['needsConfirmation'])
            self.assertEqual(len([x for x in self.log(project) if x['event'] == 'start']), 3)
            # Explicit resume continues the persisted conversation and consumes
            # the same durable request identity instead of appending a duplicate.
            self.request(prefix + '/resume', {}, method='POST')
            self.wait(lambda: len([x for x in self.log(project) if x['event'] == 'done']) == 3)
            self.release('v1')
            self.assertEqual(self.request('/health')['release'], 'v1')
            self.wait(lambda: self.worker()['release'] == 'v1')
            failed = self.release('bad', expect_success=False)
            self.assertIn('failed readiness', failed.stderr)
            self.assertEqual(self.request('/health')['release'], 'v1')
            with sqlite3.connect(self.data / 'deployment/registry.sqlite') as db:
                self.assertEqual(json.loads(db.execute('SELECT payload FROM target').fetchone()[0])['id'], 'v1')
        finally:
            stop.set()
            monitoring.join()
        self.assertEqual(errors, [], 'health probes must survive publication and rollback')

    def tearDown(self):
        if not self._outcome.success:
            print('Runtime test artifacts:', self.root, flush=True)
            result = subprocess.run([self.tmux, '-L', self.socket, 'list-sessions', '-F', '#{session_name}'], capture_output=True, text=True)
            for session in result.stdout.splitlines():
                subprocess.run([self.tmux, '-L', self.socket, 'capture-pane', '-pt', '=' + session + ':', '-S', '-40'])
        panes = subprocess.run([self.tmux, '-L', self.socket, 'list-panes', '-a', '-F', '#{pane_pid}'], capture_output=True, text=True)
        def descendants(pid):
            try:
                children = Path(f'/proc/{pid}/task/{pid}/children').read_text().split()
            except OSError:
                children = []
            result = []
            for child in children:
                result.extend(descendants(child))
            return result + [int(pid)]
        owned = []
        for pid in panes.stdout.splitlines():
            owned.extend(descendants(pid))
        for pid in owned:
            try:
                os.kill(pid, 9)
            except ProcessLookupError:
                pass
        subprocess.run([self.tmux, '-L', self.socket, 'kill-server'], capture_output=True)
        if os.environ.get("YINGYA_KEEP_TEST_ARTIFACTS"):
            print("Test artifacts:", self.root, flush=True)
        else:
            shutil.rmtree(self.root)


if __name__ == '__main__':
    unittest.main()
