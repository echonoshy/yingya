#!/usr/bin/env python3
"""Project-local technical media index. No semantic inference, ASR or downloads."""
import argparse
import contextlib
import fcntl
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import zlib

ANALYSIS_VERSION = '2'
MAX_BYTES = 4 * 1024 ** 3
MAX_DURATION = 6 * 60 * 60
MAX_OUTPUT_BYTES = 16 * 1024 ** 2
MAX_HEIGHT = 720
FORMATS = 'mov,matroska,webm,avi,mpegts,mpeg,mxf,flv,ogg,asf,wav,mp3,flac,aac'
INPUT_OPTIONS = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', FORMATS]


class AnalysisError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def check_time(deadline):
    if time.monotonic() >= deadline:
        raise AnalysisError('TOOL_TIMEOUT', 'Media analysis exceeded its time limit.')


def relative_parts(value):
    path = Path(value)
    if not value or path.is_absolute() or '..' in path.parts or not path.parts:
        raise AnalysisError('PATH_INVALID', 'Use a project-relative path without parent traversal.')
    return path.parts


@contextlib.contextmanager
def open_inside(root, value, directory=False):
    """Walk with O_NOFOLLOW so neither final files nor parent symlinks are followed."""
    parts = relative_parts(value)
    fd = os.open(str(root), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for index, part in enumerate(parts):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if index < len(parts) - 1 or directory:
                flags |= os.O_DIRECTORY
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        mode = os.fstat(fd).st_mode
        if not (stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode)):
            raise AnalysisError('PATH_INVALID', 'Media paths must refer to regular files.')
        yield fd
    except OSError as error:
        raise AnalysisError('PATH_INVALID', 'Path is missing, inaccessible, or contains a symbolic link.') from error
    finally:
        os.close(fd)


def digest_fd(fd, deadline):
    result = hashlib.sha256()
    offset = 0
    while True:
        check_time(deadline)
        data = os.pread(fd, 1024 * 1024, offset)
        if not data:
            return result.hexdigest()
        result.update(data)
        offset += len(data)
        if offset > MAX_BYTES:
            raise AnalysisError('MEDIA_LIMIT', 'Source exceeds the 4 GiB analysis limit.')


