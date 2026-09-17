#!/usr/bin/env python3
"""Real subprocess/lock/report tests; fake HyperFrames never calls a provider."""
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
        binary = self.root / 'node_modules/.bin/hyperframes'
        binary.parent.mkdir(parents=True)
        binary.write_text('''#!/usr/bin/python3
import json, os, sys, time, subprocess, signal
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
    if os.environ.get('FAKE_MEDIA_COUNT') is not None:
        count = int(os.environ['FAKE_MEDIA_COUNT'])
        print('[INFO] Compiled composition metadata ' + json.dumps({'renderJobId':'fixture', 'videoCount':count}), flush=True)
        if not os.environ.get('FAKE_NO_EXTRACTION'):
            print('[INFO] [Render:trace] ' + json.dumps({'renderJobId':'fixture', 'phase':'video_extract',
                'status':'checkpoint','videoCount':count,
                'extractedVideoCount':int(os.environ.get('FAKE_EXTRACTED_COUNT',str(count))),
                'totalFramesExtracted':count*5,
                'minVideoFrameCoverageRatio':float(os.environ.get('FAKE_COVERAGE','1'))}), flush=True)
    sizes = {'landscape':'1920x1080','portrait':'1080x1920','square':'1080x1080',
             'landscape-4k':'3840x2160','portrait-4k':'2160x3840','square-4k':'2160x2160'}
    resolution = sys.argv[sys.argv.index('--resolution')+1] if '--resolution' in sys.argv else None
    size = os.environ.get('FAKE_SIZE') or sizes.get(resolution, os.environ.get('FAKE_NATIVE', '16x16'))
    fps = sys.argv[sys.argv.index('--fps')+1] if '--fps' in sys.argv else '25'
    command = ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s='+size+':d=0.2:r='+fps]
    if os.environ.get('FAKE_OUTPUT_AUDIO'):
        command += ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'aac']
    subprocess.run(command + ['-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', output], check=True)
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
        job = self.status()[0]
        report = json.loads((self.project / job['renderVerification']).read_text())
        self.assertTrue(report['ok'])
        self.assertTrue(report['requiresVisualReview'])
        self.assertEqual(report['sourceMedia']['declaredVideoCount'], 0)
        self.assertFalse(report['compiledMedia']['known'])
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
        return ['python3', str(RUNNER), 'capture', '--project', str(self.project),
                '--request-id', 'capture', '--output', output, '--resolution', resolution, '--fps', '30']

    def test_resolution_plan_preserves_source_and_selects_supported_capture(self):
        for size, resolution, mode, chosen in [
                ((1280,720),'landscape','supersample-downsample','landscape-4k'),
                ((720,1280),'portrait','supersample-downsample','portrait-4k'),
                ((1920,1080),'landscape','direct','landscape'),
                ((1280,720),'landscape-4k','direct','landscape-4k'),
                ((3840,2160),'landscape','native-downsample',None),
                ((2160,2160),'square','native-downsample',None),
                ((1000,1000),'square','native-upscale',None)]:
            with self.subTest(size=size, resolution=resolution):
                (self.project/'index.html').write_text(f'<main data-composition-id="main" data-width="{size[0]}" data-height="{size[1]}"></main>')
                before = (self.project/'index.html').read_bytes()
                plan = RUNTIME.capture_plan(self.project, resolution)
                self.assertEqual((plan['mode'], plan['captureResolution']), (mode, chosen))
                self.assertEqual((self.project/'index.html').read_bytes(), before)
        with self.assertRaisesRegex(ValueError, 'aspect ratio'):
            RUNTIME.capture_plan(self.project, 'landscape')

    def test_capture_720_to_1080_keeps_audio_source_and_complete_hf_diagnostics(self):
        (self.project/'index.html').write_text('<main data-composition-id="main" data-width="1280" data-height="720"></main>')
        output = self.project/'renders/capture.mp4'
        before = RUNTIME.fingerprint(self.project, output)[0]
        result = subprocess.run(self.capture_command(), env=dict(self.env, FAKE_OUTPUT_AUDIO='1',
                                FAKE_MEDIA_COUNT='1', FAKE_ARGS=str(self.root/'args.json')), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        args = json.loads((self.root/'args.json').read_text())
        self.assertEqual(args[args.index('--resolution')+1], 'landscape-4k')
        log = self.root/'render.log'
        log.write_text(result.stdout)
        diagnostics = RUNTIME.render_diagnostics([log])
        evidence = diagnostics['capture']
        self.assertEqual(diagnostics['extraction']['extractedVideoCount'], 1)
        self.assertEqual(evidence['captureSize'], [3840,2160])
        self.assertEqual(evidence['outputSize'], [1920,1080])
        self.assertEqual(evidence['audioPolicy'], 'stream-copy')
        self.assertEqual(evidence['outputAudioCount'], 1)
        self.assertEqual(evidence['outputSha256'], RUNTIME.digest(output))
        self.assertEqual(RUNTIME.fingerprint(self.project, output)[0], before)
        self.assertFalse(Path(args[args.index('--output')+1]).exists())

    def test_capture_native_downsample_and_wrong_actual_output_fail_safely(self):
        (self.project/'index.html').write_text('<main data-composition-id="main" data-width="3840" data-height="2160"></main>')
        result = subprocess.run(self.capture_command(), env=dict(self.env, FAKE_NATIVE='3840x2160',
                                FAKE_ARGS=str(self.root/'args.json')), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('--resolution', json.loads((self.root/'args.json').read_text()))
        result = subprocess.run(self.capture_command(output='renders/invalid.mp4'),
                                env=dict(self.env, FAKE_SIZE='16x16'), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('capture dimensions', result.stderr)
        self.assertFalse((self.project/'renders/invalid.mp4').exists())

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
                    # Child stdout/stderr reaching EOF proves the capture/HF
                    # descendants released the pipes after the owner died.
                finally:
                    if owner.poll() is None: owner.kill()
                    owner.communicate()
                (self.root/'count').unlink(missing_ok=True)

    def test_capture_cancel_kills_group_after_hf_leader_exits_on_term(self):
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

    def test_referenced_dynamic_slot_cannot_export_zero_compiled_videos(self):
        (self.project / 'index.html').write_text('''<div data-composition-src="camera.html"></div>
<template data-slot="screen"><video src="source.mp4"></video></template>''')
        (self.project / 'camera.html').write_text('''<template><main>camera</main><script>
document.querySelector('template[data-slot="screen"]');</script></template>''')
        result = subprocess.run(self.command('render', output='renders/invalid.mp4'),
                                env=dict(self.env, FAKE_MEDIA_COUNT='0'), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        job = self.status()[0]
        self.assertIn('videoCount=0', job['message'])
        report = json.loads((self.project / job['renderVerification']).read_text())
        self.assertFalse(report['ok'])
        self.assertEqual(report['sourceMedia']['declaredVideoCount'], 1)
        self.assertFalse((self.project / 'renders/invalid.mp4').exists())

    def test_unused_templates_and_components_do_not_turn_animation_into_video_project(self):
        (self.project / 'index.html').write_text('<main>animation</main><template data-slot="unused"><video src="unused.mp4"></video></template>')
        (self.project / 'unused-component.html').write_text('<video src="unreferenced.mp4"></video>')
        result = subprocess.run(self.command('render', output='renders/animation.mp4'),
                                env=dict(self.env, FAKE_MEDIA_COUNT='0'), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        report = json.loads((self.project / self.status()[0]['renderVerification']).read_text())
        self.assertEqual(report['sourceMedia']['declaredVideoCount'], 0)
        self.assertTrue(report['ok'])

    def test_video_export_requires_known_complete_extraction_even_after_check_passes(self):
        (self.project / 'index.html').write_text('<video src="source.mp4"></video>')
        self.assertEqual(self.run_job().returncode, 0)
        cases = [{}, {'FAKE_MEDIA_COUNT':'1', 'FAKE_NO_EXTRACTION':'1'},
                 {'FAKE_MEDIA_COUNT':'1', 'FAKE_EXTRACTED_COUNT':'0'},
                 {'FAKE_MEDIA_COUNT':'1', 'FAKE_COVERAGE':'.8'}]
        for index, options in enumerate(cases):
            with self.subTest(options=options):
                result = subprocess.run(self.command('render', request='render'+str(index), output=f'renders/invalid-{index}.mp4'),
                                        env=dict(self.env, **options), capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                job = self.status('render'+str(index))[0]
                self.assertFalse((self.project / f'renders/invalid-{index}.mp4').exists())
                report = json.loads((self.project / job['renderVerification']).read_text())
                self.assertFalse(report['ok'])
                if not options:
                    self.assertFalse(report['compiledMedia']['known'])
                    self.assertIn('未知', job['message'])

    def test_complete_video_extraction_creates_report_bound_to_real_mp4(self):
        (self.project / 'index.html').write_text('<div data-composition-src="scene.html"></div>')
        (self.project / 'scene.html').write_text('<template><video src="source.mp4"></video></template>')
        result = subprocess.run(self.command('render', output='renders/media.mp4'),
                                env=dict(self.env, FAKE_MEDIA_COUNT='1'), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        job = self.status()[0]
        report = json.loads((self.project / job['renderVerification']).read_text())
        self.assertEqual(report['jobId'], job['id'])
        self.assertEqual(report['requestId'], 'request')
        self.assertEqual(report['sourceFingerprint'], job['sourceFingerprint'])
        self.assertEqual(report['outputSha256'], job['outputSha256'])
        self.assertEqual(report['compiledMedia']['extraction']['minVideoFrameCoverageRatio'], 1)
        # Crash recovery cannot use a missing verification report to bless an MP4.
        (self.project / job['renderVerification']).unlink()
        job['status'] = 'publishing'
        (self.project / '.yingya/production-jobs' / (job['id'] + '.json')).write_text(json.dumps(job))
        self.assertEqual(self.status()[0]['status'], 'lost')

    def write_source_bindings(self):
        assets = self.project / 'assets/editorial'
        assets.mkdir(parents=True)
        source = assets / 'source.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=0.2',
                        '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', str(source)], check=True)
        entry = self.project / 'index.html'
        entry.write_text('<video id="clip-one" src="assets/editorial/source.mp4" data-start="0" '
                         'data-duration="0.2" data-media-start="0" muted></video>')
        scenes = json.dumps([{'id':'one', 'sourceClip':{'source':'assets/editorial/source.mp4',
                              'sourceIn':0, 'sourceOut':.2, 'audioMode':'mute'}}]).encode()
        (self.project / 'scenes.json').write_bytes(scenes)
        (assets / 'scenes.snapshot.json').write_bytes(scenes)
        sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        binding = dict(schemaVersion=1, generator='yingya-editorial:v1', entry='index.html',
            entrySha256=sha(entry), scenesFile='assets/editorial/scenes.snapshot.json',
            scenesSha256=hashlib.sha256(scenes).hexdigest(), originScenesFile='scenes.json',
            durationSeconds=.2, scenes=[dict(id='one', videoId='clip-one', startSeconds=0,
                durationSeconds=.2, sourceIn=0, sourceOut=.2, audioMode='mute',
                source={'path':'assets/editorial/source.mp4','sha256':sha(source)},
                mediaSrc='assets/editorial/source.mp4')])
        (self.project / 'source-bindings.json').write_text(json.dumps(binding))
        return binding

    def test_source_bindings_match_export_and_add_actual_scene_review_frames(self):
        self.write_source_bindings()
        result = subprocess.run(self.command('render', output='renders/bound.mp4'),
                                env=dict(self.env, FAKE_MEDIA_COUNT='1'), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        report = json.loads((self.project / self.status()[0]['renderVerification']).read_text())
        self.assertEqual(report['sourceBindings']['scenes'][0]['sourceIn'], 0)
        self.assertIn(.1, [frame['time'] for frame in report['frames']])
        self.assertTrue(report['requiresVisualReview'])

    def test_styled_entry_remains_editable_but_media_timing_cannot_drift(self):
        binding = self.write_source_bindings()
        entry = self.project / 'index.html'
        entry.write_text('<style>body{font-family:sans-serif;color:#123456}</style>' + entry.read_text())
        styled = subprocess.run(self.command('render', request='styled', output='renders/styled.mp4'),
                                env=dict(self.env, FAKE_MEDIA_COUNT='1'), capture_output=True, text=True)
        self.assertEqual(styled.returncode, 0, styled.stdout)
        report = json.loads((self.project / self.status('styled')[0]['renderVerification']).read_text())
        self.assertTrue(report['sourceBindings']['entryModified'])
        self.assertEqual(report['sourceBindings']['assembledEntrySha256'], binding['entrySha256'])
        self.assertEqual(report['sourceBindings']['currentEntrySha256'], hashlib.sha256(entry.read_bytes()).hexdigest())
        entry.write_text(entry.read_text().replace('data-media-start="0"', 'data-media-start="0.1"'))
        drift = subprocess.run(self.command('render', request='drift', output='renders/drift.mp4'),
                               env=dict(self.env, FAKE_MEDIA_COUNT='1'), capture_output=True, text=True)
        self.assertNotEqual(drift.returncode, 0, drift.stdout)
        self.assertIn('data-media-start', self.status('drift')[0]['message'])

    def test_stale_bindings_cannot_validate_a_new_render(self):
        binding = self.write_source_bindings()
        cases = [
            ('entry', lambda: (self.project / 'index.html').write_text('<main>changed entry</main>')),
            ('source', lambda: (self.project / 'assets/editorial/source.mp4').write_bytes(b'changed source')),
            ('scenes', lambda: (self.project / 'scenes.json').write_text('[]')),
            ('snapshot', lambda: (self.project / 'assets/editorial/scenes.snapshot.json').write_text('[]')),
            ('node-time', lambda: binding['scenes'][0].update(sourceIn=.05, sourceOut=.25)),
        ]
        files = {p: p.read_bytes() for p in self.project.rglob('*') if p.is_file()}
        for name, mutate in cases:
            with self.subTest(name=name):
                for path, value in files.items():
                    path.write_bytes(value)
                binding = json.loads((self.project / 'source-bindings.json').read_text())
                mutate()
                if name == 'node-time':
                    (self.project / 'source-bindings.json').write_text(json.dumps(binding))
                result = subprocess.run(self.command('render', request=name, output=f'renders/{name}.mp4'),
                                        env=dict(self.env, FAKE_MEDIA_COUNT='1'), capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertFalse((self.project / f'renders/{name}.mp4').exists())
                job = self.status(name)[0]
                self.assertEqual(job['status'], 'failed')
                self.assertFalse(json.loads((self.project / job['renderVerification']).read_text())['ok'])

    def test_preserved_audio_uses_paired_audio_node_and_must_exist_in_export(self):
        binding = self.write_source_bindings()
        source = self.project / 'assets/editorial/source.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=s=16x16:d=0.2',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'aac',
                        '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', str(source)], check=True)
        entry = self.project / 'index.html'
        entry.write_text(entry.read_text() + '<audio id="one-audio" src="assets/editorial/source.mp4" '
                         'data-start="0" data-duration="0.2" data-media-start="0"></audio>')
        binding['entrySha256'] = hashlib.sha256(entry.read_bytes()).hexdigest()
        binding['scenes'][0]['source']['sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        binding['scenes'][0]['audioMode'] = 'preserve'
        (self.project / 'source-bindings.json').write_text(json.dumps(binding))
        result = subprocess.run(self.command('render', request='with-audio', output='renders/with-audio.mp4'),
                                env=dict(self.env, FAKE_MEDIA_COUNT='1', FAKE_OUTPUT_AUDIO='1'), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        report = json.loads((self.project / self.status('with-audio')[0]['renderVerification']).read_text())
        self.assertEqual(report['sourceBindings']['expectedAudioCount'], 1)
        missing = subprocess.run(self.command('render', request='missing-audio', output='renders/missing-audio.mp4'),
                                 env=dict(self.env, FAKE_MEDIA_COUNT='1'), capture_output=True, text=True)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn('实际导出没有音轨', self.status('missing-audio')[0]['message'])

    def test_long_audio_container_does_not_extend_short_video_source_range(self):
        binding = self.write_source_bindings()
        source = self.project / 'assets/editorial/short-video.mkv'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=0.2',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.6', '-c:a', 'aac',
                        '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', str(source)], check=True)
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)]))
        self.assertNotIn('duration', next(s for s in probe['streams'] if s['codec_type'] == 'video'))
        self.assertGreater(float(probe['format']['duration']), .5)
        entry = self.project / 'index.html'
        entry.write_text('<video id="clip-one" src="assets/editorial/short-video.mkv" data-start="0" '
                         'data-duration="0.4" data-media-start="0" muted></video>')
        binding['entrySha256'] = hashlib.sha256(entry.read_bytes()).hexdigest()
        binding['durationSeconds'] = .4
        binding['scenes'][0].update(durationSeconds=.4, sourceOut=.4, mediaSrc='assets/editorial/short-video.mkv')
        binding['scenes'][0]['source'] = {'path':'assets/editorial/short-video.mkv', 'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
        (self.project / 'source-bindings.json').write_text(json.dumps(binding))
        result = subprocess.run(self.command('render', output='renders/too-long.mp4'),
                                env=dict(self.env, FAKE_MEDIA_COUNT='1'), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('超过实际源视频时长', self.status()[0]['message'])

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
        return ['python3', str(RUNNER), kind, '--project', str(self.project), '--source', '.',
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
            subprocess.run([self.env['YINGYA_NODE_MODULES'] + '/.bin/hyperframes', 'render', '--output', str(temporary)],
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

    def test_standalone_verify_rejects_zero_video_and_rechecks_changed_logs(self):
        (self.project / 'index.html').write_text('<video src="source.mp4"></video>')
        before = self.prepare_ui_export(FAKE_MEDIA_COUNT='1')
        self.assertEqual(self.verify_ui(before).returncode, 0)
        log = self.project / '.yingya/reports/render-jobs/ui-export/stdout.log'
        log.write_text('[INFO] Compiled composition metadata ' + json.dumps({'renderJobId':'fixture', 'videoCount':0}))
        result = self.verify_ui(before)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('videoCount=0', result.stdout)
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

    def test_export_enforces_duration_mute_and_marked_caption_requirements(self):
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
        (self.project / 'index.html').write_text('<div class="editorial-caption">新增说明</div><svg data-editorial-overlay="screen-callout"></svg>')
        with self.assertRaisesRegex(ValueError, '说明字幕'):
            RUNTIME.validate_requirements(self.project, RUNTIME.normalize_requirements({'subtitles':'none'}),
                RUNTIME.source_media(self.project), None, silent, 4, 30)
        (self.project / 'index.html').write_text('<h1>用户明确标题</h1><svg data-editorial-overlay="screen-callout"></svg>')
        RUNTIME.validate_requirements(self.project, RUNTIME.normalize_requirements({'subtitles':'none'}),
            RUNTIME.source_media(self.project), None, silent, 4, 30)

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
        (self.project / 'index.html').write_text('<audio id="voice" src="voice.wav" data-editorial-audio-role="narration" data-duration="1"></audio>')
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


if __name__ == '__main__':
    unittest.main()
