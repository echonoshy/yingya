#!/usr/bin/env python3
"""Offline ASR timestamps, script comparison and validated subtitle export."""
import argparse
import difflib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

from media_io import digest, probe, project_file, write_json


def normalized(text):
    return ''.join(c.lower() for c in text if c.isalnum())


def validate_captions(captions, duration):
    previous = 0
    if not captions:
        raise ValueError('No speech captions were detected; inspect the audio')
    for caption in captions:
        start, end = caption.get('startMs'), caption.get('endMs')
        if (not isinstance(start, (int, float)) or not isinstance(end, (int, float))
                or not math.isfinite(start) or not math.isfinite(end)
                or start < previous or end <= start or end > duration * 1000 + 50
                or not isinstance(caption.get('text'), str) or not caption['text'].strip()):
            raise ValueError('Invalid/overlapping caption interval, text, or source duration')
        previous = end


def script_boundaries(words, script):
    """Map script sentence breaks onto matching ASR word boundaries, not time guesses."""
    expected = normalized(script)
    recognized, word_indices = '', []
    for i, word in enumerate(words):
        chars = normalized(word['text'])
        recognized += chars
        word_indices.extend([i] * len(chars))
    matcher = difflib.SequenceMatcher(None, expected, recognized, autojunk=False)
    if matcher.ratio() < .75:
        return set()
    matched = {block.a + i: block.b + i for block in matcher.get_matching_blocks() for i in range(block.size)}
    boundaries, end = set(), 0
    for sentence in re.split(r'(?<=[。！？!?；;])|\n+', script):
        end += len(normalized(sentence))
        if end-1 in matched and end in matched:
            left, right = word_indices[matched[end-1]], word_indices[matched[end]]
            if right == left + 1:
                boundaries.add(left)
    return boundaries


def sentence_captions(words, max_chars=24, break_after=None):
    """Group real word timestamps. Never estimate timestamps from character count."""
    captions, pending = [], []
    def flush():
        if pending:
            captions.append({'text': ''.join(w['text'] for w in pending).strip(),
                             'startMs': round(pending[0]['start'] * 1000),
                             'endMs': round(pending[-1]['end'] * 1000)})
            pending.clear()
    for index, word in enumerate(words):
        if not word['text'].strip() or word['end'] <= word['start']:
            continue
        if pending and (word['start'] - pending[-1]['end'] > .65
                        or len(''.join(w['text'] for w in pending) + word['text']) > max_chars):
            flush()
        pending.append(word)
        if index in (break_after or set()) or re.search(r'[。！？!?；;.]\s*$', word['text']):
            flush()
    flush()
    return captions


