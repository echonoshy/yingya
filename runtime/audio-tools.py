#!/usr/bin/env python3
"""Measure loudness and prepare local WAV assets for the managed media schedule."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile

from media_io import digest, probe, project_file, publish, run, write_json


def measure(source):
    duration = probe(source)
    result = run(['ffmpeg', '-hide_banner', '-nostdin', '-threads', '2', '-i', source,
                  '-map', '0:a:0', '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
                  '-f', 'null', '-'])
    matches = re.findall(r'\{\s*"input_i".*?\}', result.stderr, re.S)
    if not matches:
        raise ValueError('FFmpeg did not return a complete loudness report')
    values = json.loads(matches[-1])
    def number(key):
        result = float(values[key])
        return result if math.isfinite(result) else None
    return {'durationSeconds': duration, 'integratedLufs': number('input_i'),
            'truePeakDbtp': number('input_tp'), 'loudnessRangeLu': number('input_lra'),
            'silent': number('input_i') is None, 'measurement': values}


def bounded(value, minimum, maximum, name):
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f'{name} must be between {minimum} and {maximum}')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['analyze', 'prepare', 'duck'])
    parser.add_argument('--project', default='.')
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--gain-db', type=float, default=0)
    parser.add_argument('--fade-in', type=float, default=0)
    parser.add_argument('--fade-out', type=float, default=0)
    parser.add_argument('--normalize-lufs', type=float)
    parser.add_argument('--narration')
    args = parser.parse_args()
    source = project_file(args.project, args.source)
    output = project_file(args.project, args.output, exists=False)
    if output.exists():
        raise ValueError('Output already exists; choose a new versioned filename')
    source_hash = digest(source)
    before = measure(source)
    if args.command == 'analyze':
        report = {'ok': True, 'source': args.source, 'sourceSha256': source_hash, **before,
                  'clippingRisk': before['truePeakDbtp'] is not None and before['truePeakDbtp'] >= 0,
                  'semanticVerified': False}
        write_json(output, report)
        return {'ok': True, 'report': args.output, **{k: v for k, v in report.items() if k != 'measurement'}}
    if output.suffix.lower() != '.wav' or not str(args.output).startswith('assets/'):
        raise ValueError('Prepared audio must be a WAV under assets/')
    duration = before['durationSeconds']
    bounded(args.gain_db, -60, 12, 'gain-db')
    bounded(args.fade_in, 0, duration, 'fade-in')
    bounded(args.fade_out, 0, duration, 'fade-out')
    if args.fade_in + args.fade_out > duration:
        raise ValueError('Fades overlap; shorten them instead of removing the audible hold')
    filters = []
    if args.normalize_lufs is not None:
        bounded(args.normalize_lufs, -30, -10, 'normalize-lufs')
        if before['silent']:
            raise ValueError('Cannot normalize silent audio')
        v = before['measurement']
        # The analysis target is -16 LUFS. Re-measure for any different target
        # rather than reusing an incompatible target offset.
        analysis = run(['ffmpeg', '-hide_banner', '-nostdin', '-i', source, '-map', '0:a:0', '-vn',
                        '-af', f'loudnorm=I={args.normalize_lufs}:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'])
        v = json.loads(re.findall(r'\{\s*"input_i".*?\}', analysis.stderr, re.S)[-1])
        filters.append(f"loudnorm=I={args.normalize_lufs}:TP=-1.5:LRA=11:measured_I={v['input_i']}:measured_TP={v['input_tp']}:measured_LRA={v['input_lra']}:measured_thresh={v['input_thresh']}:offset={v['target_offset']}:linear=true")
    filters += [f'volume={args.gain_db}dB']
    if args.fade_in:
        filters.append(f'afade=t=in:d={args.fade_in}')
    if args.fade_out:
        filters.append(f'afade=t=out:st={duration - args.fade_out}:d={args.fade_out}')
    command = ['ffmpeg', '-v', 'error', '-nostdin', '-threads', '2', '-i', source]
    narration = None
    if args.command == 'duck':
        if not args.narration:
            raise ValueError('duck requires --narration, aligned to music time zero')
        narration = project_file(args.project, args.narration)
        probe(narration)
        narration_hash = digest(narration)
        command += ['-i', narration, '-filter_complex',
                    f'[1:a:0]apad,atrim=duration={duration}[key];[0:a:0][key]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=300:makeup=1,' + ','.join(filters) + '[out]',
                    '-map', '[out]']
    else:
        if args.narration:
            raise ValueError('--narration is only valid for duck')
        command += ['-map', '0:a:0', '-af', ','.join(filters)]
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.audio-', suffix='.wav', dir=output.parent)
    os.close(fd)
    try:
        run(command + ['-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-y', temporary])
        after = measure(temporary)
        if abs(after['durationSeconds'] - duration) > .05:
            raise ValueError('Prepared audio duration changed unexpectedly')
        if source_hash != digest(source) or (narration and narration_hash != digest(narration)):
            raise ValueError('Source changed while processing; retry with stable inputs')
        publish(temporary, output)
    finally:
        os.unlink(temporary)
    return {'ok': True, 'output': args.output, 'sourceSha256': source_hash, 'outputSha256': digest(output),
            'before': before, 'after': after, 'narrationMixedIntoOutput': False,
            'registerAsNewMediaAsset': True, 'listeningReviewRequired': True}


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False, allow_nan=False))
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
