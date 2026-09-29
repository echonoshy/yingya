#!/usr/bin/env python3
"""Real subprocess/lock/report tests; isolated fake Remotion CLI never calls a provider."""
import json
import hashlib
import importlib.util
import os
from pathlib import Path
import signal
import shutil
import subprocess
import tempfile
import time
import unittest

RUNNER = Path(__file__).resolve().parents[1] / 'runtime/production-task.py'
SPEC = importlib.util.spec_from_file_location('production_task', RUNNER)
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


class ProductionTask(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='yingya-production-')
        self.root = Path(self.temporary.name)
        self.project = self.root / 'project'
        self.project.mkdir()
        (self.project / 'index.html').write_text('<main>fixture</main>')
        self.runner = self.root / 'runtime/production-task.py'
        self.runner.parent.mkdir()
        shutil.copy2(RUNNER, self.runner)
        self.config = dict(schemaVersion=1, engine='remotion', entry='src/Video.tsx',
            composition=dict(id='main', width=320, height=180, fps=30, durationInFrames=6), media=[])
        self.save_config()
        binary = self.root / 'runtime/remotion/fake.py'
        binary.parent.mkdir(parents=True)
        binary.write_text('''#!/usr/bin/python3
import json, os, sys, time, subprocess, signal, hashlib
from pathlib import Path
with open(os.environ['FAKE_COUNT'], 'a') as f: f.write(sys.argv[1] + '\\n')
print('diagnostic warning', file=sys.stderr, flush=True)
if os.environ.get('FAKE_GRANDCHILD'):
    descendant = os.fork()
    if descendant == 0:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        time.sleep(30)
        os._exit(0)
    Path(os.environ['FAKE_GRANDCHILD']).write_text(str(descendant))
time.sleep(float(os.environ.get('FAKE_DELAY', '0')))
if os.environ.get('FAKE_CHANGE'): Path('index.html').write_text('changed while running')
if sys.argv[1] == 'check':
    print('invalid' if os.environ.get('FAKE_INVALID') else json.dumps({'ok': True, 'samples': 10}))
else:
    output = sys.argv[sys.argv.index('--output') + 1]
    if os.environ.get('FAKE_ARGS'): Path(os.environ['FAKE_ARGS']).write_text(json.dumps(sys.argv))
    sizes = {'landscape':'1920x1080','portrait':'1080x1920','square':'1080x1080',
             'landscape-4k':'3840x2160','portrait-4k':'2160x3840','square-4k':'2160x2160'}
    resolution = sys.argv[sys.argv.index('--resolution')+1] if '--resolution' in sys.argv else None
    config = json.loads(Path('remotion.json').read_text())
    width = sys.argv[sys.argv.index('--width')+1] if '--width' in sys.argv else str(config['composition']['width'])
    height = sys.argv[sys.argv.index('--height')+1] if '--height' in sys.argv else str(config['composition']['height'])
    size = os.environ.get('FAKE_SIZE') or width+'x'+height
    fps = sys.argv[sys.argv.index('--fps')+1] if '--fps' in sys.argv else str(config['composition']['fps'])
    command = ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s='+size+':d=0.2:r='+fps]
    if os.environ.get('FAKE_OUTPUT_AUDIO'):
        command += ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'aac']
    subprocess.run(command + ['-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', output], check=True)
    receipt = dict(schemaVersion=1, engine='remotion', composition=config['composition'],
        renderedFrames=config['composition']['durationInFrames'],
        outputSha256=hashlib.sha256(Path(output).read_bytes()).hexdigest(),
        media=[dict(id=c['id'],path=c['src'],sha256=hashlib.sha256(Path(c['src']).read_bytes()).hexdigest()) for c in config['media']])
    if os.environ.get('FAKE_BAD_RECEIPT'): receipt['renderedFrames'] = 0
    if not os.environ.get('FAKE_NO_RECEIPT'): print(json.dumps({'yingyaRemotion':receipt}), flush=True)
sys.exit(int(os.environ.get('FAKE_EXIT', '0')))
''')
        binary.chmod(0o755)
        self.cli = binary.with_name('cli.mjs')
        self.cli.write_text("import {spawnSync} from 'node:child_process'; import {fileURLToPath} from 'node:url'; const result=spawnSync('python3',[fileURLToPath(new URL('./fake.py',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit'}); process.exit(result.status ?? 1);")
        self.env = dict(os.environ, FAKE_COUNT=str(self.root / 'count'))

    def save_config(self):
        (self.project / 'remotion.json').write_text(json.dumps(self.config))

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, kind='check', request='request', output='.yingya/reports/check-test.json'):
        return ['python3', str(self.runner), kind, '--project', str(self.project), '--request-id', request,
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
        job = self.status()[0]
        report = json.loads((self.project / job['renderVerification']).read_text())
        self.assertTrue(report['ok'])
        self.assertTrue(report['requiresVisualReview'])
        self.assertEqual(report['sourceMedia']['declaredVideoCount'], 0)
        self.assertEqual(report['engine'], 'remotion')
        self.assertEqual(report['outputSha256'], hashlib.sha256((self.project / 'renders/test.mp4').read_bytes()).hexdigest())
        self.assertGreaterEqual(len(report['frames']), 3)
        for frame in report['frames']:
            self.assertEqual(frame['sha256'], hashlib.sha256((self.project / frame['path']).read_bytes()).hexdigest())
        # Review evidence is part of the receipt, not a replaceable old screenshot.
        (self.project / report['frames'][0]['path']).write_bytes(b'old unrelated image')
        third = subprocess.run(cmd, env=self.env, capture_output=True, text=True)
        self.assertNotEqual(third.returncode, 0)
        self.assertEqual((self.root / 'count').read_text().splitlines(), ['render'])

    def capture_command(self, output='renders/capture.mp4', resolution='landscape'):
        return ['python3', str(self.runner), 'capture', '--project', str(self.project),
                '--request-id', 'capture', '--output', output, '--resolution', resolution, '--fps', '30']




    def test_capture_cancellation_and_parent_loss_stop_owned_process_and_clean_temp(self):
        for parent_loss in (False, True):
            with self.subTest(parent_loss=parent_loss):
                # The controller is a distinct owner so we can kill it without
                # terminating the test process; capture must detect parent loss.
                pidfile = self.root/f'pid-{parent_loss}'
                argsfile = self.root/f'args-{parent_loss}'
                output = f'renders/cancel-{parent_loss}.mp4'
                command = self.capture_command(output=output)
                if parent_loss:
                    script = 'import subprocess,time,pathlib; p=subprocess.Popen('+repr(command)+'); pathlib.Path('+repr(str(pidfile))+').write_text(str(p.pid)); time.sleep(30)'
                    owner = subprocess.Popen(['python3','-c',script], env=dict(self.env, FAKE_DELAY='30', FAKE_ARGS=str(argsfile)), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                else:
                    owner = subprocess.Popen(command, env=dict(self.env, FAKE_DELAY='30', FAKE_ARGS=str(argsfile)), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    deadline = time.monotonic()+5
                    while (not (self.root/'count').exists() or (parent_loss and not pidfile.exists())) and time.monotonic()<deadline:
                        time.sleep(.05)
                    owner.kill() if parent_loss else owner.terminate()
                    owner.communicate(timeout=7)
                    self.assertFalse((self.project/output).exists())
                    # Child stdout/stderr reaching EOF proves the capture/renderer
                    # descendants released the pipes after the owner died.
                finally:
                    if owner.poll() is None: owner.kill()
                    owner.communicate()
                (self.root/'count').unlink(missing_ok=True)

    def test_capture_cancel_kills_group_after_renderer_leader_exits_on_term(self):
        pidfile = self.root/'grandchild.pid'
        owner = subprocess.Popen(self.capture_command(), env=dict(self.env, FAKE_DELAY='30',
                                 FAKE_GRANDCHILD=str(pidfile)), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        descendant = None
        try:
            deadline = time.monotonic()+5
            while not pidfile.exists() and time.monotonic()<deadline:
                time.sleep(.05)
            self.assertTrue(pidfile.exists())
            descendant = int(pidfile.read_text())
            owner.terminate()
            # The TERM-ignoring grandchild keeps both pipes open if it survives.
            owner.communicate(timeout=4)
            status = Path(f'/proc/{descendant}/stat')
            self.assertTrue(not status.exists() or status.read_text().split()[2] == 'Z')
            self.assertFalse((self.project/'renders/capture.mp4').exists())
        finally:
            if owner.poll() is None: owner.kill()
            if descendant:
                try: os.kill(descendant, signal.SIGKILL)
                except ProcessLookupError: pass
            owner.communicate()











    def test_cancel_also_stops_export_decode_and_does_not_publish(self):
        tools = self.root / 'tools'
        tools.mkdir()
        real_ffmpeg = shutil.which('ffmpeg')
        wrapper = tools / 'ffmpeg'
        wrapper.write_text('#!/usr/bin/python3\nimport os,sys,time\nfrom pathlib import Path\n'
                           'if "-xerror" in sys.argv:\n Path(os.environ["POST_STARTED"]).touch()\n time.sleep(32)\n'
                           'os.execv(' + repr(real_ffmpeg) + ',[' + repr(real_ffmpeg) + ']+sys.argv[1:])\n')
        wrapper.chmod(0o755)
        started = self.root / 'post-started'
        env = dict(self.env, PATH=str(tools) + os.pathsep + self.env['PATH'], POST_STARTED=str(started))
        child = subprocess.Popen(self.command('render', output='renders/cancelled.mp4'), env=env,
                                 stdout=subprocess.PIPE, text=True)
        try:
            json.loads(child.stdout.readline())
            deadline = time.monotonic() + 5
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(.05)
            self.assertTrue(started.exists())
            subprocess.run(self.command('cancel'), env=self.env, capture_output=True, check=True)
            self.assertEqual(child.wait(timeout=7), 130)
            self.assertEqual(self.status()[0]['status'], 'cancelled')
            self.assertFalse((self.project / 'renders/cancelled.mp4').exists())
        finally:
            if child.poll() is None:
                child.kill()
            child.wait()
            child.stdout.close()

    def ui_command(self, kind, request='ui-export'):
        return ['python3', str(self.runner), kind, '--project', str(self.project), '--source', '.',
                '--output', 'renders/ui.mp4', '--request-id', request]

    def prepare_ui_export(self, **options):
        before = subprocess.run(self.ui_command('fingerprint'), env=self.env, capture_output=True, text=True)
        self.assertEqual(before.returncode, 0, before.stdout)
        value = json.loads(before.stdout)
        logs = self.project / '.yingya/reports/render-jobs/ui-export'
        logs.mkdir(parents=True)
        temporary = self.project / 'renders/pending.mp4'
        temporary.parent.mkdir()
        with (logs / 'stdout.log').open('w') as stdout, (logs / 'stderr.log').open('w') as stderr:
            subprocess.run(['node', str(self.cli), 'render', '--output', str(temporary)],
                           cwd=self.project, env=dict(self.env, **options), stdout=stdout, stderr=stderr, check=True)
        return value

    def verify_ui(self, before, final=False, request='ui-export'):
        return subprocess.run(self.ui_command('verify', request) + [
            '--source-fingerprint', before['sourceFingerprint'],
            '--input', 'renders/ui.mp4' if final else 'renders/pending.mp4',
            '--stdout', '.yingya/reports/render-jobs/ui-export/stdout.log',
            '--stderr', '.yingya/reports/render-jobs/ui-export/stderr.log'],
            env=self.env, capture_output=True, text=True)

    def test_standalone_verify_binds_final_path_before_atomic_rename_and_recovery(self):
        before = self.prepare_ui_export()
        result = self.verify_ui(before)
        self.assertEqual(result.returncode, 0, result.stdout)
        value = json.loads(result.stdout)
        report = json.loads((self.project / value['report']).read_text())
        self.assertEqual(report['output'], 'renders/ui.mp4')
        self.assertEqual(report['requestId'], 'ui-export')
        self.assertFalse((self.project / 'renders/ui.mp4').exists())
        (self.project / 'renders/pending.mp4').replace(self.project / 'renders/ui.mp4')
        recovery = self.verify_ui(before, final=True)
        self.assertEqual(recovery.returncode, 0, recovery.stdout)
        self.assertTrue(json.loads(recovery.stdout)['reused'])
        self.assertEqual(json.loads(recovery.stdout)['report'], value['report'])
        # Tampered review evidence causes fresh MP4 verification, never reuse.
        (self.project / report['frames'][0]['path']).write_bytes(b'old screenshot')
        renewed = self.verify_ui(before, final=True)
        self.assertEqual(renewed.returncode, 0, renewed.stdout)
        self.assertFalse(json.loads(renewed.stdout)['reused'])
        self.assertNotEqual(json.loads(renewed.stdout)['report'], value['report'])

    def test_standalone_verify_rejects_source_drift_and_cannot_replace_before_receipt(self):
        before = self.prepare_ui_export()
        original = (self.project / before['before']).read_bytes()
        (self.project / 'index.html').write_text('<main>different</main>')
        verify = self.verify_ui(before)
        self.assertNotEqual(verify.returncode, 0, verify.stdout)
        another = subprocess.run(self.ui_command('fingerprint'), env=self.env, capture_output=True, text=True)
        self.assertNotEqual(another.returncode, 0, another.stdout)
        self.assertEqual((self.project / before['before']).read_bytes(), original)
        self.assertFalse((self.project / 'renders/ui.mp4').exists())


    def test_standalone_recovery_requires_original_before_receipt(self):
        before = self.prepare_ui_export()
        (self.project / 'renders/pending.mp4').replace(self.project / 'renders/ui.mp4')
        (self.project / before['before']).unlink()
        result = self.verify_ui(before, final=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        fingerprint = subprocess.run(self.ui_command('fingerprint'), env=self.env, capture_output=True, text=True)
        self.assertNotEqual(fingerprint.returncode, 0, fingerprint.stdout)
        self.assertFalse((self.project / before['before']).exists())

    def test_referenced_assets_in_ignored_directories_still_change_fingerprint(self):
        snapshots = self.project / 'snapshots'
        snapshots.mkdir()
        (self.project / 'index.html').write_text('<link href="snapshots/style.css"><img src="snapshots/hero.png">')
        (snapshots / 'style.css').write_text('body{background:url(../check-background.svg)}')
        (snapshots / 'hero.png').write_bytes(b'first image')
        (self.project / 'check-background.svg').write_text('<svg/>')
        first = subprocess.run(self.ui_command('fingerprint'), capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stdout)
        before = json.loads((self.project / json.loads(first.stdout)['before']).read_text())
        self.assertIn('snapshots/hero.png', before['files'])
        self.assertIn('check-background.svg', before['files'])
        (snapshots / 'hero.png').write_bytes(b'new image')
        second = subprocess.run(self.ui_command('fingerprint'), capture_output=True, text=True)
        self.assertNotEqual(second.returncode, 0, second.stdout)

    def test_requirements_are_inputs_and_frozen_snapshots_override_current_project(self):
        state = self.project / '.yingya'
        state.mkdir()
        requirement_file = state / 'requirements.json'
        requirement_file.write_text(json.dumps({'subtitles': 'none'}))
        first, files = RUNTIME.fingerprint(self.project, self.project / 'renders/out.mp4')
        self.assertIn('.yingya/requirements.json', files)
        requirement_file.write_text(json.dumps({'subtitles': 'auto'}))
        second, _ = RUNTIME.fingerprint(self.project, self.project / 'renders/out.mp4')
        self.assertNotEqual(first, second)
        snapshot = self.project / 'snapshot'
        snapshot.mkdir()
        (snapshot / 'requirements.json').write_text(json.dumps({'subtitles': 'none'}))
        binding = dict(requirements={'subtitles': 'none'}, requirementsFile='requirements.json',
                       requirementsSha256=RUNTIME.digest(snapshot / 'requirements.json'))
        self.assertEqual(RUNTIME.frozen_requirements(self.project, snapshot, binding)['subtitles'], 'none')
        with self.assertRaisesRegex(ValueError, '已变化'):
            RUNTIME.frozen_requirements(snapshot, snapshot, binding)
        (snapshot / 'requirements.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, '不一致'):
            RUNTIME.frozen_requirements(self.project, snapshot, binding)

    def test_export_enforces_duration_and_mute_requirements(self):
        with self.assertRaisesRegex(ValueError, '目标秒数'):
            RUNTIME.normalize_requirements({'durationMode':'exact'})
        declarations = dict(videos=[], audios=[], captions=[])
        silent = dict(streams=[dict(codec_type='video')])
        for request, duration, message in [
                ({'durationMode':'exact', 'targetDurationSeconds':4}, 3, '时长'),
                ({'durationMode':'max', 'targetDurationSeconds':4}, 5, '时长')]:
            with self.subTest(request=request), self.assertRaisesRegex(ValueError, message):
                RUNTIME.validate_requirements(self.project, RUNTIME.normalize_requirements(request),
                                              declarations, None, silent, duration, 30)
        RUNTIME.validate_requirements(self.project, RUNTIME.normalize_requirements(
            {'durationMode':'target', 'targetDurationSeconds':4}), declarations, None, silent, 3, 30)
        with self.assertRaisesRegex(ValueError, '音轨'):
            RUNTIME.validate_requirements(self.project, RUNTIME.normalize_requirements({'audioMode':'mute'}),
                declarations, None, dict(streams=[dict(codec_type='audio')]), 4, 30)

    def test_custom_snapshot_manifest_freezes_requirements_and_invalidates_reuse(self):
        snapshot = self.project / '.yingya/versions/custom-1'
        snapshot.mkdir(parents=True)
        (snapshot / 'index.html').write_text('<main>custom or ReactBits composition</main>')
        (self.project / '.yingya/requirements.json').write_text(json.dumps({'audioMode':'preserve'}))
        required = {'durationMode':'exact', 'targetDurationSeconds':10, 'audioMode':'mute'}
        manifest = snapshot / 'manifest.json'
        manifest.write_text(json.dumps({'outputSpec':{'requirements':required}}))
        resolved = RUNTIME.frozen_requirements(self.project, snapshot, None)
        self.assertEqual(resolved['audioMode'], 'mute')
        self.assertEqual(resolved['targetDurationSeconds'], 10)
        before, files = RUNTIME.fingerprint(snapshot, snapshot / 'final.mp4')
        self.assertEqual(files['manifest.json'], RUNTIME.digest(manifest))
        declarations = dict(videos=[], audios=[], captions=[])
        with self.assertRaisesRegex(ValueError, '时长'):
            RUNTIME.validate_requirements(snapshot, resolved, declarations, None, {'streams':[]}, 5, 30)
        with self.assertRaisesRegex(ValueError, '音轨'):
            RUNTIME.validate_requirements(snapshot, resolved, declarations, None,
                                          {'streams':[{'codec_type':'audio'}]}, 10, 30)
        manifest.write_text(json.dumps({'outputSpec':{'requirements':{'audioMode':'auto'}}}))
        after, _ = RUNTIME.fingerprint(snapshot, snapshot / 'final.mp4')
        self.assertNotEqual(before, after)
        state = snapshot / '.yingya'
        state.mkdir()
        (state / 'manifest.json').write_text(json.dumps({'outputSpec':{'requirements':{'audioMode':'narration'}}}))
        self.assertEqual(RUNTIME.project_requirements(snapshot)['audioMode'], 'narration')
        (state / 'requirements.json').write_text(json.dumps({'audioMode':'replace'}))
        self.assertEqual(RUNTIME.project_requirements(snapshot)['audioMode'], 'replace')
        for item in [state / 'requirements.json', state / 'manifest.json', manifest]:
            item.unlink()
        # A legacy bundle stays auto; the current project's preserve does not
        # retroactively become the version's requirement.
        self.assertEqual(RUNTIME.frozen_requirements(self.project, snapshot, None)['audioMode'], 'auto')

    def test_required_audio_is_not_satisfied_by_source_track_or_role_without_media(self):
        req = RUNTIME.normalize_requirements({'audioMode':'narration'})
        media = dict(streams=[dict(codec_type='audio')])
        with self.assertRaisesRegex(ValueError, '尚未完成'):
            RUNTIME.validate_requirements(self.project, req, dict(videos=[], audios=[], captions=[]), None, media, 4, 30)
        (self.project / 'voice.wav').write_bytes(b'not actual audio')
        self.config['media'] = [dict(id='voice',type='audio',src='voice.wav',from_=0, durationInFrames=30,trimBefore=0,volume=1,role='narration')]
        self.config['media'][0]['from'] = self.config['media'][0].pop('from_')
        self.save_config()
        with self.assertRaisesRegex(ValueError, '没有可读取音轨'):
            RUNTIME.validate_requirements(self.project, req, RUNTIME.source_media(self.project), None, media, 4, 30)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
                        str(self.project / 'voice.wav')], check=True)
        declaration = RUNTIME.source_media(self.project)
        with self.assertRaisesRegex(ValueError, '源录屏'):
            RUNTIME.validate_requirements(self.project, req, declaration, {'sourcePaths':['voice.wav']}, media, 4, 30)
        result = RUNTIME.validate_requirements(self.project, req, declaration, None, media, 4, 30)
        self.assertEqual(result['audioWork'][0]['role'], 'narration')
        self.assertFalse(result['audioWork'][0]['semanticVerified'])
        with self.assertRaisesRegex(ValueError, '尚未完成'):
            RUNTIME.validate_requirements(self.project, req, declaration, None, {'streams':[]}, 4, 30)

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

    def test_missing_or_unknown_engine_never_starts_renderer(self):
        for engine in (None, 'unsupported'):
            if engine is None:
                (self.project / 'remotion.json').unlink()
            else:
                self.config['engine'] = engine
                self.save_config()
            result = self.run_job()
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((self.root / 'count').exists())

    def test_native_capture_scales_without_mutating_source_and_rejects_wrong_size(self):
        before = (self.project / 'remotion.json').read_bytes()
        plan = RUNTIME.capture_plan(self.project, 'landscape')
        self.assertEqual(plan['target'], [1920,1080])
        self.assertEqual(plan['mode'], 'remotion')
        with self.assertRaisesRegex(ValueError, 'aspect ratio'):
            RUNTIME.capture_plan(self.project, 'portrait')
        result = subprocess.run(self.capture_command(), env=dict(self.env, FAKE_SIZE='16x16'), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('capture dimensions', result.stderr)
        self.assertFalse((self.project / 'renders/capture.mp4').exists())
        self.assertEqual((self.project / 'remotion.json').read_bytes(), before)

    def test_export_requires_matching_renderer_receipt(self):
        for flag in ['FAKE_NO_RECEIPT', 'FAKE_BAD_RECEIPT']:
            result = subprocess.run(self.command('render',request=flag,output='renders/'+flag+'.mp4'),
                env=dict(self.env, **{flag:'1'}), capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((self.project / ('renders/'+flag+'.mp4')).exists())
            self.assertIn('Remotion renderer completion', self.status(flag)[0]['message'])

    def test_remotion_media_schedule_is_the_only_source_of_media(self):
        (self.project / 'index.html').write_text('<video src="unused.mp4"></video>')
        self.config['media'] = [dict(id='clip',type='video',src='assets/source.mp4',
            durationInFrames=6,trimBefore=3,volume=0,muted=True,**{'from':0})]
        self.save_config()
        media = RUNTIME.source_media(self.project)
        self.assertEqual(media['declaredVideoCount'], 1)
        self.assertEqual(media['videos'][0]['sources'], ['assets/source.mp4'])
        self.assertEqual(media['videos'][0]['attributes']['data-media-start'], .1)


if __name__ == '__main__':
    unittest.main()
