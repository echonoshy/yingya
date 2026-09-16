import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import wave


spec = importlib.util.spec_from_file_location('video_audit', Path(__file__).resolve().parents[1] / 'runtime/video-audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class VideoDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.report = self.root / 'check.json'
        report = {'ok': True, **{gate: {'ok': True, 'errorCount': 0} for gate in ['lint', 'runtime', 'layout', 'contrast']}}
        report['contrast']['enabled'] = True
        report['motion'] = {'ok': True, 'enabled': True, 'samples': 3, 'errorCount': 0}
        self.report.write_text(json.dumps(report))

    def tearDown(self):
        self.temporary.cleanup()

    def source(self, audio='', scenes=None, extra=''):
        (self.root / 'index.html').write_text(f'<main data-composition-id="main" data-start="0" data-duration="8" {extra}>{audio}</main>')
        (self.root / 'scenes.json').write_text(json.dumps(scenes or []))

    def voice(self, name='voice.wav', duration=6):
        with wave.open(str(self.root / name), 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\x00\x20' * (16000 * duration))

    def render(self, blank=False, audio=False):
        output = self.root / 'video.mp4'
        args = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                'color=c=white:s=160x90:r=10:d=8' if blank else 'testsrc2=s=160x90:r=10:d=8']
        if audio:
            args += ['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '8', '-c:a', 'aac']
        args += ['-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', str(output)]
        subprocess.run(args, check=True, capture_output=True)
        return output

    def test_mate_placeholder_audio_and_disabled_timeline_are_rejected(self):
        self.voice()
        self.source(''.join(f'<audio id="a{i}" src="voice.wav" data-start="0" data-duration="1"></audio>' for i in range(2)),
                    [{'id': 'one', 'narration': '第一幕'}, {'id': 'two', 'narration': '第二幕'}], 'data-no-timeline')
        result = audit.audit(self.root, self.report)
        self.assertFalse(result['ok'])
        self.assertTrue(any('截成' in issue for issue in result['issues']))
        self.assertTrue(any('重叠' in issue for issue in result['issues']))
        self.assertTrue(any('data-no-timeline' in issue for issue in result['issues']))

    def test_duration_attribute_cannot_stretch_narration(self):
        self.voice(duration=4)
        self.source('<audio id="voice" src="voice.wav" data-start="0" data-duration="8"></audio>', [{'narration': '完整旁白'}])
        self.assertTrue(any('只有 4.00 秒' in issue for issue in audit.audit(self.root, self.report)['issues']))

    def test_deleting_motion_sidecar_does_not_pass_multiscene_delivery(self):
        self.source(scenes=[{'id': 'one'}, {'id': 'two'}])
        # Even preserving an old passing report must not hide a deleted sidecar.
        self.assertFalse(audit.audit(self.root, self.report)['ok'])
        report = json.loads(self.report.read_text())
        report['motion'] = {'ok': True, 'enabled': False, 'samples': 0, 'errorCount': 0}
        self.report.write_text(json.dumps(report))
        self.assertFalse(audit.audit(self.root, self.report)['ok'])

    def test_valid_silent_video_is_allowed(self):
        self.source()
        self.assertTrue(audit.audit(self.root, self.report, self.render())['ok'])

    def test_rendered_uniform_blank_is_rejected(self):
        self.source()
        result = audit.audit(self.root, self.report, self.render(blank=True))
        self.assertTrue(any('空白画面' in issue for issue in result['issues']))

    def test_silent_render_during_expected_narration_is_rejected(self):
        self.voice()
        self.source('<audio id="voice" src="voice.wav" data-start="0" data-duration="6"></audio>', [{'narration': '完整旁白'}])
        result = audit.audit(self.root, self.report, self.render(audio=True))
        self.assertTrue(any('静音' in issue for issue in result['issues']))

    def test_local_composition_offset_added_once_and_plain_section_not_added(self):
        nodes = audit.Composition('<main data-composition-id="main" data-start="0"><section data-start="4"><audio data-start="4"></audio></section><div data-composition-id="child" data-start="3"><audio data-start="1"></audio></div></main>').nodes
        starts = [audit.number(a['data-start']) + offset for tag, a, offset in nodes if tag == 'audio']
        self.assertEqual(starts, [4, 4])

    def test_missing_local_snapshot_dependency_is_rejected(self):
        self.source('<img src="missing.png">')
        with self.assertRaises(audit.AuditError):
            audit.audit(self.root, self.report)

    def test_log_polluted_report_is_not_a_passing_report(self):
        self.source()
        self.report.write_text('warning\n' + self.report.read_text())
        self.assertFalse(audit.audit(self.root, self.report)['ok'])


if __name__ == '__main__':
    unittest.main()
