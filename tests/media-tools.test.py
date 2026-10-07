import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
spec = importlib.util.spec_from_file_location('captions_tool', ROOT / 'runtime/captions.py')
captions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(captions)
from media_io import digest, project_file


class MediaTools(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='yingya-media-tools-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / 'assets').mkdir()
        self.source = self.root / 'assets/music.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
                        '-c:a', 'pcm_s16le', str(self.source)], check=True)

    def tool(self, tool, *args, ok=True):
        result = subprocess.run([sys.executable, str(ROOT / 'runtime' / tool), *args,
                                 '--project', str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, ok, result.stderr)
        return json.loads(result.stdout if ok else result.stderr)

    def test_paths_refuse_symlinks_and_traversal(self):
        (self.root / 'escape').symlink_to('/tmp')
        for path in ['../outside', '/tmp/file', 'escape/file']:
            with self.assertRaises(ValueError):
                project_file(self.root, path, exists=False)

    def test_sentence_groups_use_word_boundaries_and_preserve_real_gaps(self):
        words = [{'text':'第一句。','start':.2,'end':1.1}, {'text':'第二句','start':1.9,'end':2.8},
                 {'text':'结束。','start':2.8,'end':3.4}]
        result = captions.sentence_captions(words)
        self.assertEqual(result, [{'text':'第一句。','startMs':200,'endMs':1100},
                                  {'text':'第二句结束。','startMs':1900,'endMs':3400}])
        captions.validate_captions(result, 3.5)
        for bad in [[dict(result[0], endMs=100)], [dict(result[0], endMs=float('nan'))],
                    [result[0], dict(result[1], startMs=1000)], [dict(result[0], endMs=5000)]]:
            with self.assertRaises(ValueError):
                captions.validate_captions(bad, 3.5)

    def test_caption_validation_binds_source_and_srt_refuses_overwrite(self):
        data = {'source':'assets/music.wav','sourceSha256':digest(self.source),
                'captions':[{'text':'计时示例','startMs':120,'endMs':900}]}
        (self.root/'assets/captions.json').write_text(json.dumps(data))
        report = self.tool('captions.py','check','--input','assets/captions.json')
        self.assertFalse(report['semanticVerified'])
        self.tool('captions.py','export-srt','--input','assets/captions.json','--output','assets/test.srt')
        self.assertIn('00:00:00,120 --> 00:00:00,900', (self.root/'assets/test.srt').read_text())
        self.tool('captions.py','export-srt','--input','assets/captions.json','--output','assets/test.srt',ok=False)
        self.source.write_bytes(self.source.read_bytes()+b'changed')
        self.tool('captions.py','check','--input','assets/captions.json',ok=False)

    def test_script_sentence_breaks_use_matching_words_without_rewriting_recognition(self):
        words = [{'text':'水','start':0,'end':.2},{'text':'蒸发,','start':.2,'end':1},
                 {'text':'水','start':1.2,'end':1.4},{'text':'凝结。','start':1.4,'end':2}]
        boundaries=captions.script_boundaries(words,'水蒸发。水凝结。')
        self.assertEqual(boundaries,{1})
        result=captions.sentence_captions(words,break_after=boundaries)
        self.assertEqual(result[0],{'text':'水蒸发,','startMs':0,'endMs':1000})
        self.assertEqual(result[1]['startMs'],1200)
        self.assertEqual(captions.script_boundaries(words,'完全不同的配音。不应编造。'),set())

    def rms(self, file, start, duration=.15):
        import array, math
        data = subprocess.check_output(['ffmpeg','-v','error','-ss',str(start),'-i',str(file),'-t',str(duration),
                                        '-ac','1','-ar','48000','-f','f32le','-'])
        values = array.array('f', data)
        return math.sqrt(sum(x*x for x in values)/len(values))

    def test_prepare_measurably_fades_and_preserves_source_and_duration(self):
        original = digest(self.source)
        result = self.tool('audio-tools.py','prepare','--source','assets/music.wav','--output','assets/faded.wav',
                           '--gain-db','-6','--fade-in','.5','--fade-out','.5')
        output = self.root/'assets/faded.wav'
        self.assertEqual(digest(self.source), original)
        self.assertAlmostEqual(result['after']['durationSeconds'],3,places=2)
        self.assertLess(self.rms(output,0),self.rms(output,1)/2)
        self.assertLess(self.rms(output,2.85),self.rms(output,1)/2)
        self.assertAlmostEqual(self.rms(output,1)/self.rms(self.source,1),.5,delta=.03)
        self.tool('audio-tools.py','prepare','--source','assets/music.wav','--output','assets/faded.wav',ok=False)
        self.tool('audio-tools.py','prepare','--source','assets/music.wav','--output','assets/bad.wav','--fade-in','nan',ok=False)

    def test_duck_lowers_music_during_aligned_voice_and_releases_after(self):
        voice = self.root/'assets/voice.wav'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=880:duration=1',
                        '-af','volume=4,adelay=1000|1000,apad=pad_dur=1',str(voice)],check=True)
        result = self.tool('audio-tools.py','duck','--source','assets/music.wav','--narration','assets/voice.wav',
                           '--output','assets/ducked.wav')
        output=self.root/'assets/ducked.wav'
        self.assertFalse(result['narrationMixedIntoOutput'])
        self.assertLess(self.rms(output,1.5),self.rms(output,.4)*.6)
        self.assertGreater(self.rms(output,2.8),self.rms(output,1.5)*1.3)

    def test_normalization_and_silence_measurements_are_honest(self):
        normalized = self.tool('audio-tools.py','prepare','--source','assets/music.wav','--output','assets/normalized.wav',
                               '--normalize-lufs','-18')
        self.assertAlmostEqual(normalized['after']['integratedLufs'],-18,delta=.6)
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','1',str(self.root/'assets/silent.wav')],check=True)
        report=self.tool('audio-tools.py','analyze','--source','assets/silent.wav','--output','silence.json')
        self.assertTrue(report['silent'])
        self.assertIsNone(report['integratedLufs'])
        self.tool('audio-tools.py','prepare','--source','assets/silent.wav','--output','assets/invalid.wav','--normalize-lufs','-16',ok=False)


if __name__ == '__main__':
    unittest.main()
