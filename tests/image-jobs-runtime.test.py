#!/usr/bin/env python3
"""Real isolated APIs, persistence and rolling workers; model outputs are fixtures."""
import importlib.util
import json
import socket
import subprocess
import time
import unittest
import urllib.error
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location('rolling', Path(__file__).with_name('rolling-runtime.test.py'))
rolling = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rolling)

class ImageJobsRuntime(rolling.RollingRuntime):
    def test_image_jobs_survive_disconnect_and_release(self):
        self.release('v1')
        self.request('/api/auth/login', {'email': self.user['email'], 'password': self.user['password']})
        path = '/api/assets/image-jobs'
        payload = dict(clientRequestId=str(uuid.uuid4()), prompt='IMAGE_JOB_SLOW 一只猫', referenceImages=[], model='gpt-6.1-sol', reasoningEffort='medium')
        start = time.monotonic()
        accepted = self.request(path, payload)
        self.assertLess(time.monotonic() - start, 3, 'HTTP returns while the model continues')
        self.assertEqual(accepted['status'], 'running')
        self.assertEqual(self.request(path, payload)['id'], accepted['id'])
        self.assertEqual(len(self.request(path)), 1)
        with self.assertRaises(urllib.error.HTTPError) as conflict:
            self.request(path, dict(payload, prompt='different'))
        self.assertEqual(conflict.exception.code, 409)
        with self.assertRaises(urllib.error.HTTPError) as invalid:
            self.request(path, dict(payload, clientRequestId=str(uuid.uuid4()), model='invalid'))
        self.assertEqual(invalid.exception.code, 422)

        # Another authenticated user sees neither the job nor a scoped URL to it.
        other = json.loads(subprocess.check_output([str(rolling.BINARY), 'admin-create', 'imageother', 'other@example.test'], env=self.env, cwd=rolling.REPO, text=True))
        self.request('/api/auth/login', {'email': other['email'], 'password': other['password']})
        self.assertEqual(self.request(path), [])
        with self.assertRaises(urllib.error.HTTPError):
            self.request('/api/u/' + self.user['id'] + '/assets/image-jobs')
        self.request('/api/auth/login', {'email': self.user['email'], 'password': self.user['password']})

        self.release('v2')
        self.assertEqual(self.worker()['release'], 'v1', 'running image keeps the old worker alive')
        completed = self.wait(lambda: next((job for job in self.request(path) if job['status'] == 'completed'), None), timeout=50)
        self.wait(lambda: self.worker()['release'] == 'v2')
        self.assertEqual(len(self.request(path)), 1)
        self.assertEqual(completed['prompt'], payload['prompt'])
        library = self.request('/api/assets/library')['assets']
        self.assertIn(completed['images'][0]['id'], [asset['id'] for asset in library])
        self.assertTrue(self.request(completed['images'][0]['url']).startswith(b'\x89PNG'))

        # A legacy caller (reference-image dialog) can close its long HTTP request.
        thread = self.request('/api/codex/threads', {})['threadId']
        body = json.dumps(dict(payload, prompt='IMAGE_JOB_FAST legacy')).encode()
        with socket.create_connection(('127.0.0.1', self.port)) as connection:
            connection.sendall((f'POST /api/codex/threads/{thread}/images HTTP/1.1\r\nHost: localhost\r\nCookie: {self.cookie}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n').encode() + body)
            time.sleep(.3)
        self.wait(lambda: len([j for j in self.request(path) if j['status'] == 'completed']) == 2)
        failed = self.request(path, dict(payload, clientRequestId=str(uuid.uuid4()), prompt='IMAGE_JOB_FAIL retained input'))
        self.wait(lambda: any(j['id'] == failed['id'] and j['status'] == 'failed' and j['error'] for j in self.request(path)))
        self.assertEqual(len(self.request(path)), 3)
        self.assertEqual(len(self.request('/api/assets/library')['assets']), 2)

if __name__ == '__main__':
    suite = unittest.TestSuite([ImageJobsRuntime('test_image_jobs_survive_disconnect_and_release')])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