def safe_cache_root(root):
    fd = os.open(str(root), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in ('.yingya', 'media-analysis'):
            try:
                os.mkdir(part, mode=0o700, dir_fd=fd)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
    except OSError as error:
        raise AnalysisError('PATH_INVALID', 'The analysis cache path contains a symbolic link or non-directory.') from error
    finally:
        os.close(fd)
    return root / '.yingya' / 'media-analysis'


@contextlib.contextmanager
def cache_lock(path, deadline):
    try:
        fd = os.open(str(path), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    except OSError as error:
        raise AnalysisError('PATH_INVALID', 'Cannot safely open the analysis cache lock.') from error
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise AnalysisError('PATH_INVALID', 'Analysis cache lock must be a regular file.')
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                check_time(deadline)
                time.sleep(.05)
        yield
    finally:
        os.close(fd)


def terminate(child):
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()


def run_tool(command, deadline, pass_fds=()):
    check_time(deadline)
    # Spool output to bounded temporary files; never load unbounded ffprobe JSON.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        try:
            child = subprocess.Popen(command, stdout=out, stderr=err, stdin=subprocess.DEVNULL,
                                     pass_fds=pass_fds, start_new_session=True)
        except FileNotFoundError as error:
            raise AnalysisError('TOOL_MISSING', 'Required executable is unavailable: ' + command[0]) from error
        try:
            while child.poll() is None:
                check_time(deadline)
                if out.tell() > MAX_OUTPUT_BYTES or err.tell() > MAX_OUTPUT_BYTES:
                    raise AnalysisError('MEDIA_LIMIT', 'Media tool output exceeded its bounded analysis limit.')
                time.sleep(.025)
            if out.tell() > MAX_OUTPUT_BYTES or err.tell() > MAX_OUTPUT_BYTES:
                raise AnalysisError('MEDIA_LIMIT', 'Media tool output exceeded its bounded analysis limit.')
            out.seek(0)
            err.seek(0)
            stdout, stderr = out.read(), err.read().decode('utf-8', errors='replace')
            if child.returncode:
                raise AnalysisError('TOOL_FAILED', command[0] + ' failed: ' + stderr[-1800:].strip())
            return stdout, stderr
        finally:
            terminate(child)


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def rate(value):
    try:
        result = float(Fraction(value))
        return result if math.isfinite(result) and result > 0 else None
    except (ValueError, TypeError, ZeroDivisionError):
        return None


def video_metadata(fd, deadline):
    source = '/proc/self/fd/' + str(fd)
    raw, _ = run_tool(['ffprobe', '-v', 'error', *INPUT_OPTIONS, '-show_streams',
                       '-show_format', '-of', 'json', source], deadline, (fd,))
    try:
        probe = json.loads(raw)
        streams = probe['streams']
        video = next(s for s in streams if s.get('codec_type') == 'video'
                     and not s.get('disposition', {}).get('attached_pic'))
    except StopIteration as error:
        raise AnalysisError('UNSUPPORTED_MEDIA', 'A video stream is required; audio-only inputs are not supported.') from error
    except (ValueError, KeyError, TypeError) as error:
        raise AnalysisError('MEDIA_INVALID', 'ffprobe did not return valid video metadata.') from error
    width, height = video.get('width'), video.get('height')
    if not isinstance(width, int) or not isinstance(height, int) or min(width, height) <= 0:
        raise AnalysisError('MEDIA_INVALID', 'Video dimensions are missing or invalid.')
    if max(width, height) > 16384 or width * height > 64 * 1024 ** 2:
        raise AnalysisError('MEDIA_LIMIT', 'Video dimensions exceed the analysis limit.')
    if not isinstance(video.get('index'), int) or video['index'] < 0:
        raise AnalysisError('MEDIA_INVALID', 'Video stream index is invalid.')
    sar_text = str(video.get('sample_aspect_ratio') or '1:1')
    sar = rate(sar_text.replace(':', '/')) or 1.0
    rotation = number(video.get('tags', {}).get('rotate')) or 0.0
    for side_data in video.get('side_data_list', []):
        if number(side_data.get('rotation')) is not None:
            rotation = number(side_data['rotation'])
    rotation %= 360
    if min(abs(rotation - angle) for angle in (0, 90, 180, 270, 360)) > .01:
        raise AnalysisError('UNSUPPORTED_MEDIA', 'Only right-angle video display rotation is supported.')
    rotation = round(rotation / 90) * 90 % 360
    display_width, display_height = max(1, round(width * sar)), height
    if rotation in (90, 270):
        display_width, display_height = display_height, display_width
    display_ratio = (width * sar / height) if rotation in (0, 180) else (height / (width * sar))
    start = number(video.get('start_time')) or 0.0
    duration = number(video.get('duration'))
    duration_basis = 'video-stream-duration'
    if duration is None:
        # Matroska and some VFR sources omit stream duration. Scan only this video's
        # packet timestamps, rather than borrowing a longer audio/container duration.
        raw, _ = run_tool(['ffprobe', '-v', 'error', *INPUT_OPTIONS, '-select_streams',
                           str(video['index']), '-show_entries', 'packet=pts_time,duration_time',
                           '-of', 'csv=p=0', source], deadline, (fd,))
        end, last_timestamp, last_duration = None, None, None
        for line in raw.decode('utf-8', errors='replace').splitlines():
            fields = line.split(',')
            timestamp = number(fields[0]) if fields else None
            packet_duration = number(fields[1]) if len(fields) > 1 else None
            if timestamp is not None and (last_timestamp is None or timestamp > last_timestamp):
                last_timestamp, last_duration = timestamp, packet_duration
            if timestamp is not None and packet_duration is not None and packet_duration > 0:
                end = max(end if end is not None else timestamp, timestamp + packet_duration)
        duration = end - start if end is not None and last_duration is not None and last_duration > 0 else None
        duration_basis = 'video-packet-end-minus-stream-start'
    if duration is None or duration <= 0:
        raise AnalysisError('MEDIA_INVALID', 'A positive video duration could not be established.')
    if duration > MAX_DURATION:
        raise AnalysisError('MEDIA_LIMIT', 'Video exceeds the six-hour analysis limit.')
    return {'durationSeconds': duration, 'durationBasis': duration_basis, 'startTimeSeconds': start,
            'timestampOrigin': 'video-stream-start; sourcePtsSeconds preserves absolute source presentation timestamps',
            'width': display_width, 'height': display_height, 'codedWidth': width, 'codedHeight': height,
            'rotationDegrees': rotation, 'sampleAspectRatio': sar_text, 'displayAspectRatio': display_ratio,
            'dimensionBasis': 'square-pixel display dimensions after rotation; coded dimensions are separate',
            'videoStreamIndex': video['index'],
            'fps': {'average': rate(video.get('avg_frame_rate')), 'nominal': rate(video.get('r_frame_rate'))},
            'hasAudio': any(s.get('codec_type') == 'audio' for s in streams),
            'frameRateNote': 'Rates are stream metadata; sampling uses timestamps and does not assume constant frame rate.'}


def png_info(path):
    """Validate the entire PNG chunk chain, including CRC and terminal IEND."""
    with path.open('rb') as stream:
        if stream.read(8) != b'\x89PNG\r\n\x1a\n':
            raise ValueError('invalid PNG signature')
        dimensions = None
        has_data = False
        while True:
            header = stream.read(8)
            if len(header) != 8:
                raise ValueError('incomplete PNG')
            size, kind = struct.unpack('>I4s', header)
            if size > MAX_OUTPUT_BYTES:
                raise ValueError('oversized PNG chunk')
            data, crc = stream.read(size), stream.read(4)
            if len(data) != size or len(crc) != 4 or zlib.crc32(kind + data) & 0xffffffff != struct.unpack('>I', crc)[0]:
                raise ValueError('invalid PNG chunk')
            if kind == b'IHDR':
                dimensions = struct.unpack('>II', data[:8])
            elif kind == b'IDAT':
                has_data = True
            elif kind == b'IEND':
                if size or not dimensions or not has_data or stream.read(1):
                    raise ValueError('invalid PNG termination')
                return dimensions


def artifact(root, path, deadline):
    with open_inside(root, str(path.relative_to(root))) as fd:
        size = os.fstat(fd).st_size
        if not 0 < size <= MAX_OUTPUT_BYTES:
            raise ValueError('invalid image size')
        sha = digest_fd(fd, deadline)
    width, height = png_info(path)
    return {'path': str(path.relative_to(root)), 'sha256': sha, 'bytes': size,
            'width': width, 'height': height}


def cache_read(root, directory, sha, config, deadline):
    if directory.is_symlink():
        raise AnalysisError('PATH_INVALID', 'Analysis cache entries cannot be symbolic links.')
    if not directory.exists():
        return None
    try:
        with open_inside(root, str((directory / 'manifest.json').relative_to(root))) as fd:
            if os.fstat(fd).st_size > 1024 ** 2:
                return None
            manifest = json.loads(os.read(fd, 1024 ** 2))
        if (manifest.get('complete') is not True or manifest.get('analysisVersion') != ANALYSIS_VERSION
                or manifest.get('sourceSha256') != sha or manifest.get('config') != config
                or len(manifest.get('samples', [])) != config['samples']):
            return None
        expected_paths = ['frames/frame-%02d.png' % i for i in range(config['samples'])] + ['contact.png']
        if [a['path'] for a in manifest['artifacts']] != expected_paths:
            return None
        media = manifest['media']
        duration = number(media['durationSeconds'])
        if (duration is None or not 0 < duration <= MAX_DURATION or
                not isinstance(media['hasAudio'], bool) or
                not isinstance(media['width'], int) or not isinstance(media['height'], int) or
                min(media['width'], media['height']) <= 0 or
                not isinstance(media['codedWidth'], int) or not isinstance(media['codedHeight'], int) or
                number(media['displayAspectRatio']) is None or media['displayAspectRatio'] <= 0 or
                media['rotationDegrees'] not in (0, 90, 180, 270)):
            return None
        for index, sample in enumerate(manifest['samples']):
            if (sample['index'] != index or sample['path'] != expected_paths[index] or
                    any(number(sample[k]) is None for k in ('requestedTimestampSeconds', 'timestampSeconds',
                                                            'sourcePtsSeconds', 'seekErrorSeconds')) or
                    not 0 <= sample['timestampSeconds'] < duration):
                return None
        for item in manifest['artifacts']:
            path = directory / item['path']
            actual = artifact(root, path, deadline)
            if any(actual[key] != item[key] for key in ('sha256', 'bytes', 'width', 'height')):
                return None
        return manifest
    except (OSError, ValueError, KeyError, TypeError, struct.error):
        return None
    except AnalysisError as error:
        if error.code == 'PATH_INVALID':
            return None
        raise


def make_frames(root, stage, fd, media, config, deadline):
    (stage / 'frames').mkdir()
    samples, artifacts = [], []
    count, duration = config['samples'], media['durationSeconds']
    # Interior samples avoid exact EOF. For very short or sparse VFR videos,
    # requests can legitimately map to the same decoded source frame.
    for index in range(count):
        requested = duration * (index + .5) / count
        path = stage / 'frames' / ('frame-%02d.png' % index)
        display_ratio = media['displayAspectRatio']
        frame_width = max(1, round(min(config['width'], MAX_HEIGHT * display_ratio)))
        frame_height = max(1, round(min(MAX_HEIGHT, config['width'] / display_ratio)))
        # FFmpeg autorotates before user filters; explicitly bake SAR to square
        # pixels so a PNG viewer and downstream focus coordinates see the same DAR.
        filter_text = 'showinfo,scale=%d:%d,setsar=1' % (frame_width, frame_height)
        command = ['ffmpeg', '-hide_banner', '-loglevel', 'info', '-nostdin', '-y', '-filter_threads', '2',
                   '-threads', '2', '-seek_timestamp', '1', '-ss', '%.9f' % (requested + media['startTimeSeconds']),
                   '-copyts', *INPUT_OPTIONS,
                   '-i', '/proc/self/fd/' + str(fd), '-map', '0:' + str(media['videoStreamIndex']),
                   '-an', '-sn', '-dn', '-vf', filter_text, '-frames:v', '1', '-vsync', '0',
                   '-threads', '2', str(path)]
        _, log = run_tool(command, deadline, (fd,))
        match = re.search(r'\bn:\s*0\s+pts:\s*\S+\s+pts_time:([-+0-9.eE]+)', log)
        # A seek into the last held frame may yield no output (one-frame clips or
        # VFR tail). Decode from the beginning and keep the final frame at/before
        # the request in this bounded fallback; timestamp still comes from PTS.
        if not path.exists() or not match:
            command = ['ffmpeg', '-hide_banner', '-loglevel', 'info', '-nostdin', '-y', '-filter_threads', '2',
                       '-threads', '2', '-copyts', *INPUT_OPTIONS, '-i', '/proc/self/fd/' + str(fd),
                       '-map', '0:' + str(media['videoStreamIndex']), '-an', '-sn', '-dn',
                       '-vf', "select='lte(t,%.9f)',showinfo,scale=%d:%d,setsar=1" %
                       (requested + media['startTimeSeconds'], frame_width, frame_height),
                       '-vsync', '0', '-threads', '2', '-update', '1', str(path)]
            _, log = run_tool(command, deadline, (fd,))
            matches = re.findall(r'\bn:\s*\d+\s+pts:\s*\S+\s+pts_time:([-+0-9.eE]+)', log)
            timestamp = number(matches[-1]) if matches else None
            selection = 'last-frame-at-or-before-request (seek-tail fallback)'
        else:
            timestamp = number(match.group(1))
            selection = 'first-decoded-frame-at-or-after-seek'
        if timestamp is None or not path.exists():
            raise AnalysisError('MEDIA_INVALID', 'The video did not produce a timestamped frame.')
        timestamp -= media['startTimeSeconds']
        if timestamp < -.001 or timestamp >= duration + .001:
            raise AnalysisError('MEDIA_INVALID', 'Decoded frame timestamp is outside the video stream duration.')
        timestamp = max(0.0, timestamp)
        item = artifact(root, path, deadline)
        item['path'] = str(path.relative_to(stage))
        artifacts.append(item)
        samples.append({'index': index, 'requestedTimestampSeconds': round(requested, 6),
                        'timestampSeconds': round(timestamp, 6), 'sourcePtsSeconds': round(timestamp + media['startTimeSeconds'], 6),
                        'seekErrorSeconds': round(timestamp - requested, 6), 'selection': selection,
                        'path': item['path']})
    return samples, artifacts


def contact_sheet(root, stage, samples, width, deadline):
    tile_width = min(width, 480)
    tile_height = round(tile_width * 9 / 16)
    filters = ['scale=%d:%d:force_original_aspect_ratio=decrease' % (tile_width, tile_height),
               'pad=%d:%d:(ow-iw)/2:0:color=0x202124' % (tile_width, tile_height + 28)]
    for sample in samples:
        filters.append("drawtext=font=monospace:text='%02d @ %.3fs':x=8:y=%d:fontsize=18:fontcolor=white:enable='eq(n,%d)'" %
                       (sample['index'] + 1, sample['timestampSeconds'], tile_height + 4, sample['index']))
    columns = min(4, len(samples))
    rows = math.ceil(len(samples) / columns)
    filters.append('tile=%dx%d:nb_frames=%d:padding=8:margin=8:color=0x202124' % (columns, rows, len(samples)))
    path = stage / 'contact.png'
    run_tool(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-filter_threads', '2', '-threads', '2',
              '-framerate', '1', '-start_number', '0', '-i', str(stage / 'frames/frame-%02d.png'),
              '-vf', ','.join(filters), '-frames:v', '1', '-threads', '2', str(path)], deadline)
    item = artifact(root, path, deadline)
    item['path'] = 'contact.png'
    return item


def analyze(args):
    if not 1 <= args.samples <= 16 or not 160 <= args.width <= 1280 or not 1 <= args.timeout <= 600:
        raise AnalysisError('ARGUMENT_INVALID', 'Use 1–16 samples, width 160–1280, and timeout 1–600 seconds.')
    root = Path(args.project).resolve(strict=True)
    deadline = time.monotonic() + args.timeout
    transcript = None
    if args.transcript:
        if Path(args.transcript).suffix.lower() not in ('.json', '.srt', '.vtt'):
            raise AnalysisError('ARGUMENT_INVALID', 'Transcript references must be JSON, SRT, or VTT files.')
        with open_inside(root, args.transcript) as fd:
            if os.fstat(fd).st_size > MAX_OUTPUT_BYTES:
                raise AnalysisError('MEDIA_LIMIT', 'External transcript reference exceeds 16 MiB.')
            transcript = {'path': str(Path(args.transcript)), 'sha256': digest_fd(fd, deadline),
                          'status': 'external-reference-not-generated-or-validated'}
    config = {'samples': args.samples, 'width': args.width, 'maxHeight': MAX_HEIGHT,
              'sampling': 'uniform-interior-seek-with-actual-pts-v1'}
    with open_inside(root, args.source) as fd:
        original_stat = os.fstat(fd)
        if original_stat.st_size <= 0 or original_stat.st_size > MAX_BYTES:
            raise AnalysisError('MEDIA_LIMIT', 'Source must be non-empty and no larger than 4 GiB.')
        sha = digest_fd(fd, deadline)
        key = sha + '-v' + ANALYSIS_VERSION + '-' + hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:12]
        cache = safe_cache_root(root)
        directory = cache / key
        with cache_lock(cache / ('.' + key + '.lock'), deadline):
            manifest = cache_read(root, directory, sha, config, deadline)
            hit = manifest is not None
            if hit:
                with open_inside(root, args.source) as fresh:
                    current = os.fstat(fresh)
                    if ((current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) !=
                            (original_stat.st_dev, original_stat.st_ino, original_stat.st_size, original_stat.st_mtime_ns)):
                        raise AnalysisError('SOURCE_CHANGED', 'The source changed while reading its cached index; retry it.')
            if manifest is None:
                stage = Path(tempfile.mkdtemp(prefix='.' + key + '.', dir=str(cache)))
                try:
                    media = video_metadata(fd, deadline)
                    samples, artifacts = make_frames(root, stage, fd, media, config, deadline)
                    artifacts.append(contact_sheet(root, stage, samples, config['width'], deadline))
                    manifest = {'schemaVersion': 1, 'analysisVersion': ANALYSIS_VERSION, 'complete': True,
                                'sourceSha256': sha, 'config': config, 'media': media,
                                'samples': samples, 'artifacts': artifacts}
                    # A replaced or edited source must never publish an index for
                    # a path that now identifies different bytes.
                    with open_inside(root, args.source) as fresh:
                        current = os.fstat(fresh)
                        if ((current.st_dev, current.st_ino) != (original_stat.st_dev, original_stat.st_ino)
                                or digest_fd(fresh, deadline) != sha):
                            raise AnalysisError('SOURCE_CHANGED', 'The source changed during analysis; retry it.')
                    with (stage / 'manifest.json').open('x') as stream:
                        json.dump(manifest, stream, ensure_ascii=False)
                        stream.flush()
                        os.fsync(stream.fileno())
                    if directory.exists():
                        if directory.is_symlink() or not directory.is_dir():
                            raise AnalysisError('PATH_INVALID', 'Invalid analysis cache entry.')
                        shutil.rmtree(directory)
                    stage.rename(directory)
                finally:
                    if stage.exists():
                        shutil.rmtree(stage)
        prefix = str(directory.relative_to(root))
        return {'ok': True, 'schemaVersion': 1, 'analysisVersion': ANALYSIS_VERSION,
                'kind': 'technical-media-index', 'semanticUnderstanding': False, 'cacheHit': hit,
                'source': {'id': 'sha256:' + sha, 'sha256': sha, 'path': str(Path(args.source)), 'bytes': original_stat.st_size},
                'media': manifest['media'], 'samples': [{**s, 'path': prefix + '/' + s['path']} for s in manifest['samples']],
                'contactSheet': prefix + '/contact.png', 'manifest': prefix + '/manifest.json',
                'transcript': transcript}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--samples', type=int, default=8)
    parser.add_argument('--width', type=int, default=640)
    parser.add_argument('--timeout', type=float, default=90)
    parser.add_argument('--transcript')
    parser.add_argument('--json', action='store_true', help='Emit the machine-readable JSON result (also the default).')
    args = parser.parse_args()
    try:
        result = analyze(args)
        code = 0
    except AnalysisError as error:
        result = {'ok': False, 'error': {'code': error.code, 'message': str(error)}}
        code = 1
    except (OSError, ValueError, struct.error) as error:
        result = {'ok': False, 'error': {'code': 'MEDIA_INVALID', 'message': str(error)}}
        code = 1
    print(json.dumps(result, ensure_ascii=False, separators=(',', ':')), flush=True)
    return code


if __name__ == '__main__':
    sys.exit(main())
