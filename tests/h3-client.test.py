"""Exercise the bundled client against an isolated HTTP service/proxy."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / 'skills/minimax-h3-local/scripts/h3.py'


class H3Client(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.status = 'queued'
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                owner.requests.append((self.command, self.path, None))
                self.send_response(200)
                self.end_headers()
                if self.path.endswith('/video'):
                    self.wfile.write(b'test-video-bytes')
                else:
                    self.wfile.write(json.dumps({'status': 'completed', 'id': 'job-1'}).encode())

            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                owner.requests.append((self.command, self.path, body))
                if owner.status == 'disconnect':
                    self.close_connection = True
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'id': 'job-1', 'status': owner.status,
                                            'video_url': '/api/jobs/job-1/video'}).encode())

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = {k: v for k, v in os.environ.items() if 'proxy' not in k.lower()}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def run_client(self, *args, env=None, base=None):
        return subprocess.run(['python3', str(CLIENT), '--url', base or self.base, *args],
                              env=env or self.env, capture_output=True, text=True, timeout=10)

    def config(self):
        return json.loads(self.requests[0][2].split(b'\r\n\r\n', 1)[1].split(b'\r\n', 1)[0])

    def test_frames_upload_and_profile_defaults(self):
        first = self.root / 'first.png'
        first.write_bytes(b'first-frame-bytes')
        prompt = self.root / 'prompt.txt'
        prompt.write_text('完整镜头动作与声音。', encoding='utf-8')
        result = self.run_client('generate', '--mode', 'frames', '--first-frame', str(first),
                                 '--prompt-file', str(prompt), '--duration', '4')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['id'], 'job-1')
        config = self.config()
        self.assertEqual(config['prompt'], prompt.read_text())
        self.assertEqual(config['mode'], 'frames')
        self.assertNotIn('steps', config)
        self.assertNotIn('flow_shift', config)
        self.assertNotIn('quality', config)
        self.assertIn(b'name="first_frame"', self.requests[0][2])
        self.assertIn(first.read_bytes(), self.requests[0][2])

    def test_reference_order_and_explicit_sampler(self):
        refs = [self.root / 'person.png', self.root / 'scene.png']
        for i, path in enumerate(refs):
            path.write_bytes(f'image-{i}'.encode())
        result = self.run_client('generate', '--mode', 'reference', '--prompt', 'References',
                                 '--reference', str(refs[0]), '--reference', str(refs[1]),
                                 '--steps', '8', '--flow-shift', '6', '--quality', 'lossless')
        self.assertEqual(result.returncode, 0, result.stderr)
        body = self.requests[0][2]
        self.assertLess(body.index(b'person.png'), body.index(b'scene.png'))
        self.assertEqual(body.count(b'name="references"'), 2)
        self.assertEqual(self.config()['steps'], 8)
        self.assertEqual(self.config()['flow_shift'], 6)

    def test_invalid_modes_and_ranges_never_submit(self):
        for args in [('--mode', 'frames'), ('--mode', 'reference'), ('--duration', '3'),
                     ('--seed', '-1'), ('--steps', '99'), ('--first-frame', 'x', '--reference', 'y'),
                     ('--mode', 'text', '--first-frame', 'x')]:
            with self.subTest(args=args):
                result = self.run_client('generate', '--prompt', 'test', *args)
                self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.requests, [])

    def test_sandbox_proxy_is_used(self):
        env = dict(self.env, http_proxy=self.base, HTTP_PROXY=self.base, no_proxy='', NO_PROXY='')
        result = self.run_client('health', env=env, base='http://140.143.229.103:8910')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.requests[0][1], 'http://140.143.229.103:8910/api/health')

    def test_completed_download_and_no_overwrite(self):
        self.status = 'completed'
        output = self.root / 'result.mp4'
        result = self.run_client('generate', '--prompt', 'test', '--wait', '--output', str(output))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output.read_bytes(), b'test-video-bytes')
        result = self.run_client('download', 'job-1', '--output', str(output))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(output.read_bytes(), b'test-video-bytes')
        self.assertFalse(output.with_suffix('.mp4.part').exists())

    def test_wait_timeout_retains_original_job(self):
        result = self.run_client('generate', '--prompt', 'test', '--wait', '--timeout', '0')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)['id'], 'job-1')
        self.assertIn('Do not resubmit', result.stderr)
        self.assertEqual(len(self.requests), 1)

    def test_lost_submission_response_does_not_retry(self):
        self.status = 'disconnect'
        result = self.run_client('generate', '--prompt', 'test')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('server acceptance is unknown', result.stderr)
        self.assertEqual(len(self.requests), 1)

    def test_failed_job_is_not_downloaded(self):
        self.status = 'failed'
        result = self.run_client('generate', '--prompt', 'test', '--wait')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.requests), 1)


if __name__ == '__main__':
    unittest.main()
