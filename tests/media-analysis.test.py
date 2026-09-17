#!/usr/bin/env python3
"""Bounded real FFmpeg fixtures; no model, service, network or production data."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

RUNNER = Path(__file__).resolve().parents[1] / 'runtime/media-analysis.py'
spec = importlib.util.spec_from_file_location('media_analysis', RUNNER)
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)
FFMPEG = shutil.which('ffmpeg')
PYTHON = shutil.which('python3')


class MediaAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='yingya-media-analysis-')
        self.root = Path(self.temporary.name)
        self.project = self.root / 'project'
        (self.project / 'assets').mkdir(parents=True)
        self.source = self.project / 'assets/clip.mp4'

    def tearDown(self):
        self.temporary.cleanup()

    def video(self, duration=.5, color=None, audio=False, vfr=False, output=None):
        output = output or self.source
        pattern = ('color=c=%s:s=160x90:r=10:d=%s' % (color, duration) if color else
                   'testsrc2=s=160x90:r=10:d=%s' % duration)
        command = [FFMPEG, '-v', 'error', '-y', '-f', 'lavfi', '-i', pattern]
        if audio:
            command += ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=3', '-c:a', 'aac']
        if vfr:
            command += ['-vf', "setpts='if(lt(N,3),N/(10*TB),(0.3+(N-3)*0.2)/TB)'", '-vsync', 'vfr']
        command += ['-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', str(output)]
        subprocess.run(command, check=True, capture_output=True)
        return output

    def invoke(self, source='assets/clip.mp4', samples=3, env=None, extra=()):
        result = subprocess.run([PYTHON, str(RUNNER), '--project', str(self.project),
                                 '--source', source, '--samples', str(samples), '--width', '160',
                                 '--json', *extra], env=env, capture_output=True, text=True, timeout=15)
        return result, json.loads(result.stdout)

    def manifests(self):
        return list((self.project / '.yingya/media-analysis').glob('*/manifest.json'))

    def fake_tools(self, body):
        directory = self.root / 'fake-tools'
        directory.mkdir(exist_ok=True)
        for name in ('ffmpeg', 'ffprobe'):
            path = directory / name
            path.write_text('#!' + PYTHON + '\n' + body)
            path.chmod(0o755)
        return dict(os.environ, PATH=str(directory))

    def raw_frame(self, path, timestamp=None):
        command = [FFMPEG, '-v', 'error']
        if timestamp is not None:
            command += ['-ss', '%.6f' % timestamp]
        command += ['-i', str(path), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
        return subprocess.check_output(command)

    def test_short_video_timestamps_match_actual_source_frames(self):
        self.video()
        process, result = self.invoke()
        self.assertEqual(process.returncode, 0, result)
        self.assertFalse(result['media']['hasAudio'])
        self.assertFalse(result['semanticUnderstanding'])
        self.assertEqual(result['media']['durationSeconds'], .5)
        self.assertEqual([s['timestampSeconds'] for s in result['samples']], [.1, .3, .4])
        self.assertLess(result['samples'][-1]['seekErrorSeconds'], 0)
        for sample in result['samples']:
            self.assertEqual(self.raw_frame(self.project / sample['path']),
                             self.raw_frame(self.source, sample['timestampSeconds']))
        self.assertTrue((self.project / result['contactSheet']).is_file())

    def test_cache_hit_and_same_bytes_alias_never_invoke_media_tools(self):
        self.video()
        _, first = self.invoke()
        shutil.copyfile(self.source, self.project / 'assets/renamed.mp4')
        marker = self.root / 'unexpected-tool-call'
        env = self.fake_tools('from pathlib import Path\nPath(%r).write_text("called")\nraise SystemExit(97)\n' % str(marker))
        process, second = self.invoke(source='assets/renamed.mp4', env=env)
        self.assertEqual(process.returncode, 0, second)
        self.assertTrue(second['cacheHit'])
        self.assertEqual(first['source']['sha256'], second['source']['sha256'])
        self.assertEqual(first['contactSheet'], second['contactSheet'])
        self.assertEqual(second['source']['path'], 'assets/renamed.mp4')
        self.assertFalse(marker.exists())

    def test_source_and_sampling_change_invalidate_cache(self):
        self.video(color='red')
        _, first = self.invoke()
        self.video(color='blue')
        _, second = self.invoke()
        self.assertFalse(second['cacheHit'])
        self.assertNotEqual(first['source']['sha256'], second['source']['sha256'])
        _, third = self.invoke(samples=2)
        self.assertFalse(third['cacheHit'])
        self.assertNotEqual(second['manifest'], third['manifest'])

    def test_truncated_frame_and_missing_contact_sheet_are_not_cache_hits(self):
        self.video()
        _, first = self.invoke()
        frame = self.project / first['samples'][0]['path']
        frame.write_bytes(frame.read_bytes()[:40])
        _, second = self.invoke()
        self.assertFalse(second['cacheHit'])
        self.assertGreater(frame.stat().st_size, 40)
        (self.project / second['contactSheet']).unlink()
        _, third = self.invoke()
        self.assertFalse(third['cacheHit'])
        self.assertTrue((self.project / third['contactSheet']).is_file())
        manifest = self.project / third['manifest']
        old = json.loads(manifest.read_text())
        old['analysisVersion'] = 'obsolete'
        manifest.write_text(json.dumps(old))
        _, fourth = self.invoke()
        self.assertFalse(fourth['cacheHit'])
        self.assertEqual(fourth['analysisVersion'], analysis.ANALYSIS_VERSION)

    def test_single_frame_video_has_valid_repeated_samples(self):
        self.video(duration=.1)
        process, result = self.invoke(samples=4)
        self.assertEqual(process.returncode, 0, result)
        self.assertEqual([s['timestampSeconds'] for s in result['samples']], [0, 0, 0, 0])
        self.assertEqual(len(result['samples']), 4)

    def test_vfr_and_longer_audio_use_video_stream_duration(self):
        self.video(duration=1, audio=True, vfr=True)
        process, result = self.invoke(samples=4)
        self.assertEqual(process.returncode, 0, result)
        media = result['media']
        self.assertTrue(media['hasAudio'])
        self.assertLess(media['durationSeconds'], 2)
        self.assertNotEqual(media['fps']['average'], media['fps']['nominal'])
        for sample in result['samples']:
            self.assertLess(sample['timestampSeconds'], media['durationSeconds'])
            self.assertEqual(self.raw_frame(self.project / sample['path']),
                             self.raw_frame(self.source, sample['timestampSeconds']))

    def test_matroska_uses_video_packets_when_stream_duration_missing(self):
        source = self.video(output=self.project / 'assets/clip.mkv', audio=True)
        process, result = self.invoke(source=str(source.relative_to(self.project)))
        self.assertEqual(process.returncode, 0, result)
        self.assertEqual(result['media']['durationBasis'], 'video-packet-end-minus-stream-start')
        # This muxer shifts some video PTS for AAC priming; the actual final
        # video packet ends at .564s, while the audio/container runs past 3s.
        self.assertAlmostEqual(result['media']['durationSeconds'], .564, places=2)

    def test_offset_video_stream_seeks_absolute_pts_but_reports_relative_times(self):
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-itsoffset', '1', '-f', 'lavfi', '-i',
                        'testsrc2=s=160x90:r=10:d=0.5', '-f', 'lavfi', '-i',
                        'sine=sample_rate=16000:duration=3', '-c:v', 'libx264', '-threads', '1',
                        '-c:a', 'aac', '-vsync', '0', str(self.source)], check=True, capture_output=True)
        process, result = self.invoke()
        self.assertEqual(process.returncode, 0, result)
        self.assertEqual(result['media']['startTimeSeconds'], 1)
        self.assertEqual([s['timestampSeconds'] for s in result['samples']], [.1, .3, .4])
        self.assertEqual([s['sourcePtsSeconds'] for s in result['samples']], [1.1, 1.3, 1.4])
        for sample in result['samples']:
            self.assertEqual(self.raw_frame(self.project / sample['path']),
                             self.raw_frame(self.source, sample['sourcePtsSeconds']))

    def test_rotation_and_nonsquare_pixels_report_display_dimensions_and_normalize_frames(self):
        self.video()
        rotated = self.project / 'assets/rotated.mp4'
        subprocess.run([FFMPEG, '-v', 'error', '-i', str(self.source), '-c', 'copy',
                        '-metadata:s:v:0', 'rotate=90', str(rotated)], check=True, capture_output=True)
        process, result = self.invoke(source='assets/rotated.mp4')
        self.assertEqual(process.returncode, 0, result)
        media = result['media']
        self.assertEqual((media['codedWidth'], media['codedHeight']), (160, 90))
        self.assertEqual((media['width'], media['height']), (90, 160))
        self.assertEqual(media['rotationDegrees'], 90)
        dimensions = analysis.png_info(self.project / result['samples'][0]['path'])
        self.assertAlmostEqual(dimensions[0] / dimensions[1], 90 / 160, places=2)
        anamorphic = self.project / 'assets/anamorphic.mp4'
        subprocess.run([FFMPEG, '-v', 'error', '-i', str(self.source), '-vf', 'setsar=2/1',
                        '-c:v', 'libx264', '-threads', '1', str(anamorphic)], check=True, capture_output=True)
        process, result = self.invoke(source='assets/anamorphic.mp4')
        self.assertEqual(process.returncode, 0, result)
        self.assertEqual((result['media']['width'], result['media']['height']), (320, 90))
        self.assertEqual(analysis.png_info(self.project / result['samples'][0]['path']), (160, 45))

    def test_empty_bad_and_audio_only_media_publish_no_cache(self):
        for data in (b'', b'not a media file'):
            self.source.write_bytes(data)
            process, result = self.invoke()
            self.assertNotEqual(process.returncode, 0)
            self.assertFalse(result['ok'])
            self.assertFalse(self.manifests())
        audio = self.project / 'assets/audio.wav'
        subprocess.run([FFMPEG, '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.1', str(audio)],
                       check=True, capture_output=True)
        _, result = self.invoke(source='assets/audio.wav')
        self.assertEqual(result['error']['code'], 'UNSUPPORTED_MEDIA')
        self.assertFalse(self.manifests())

    def test_zero_video_duration_is_rejected_even_with_long_container(self):
        raw = json.dumps({'streams': [{'index': 0, 'codec_type': 'video', 'width': 160,
                                      'height': 90, 'duration': '0'}], 'format': {'duration': '50'}}).encode()
        with patch.object(analysis, 'run_tool', return_value=(raw, '')):
            with self.assertRaises(analysis.AnalysisError) as error:
                analysis.video_metadata(0, time.monotonic() + 2)
        self.assertEqual(error.exception.code, 'MEDIA_INVALID')

    def test_absolute_traversal_source_and_cache_symlinks_are_rejected(self):
        self.video()
        (self.project / 'assets/link.mp4').symlink_to(self.source)
        (self.project / 'alias').symlink_to(self.project / 'assets', target_is_directory=True)
        for source in (str(self.source), '../project/assets/clip.mp4', 'assets/link.mp4', 'alias/clip.mp4'):
            process, result = self.invoke(source=source)
            self.assertNotEqual(process.returncode, 0, source)
            self.assertEqual(result['error']['code'], 'PATH_INVALID', result)
        (self.project / '.yingya').symlink_to(self.root, target_is_directory=True)
        _, result = self.invoke()
        self.assertEqual(result['error']['code'], 'PATH_INVALID')
        self.assertFalse((self.root / 'media-analysis').exists())

    def test_external_transcript_reference_is_hashed_but_not_claimed_valid(self):
        self.video()
        (self.project / 'words.srt').write_text('unverified external transcript')
        process, result = self.invoke(extra=('--transcript', 'words.srt'))
        self.assertEqual(process.returncode, 0, result)
        self.assertEqual(result['transcript']['status'], 'external-reference-not-generated-or-validated')
        self.assertEqual(result['transcript']['path'], 'words.srt')

    def test_nonzero_tool_exit_and_timeout_leave_no_published_or_partial_cache(self):
        self.video()
        for body, expected in [('raise SystemExit(7)\n', 'TOOL_FAILED'),
                               ('import time\ntime.sleep(20)\n', 'TOOL_TIMEOUT')]:
            env = self.fake_tools(body)
            start = time.monotonic()
            process, result = self.invoke(env=env, extra=('--timeout', '1'))
            self.assertNotEqual(process.returncode, 0)
            self.assertEqual(result['error']['code'], expected)
            self.assertLess(time.monotonic() - start, 4)
            self.assertFalse(self.manifests())
            self.assertFalse([p for p in (self.project / '.yingya/media-analysis').iterdir() if p.is_dir()])

    def test_parameter_limits_are_checked_before_decode(self):
        self.video()
        for extra in (('--samples', '0'), ('--samples', '17'), ('--width', '9000'), ('--timeout', '0')):
            _, result = self.invoke(extra=extra)
            self.assertEqual(result['error']['code'], 'ARGUMENT_INVALID')
            self.assertFalse(self.manifests())

    def test_partial_or_failed_frame_generation_never_publishes_success(self):
        self.video()
        for exit_code in (0, 7):
            env = self.fake_tools('''import os, sys
from pathlib import Path
if Path(sys.argv[0]).name == 'ffprobe':
    os.execv(%r, [%r, *sys.argv[1:]])
Path(sys.argv[-1]).write_bytes(b'partial PNG')
print('[Parsed_showinfo_0] n: 0 pts: 1 pts_time:0.1', file=sys.stderr)
raise SystemExit(%d)
''' % (shutil.which('ffprobe'), shutil.which('ffprobe'), exit_code))
            process, result = self.invoke(env=env)
            self.assertNotEqual(process.returncode, 0, result)
            self.assertFalse(self.manifests())
            self.assertFalse([p for p in (self.project / '.yingya/media-analysis').iterdir() if p.is_dir()])


if __name__ == '__main__':
    unittest.main()
