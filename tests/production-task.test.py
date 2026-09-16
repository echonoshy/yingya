#!/usr/bin/env python3
"""Real subprocess/lock/report tests; fake HyperFrames never calls a provider."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest

RUNNER = Path(__file__).resolve().parents[1] / 'runtime/production-task.py'


class ProductionTask(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='yingya-production-')
        self.root = Path(self.temporary.name)
        self.project = self.root / 'project'
        self.project.mkdir()
        (self.project / 'index.html').write_text('<main>fixture</main>')
        binary = self.root / 'node_modules/.bin/hyperframes'
        binary.parent.mkdir(parents=True)
        binary.write_text('''#!/usr/bin/python3
import json, os, sys, time, subprocess
from pathlib import Path
with open(os.environ['FAKE_COUNT'], 'a') as f: f.write(sys.argv[1] + '\\n')
print('diagnostic warning', file=sys.stderr, flush=True)
time.sleep(float(os.environ.get('FAKE_DELAY', '0')))
if os.environ.get('FAKE_CHANGE'): Path('index.html').write_text('changed while running')
if sys.argv[1] == 'check':
    print('invalid' if os.environ.get('FAKE_INVALID') else json.dumps({'ok': True, 'samples': 10}))
else:
    output = sys.argv[sys.argv.index('--output') + 1]
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=0.2',
                    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', output], check=True)
sys.exit(int(os.environ.get('FAKE_EXIT', '0')))
''')
        binary.chmod(0o755)
        self.env = dict(os.environ, YINGYA_NODE_MODULES=str(binary.parents[1]), FAKE_COUNT=str(self.root / 'count'))

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, kind='check', request='request', output='.yingya/reports/check-test.json'):
        return ['python3', str(RUNNER), kind, '--project', str(self.project), '--request-id', request,
                *(['--output', output, '--continue-workflow'] if kind in ('check', 'render') else [])]

    def run_job(self, **env):
        return subprocess.run(self.command(), env=dict(self.env, **env), capture_output=True, text=True)

    def status(self, request='request'):
        return json.loads(subprocess.check_output(self.command('status', request), env=self.env))['jobs']

    def test_long_silent_job_is_queryable_and_duplicate_does_not_restart(self):
        child = subprocess.Popen(self.command(), env=dict(self.env, FAKE_DELAY='32'), stdout=subprocess.PIPE, text=True)
        try:
            receipt = json.loads(child.stdout.readline())
            self.assertEqual(receipt['status'], 'running')
            self.assertIsNone(receipt['exitCode'])
            time.sleep(.7)
            duplicate = self.run_job()
            self.assertEqual(duplicate.returncode, 75)
            self.assertEqual(self.status()[0]['status'], 'running')
            self.assertFalse((self.project / '.yingya/reports/check-test.json').exists())
            self.assertEqual(child.wait(timeout=40), 0)
            self.assertEqual(self.status()[0]['status'], 'succeeded')
            self.assertTrue(json.loads((self.project / '.yingya/reports/check-test.json').read_text())['ok'])
            self.assertIn('diagnostic warning', (self.project / receipt['stderr']).read_text())
            self.assertEqual(self.run_job().returncode, 0)
            self.assertEqual((self.root / 'count').read_text().splitlines(), ['check'])
            # A local asset change invalidates reuse even when index.html did not change.
            (self.project / 'asset.svg').write_text('<svg/>')
            self.assertNotEqual(self.run_job().returncode, 0)
            self.assertEqual((self.root / 'count').read_text().splitlines(), ['check'])
        finally:
            if child.poll() is None: child.kill()
            child.wait()
            child.stdout.close()

    def test_failure_does_not_publish_and_preserves_real_exit_code(self):
        result = self.run_job(FAKE_EXIT='7')
        self.assertEqual(result.returncode, 7)
        self.assertEqual(self.status()[-1]['exitCode'], 7)
        self.assertFalse((self.project / '.yingya/reports/check-test.json').exists())

    def test_malformed_report_and_changed_source_are_not_published(self):
        self.assertNotEqual(self.run_job(FAKE_INVALID='1').returncode, 0)
        self.assertNotEqual(self.run_job(FAKE_CHANGE='1').returncode, 0)
        self.assertFalse((self.project / '.yingya/reports/check-test.json').exists())

    def test_cancel_stops_owned_job_and_prevents_restart_of_same_request(self):
        child = subprocess.Popen(self.command(), env=dict(self.env, FAKE_DELAY='32'), stdout=subprocess.PIPE, text=True)
        try:
            json.loads(child.stdout.readline())
            subprocess.run(self.command('cancel'), env=self.env, capture_output=True, check=True)
            self.assertEqual(child.wait(timeout=7), 130)
            self.assertEqual(self.status()[0]['status'], 'cancelled')
            self.assertEqual(self.run_job().returncode, 130)
            self.assertFalse((self.project / '.yingya/reports/check-test.json').exists())
        finally:
            if child.poll() is None: child.kill()
            child.wait()
            child.stdout.close()

    def test_render_is_atomic_and_can_be_reused(self):
        cmd = self.command('render', output='renders/test.mp4')
        first = subprocess.run(cmd, env=self.env, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stdout)
        second = subprocess.run(cmd, env=self.env, capture_output=True, text=True)
        self.assertEqual(second.returncode, 0, second.stdout)
        self.assertEqual((self.root / 'count').read_text().splitlines(), ['render'])
        self.assertTrue((self.project / 'renders/test.mp4').stat().st_size > 100)

    def test_wrapper_crash_does_not_unlock_a_still_running_child(self):
        child = subprocess.Popen(self.command(), env=dict(self.env, FAKE_DELAY='3'), stdout=subprocess.PIPE, text=True)
        try:
            json.loads(child.stdout.readline())
            deadline = time.monotonic() + 3
            while not (self.root / 'count').exists() and time.monotonic() < deadline:
                time.sleep(.05)
            child.kill()
            child.wait()
            self.assertEqual(self.status()[0]['status'], 'running')
            self.assertEqual(self.run_job().returncode, 75)
            time.sleep(3.2)
            self.assertEqual(self.status()[0]['status'], 'lost')
            self.assertEqual((self.root / 'count').read_text().splitlines(), ['check'])
        finally:
            if child.poll() is None: child.kill()
            child.wait()
            child.stdout.close()

    def test_published_output_can_be_recovered_and_lost_process_is_not_running(self):
        self.assertEqual(self.run_job().returncode, 0)
        job = self.status()[0]
        path = self.project / '.yingya/production-jobs' / (job['id'] + '.json')
        job['status'] = 'publishing'
        path.write_text(json.dumps(job))
        self.assertEqual(self.status()[0]['status'], 'succeeded')
        self.assertEqual(self.run_job().returncode, 0)
        job['status'] = 'running'
        path.write_text(json.dumps(job))
        self.assertEqual(next(j for j in self.status() if j['id'] == job['id'])['status'], 'lost')
        self.assertEqual((self.root / 'count').read_text().splitlines(), ['check'])


if __name__ == '__main__':
    unittest.main()