def transcribe(args):
    source = project_file(args.project, args.source)
    output = project_file(args.project, args.output, exists=False)
    if output.exists():
        raise ValueError('Output already exists; reuse it or choose a new versioned filename')
    duration = probe(source)
    source_hash = digest(source)
    model_path = Path(os.environ.get('YINGYA_CAPTIONS_MODEL', ''))
    if not model_path.is_absolute() or not (model_path / 'model.bin').is_file():
        raise ValueError('Offline captions model is unavailable; administrator must run setup-captions.py')
    from faster_whisper import WhisperModel
    import numpy as np
    # Decode with Yingya's installed FFmpeg. Passing PCM also avoids depending
    # on PyAV's evolving container-opening keyword arguments.
    decoded = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(source),
                              '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                             capture_output=True, timeout=120)
    if decoded.returncode:
        raise ValueError(decoded.stderr.decode(errors='replace')[-2000:])
    pcm = np.frombuffer(decoded.stdout, dtype=np.float32)
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=4,
                         num_workers=1, local_files_only=True)
    segments, info = model.transcribe(pcm, language=None if args.language == 'auto' else args.language,
                                      beam_size=5, word_timestamps=True, vad_filter=True,
                                      condition_on_previous_text=False,
                                      initial_prompt='以下为普通话简体中文字幕。' if args.language == 'zh' else None)
    words = []
    for segment in segments:
        for word in segment.words or []:
            words.append({'text': word.word, 'start': word.start, 'end': word.end,
                          'probability': word.probability})
    comparison = None
    boundaries = set()
    if args.script:
        script = project_file(args.project, args.script)
        expected = script.read_text()
        recognized = ''.join(w['text'] for w in words)
        score = difflib.SequenceMatcher(None, normalized(expected), normalized(recognized), autojunk=False).ratio()
        boundaries = script_boundaries(words, expected)
        comparison = {'path': args.script, 'sha256': digest(script), 'similarity': round(score, 4),
                      'expectedText': expected, 'recognizedText': recognized,
                      'matchesNormalizedText': normalized(expected) == normalized(recognized),
                      'matchedSentenceBoundaries': len(boundaries)}
    captions = sentence_captions(words, args.max_chars, boundaries)
    validate_captions(captions, duration)
    if digest(source) != source_hash:
        raise ValueError('Source changed while transcribing; retry with stable audio')
    result = {'schemaVersion': 1, 'source': args.source, 'sourceSha256': source_hash,
              'durationSeconds': duration, 'language': info.language,
              'method': 'faster-whisper-small-word-timestamps', 'reviewRequired': True,
              'timingVerifiedByListening': False, 'scriptComparison': comparison,
              'words': words, 'captions': captions}
    # ASR text is kept verbatim. Correction is a visible, reviewable edit; a
    # similarity score never certifies facts, a locked script or 300 ms timing.
    write_json(output, result)
    return {'ok': True, 'output': args.output, 'captions': len(captions),
            'reviewRequired': True, 'scriptComparison': comparison}


def check(args):
    file = project_file(args.project, args.input)
    data = json.loads(file.read_text())
    source = project_file(args.project, data['source'])
    if digest(source) != data['sourceSha256']:
        raise ValueError('Caption source changed; transcribe the new audio')
    validate_captions(data['captions'], probe(source))
    return {'ok': True, 'scope': 'source-hash-and-caption-intervals',
            'semanticVerified': False, 'timingVerifiedByListening': False}


def export_srt(args):
    check(args)
    captions = json.loads(project_file(args.project, args.input).read_text())['captions']
    def stamp(ms):
        ms = round(ms)
        return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'
    output = project_file(args.project, args.output, exists=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    text = '\n\n'.join(f"{i+1}\n{stamp(c['startMs'])} --> {stamp(c['endMs'])}\n{c['text']}" for i, c in enumerate(captions)) + '\n'
    with output.open('x') as stream:
        stream.write(text)
    return {'ok': True, 'output': args.output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('health')
    trans = commands.add_parser('transcribe')
    trans.add_argument('--source', required=True)
    trans.add_argument('--output', required=True)
    trans.add_argument('--script')
    trans.add_argument('--language', default='zh')
    trans.add_argument('--max-chars', type=int, default=24, choices=range(8, 81))
    check_parser = commands.add_parser('check')
    check_parser.add_argument('--input', required=True)
    export = commands.add_parser('export-srt')
    export.add_argument('--input', required=True)
    export.add_argument('--output', required=True)
    for p in [trans, check_parser, export]:
        p.add_argument('--project', default='.')
    args = parser.parse_args()
    if args.command == 'health':
        import importlib.util
        model = Path(os.environ.get('YINGYA_CAPTIONS_MODEL', ''))
        result = {'ok': bool(importlib.util.find_spec('faster_whisper')) and (model / 'model.bin').is_file(),
                  'engine': 'faster-whisper', 'model': 'small', 'device': 'cpu', 'offline': True}
    else:
        result = {'transcribe': transcribe, 'check': check, 'export-srt': export_srt}[args.command](args)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    interpreter = os.environ.get('YINGYA_CAPTIONS_PYTHON')
    if interpreter and Path(interpreter).resolve() != Path(sys.executable).resolve():
        os.execv(interpreter, [interpreter, *sys.argv])
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, ImportError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
