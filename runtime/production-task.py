#!/usr/bin/env python3
"""Durable local HyperFrames jobs with bound checks of the exported video."""
import argparse
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.parse import unquote, urlsplit


RENDER_VERIFICATION_VERSION = 2
RESOLUTIONS = {'landscape': (1920, 1080), 'portrait': (1080, 1920),
               'landscape-4k': (3840, 2160), 'portrait-4k': (2160, 3840),
               'square': (1080, 1080), 'square-4k': (2160, 2160)}


def capture_plan(source, resolution):
    """Use only HF 0.8.30's supported presets; never edit the composition."""
    if resolution not in RESOLUTIONS:
        raise ValueError('Unsupported output resolution: ' + resolution)
    class Dimensions(HTMLParser):
        def __init__(self):
            super().__init__()
            self.found, self.dimensions = False, None

        def handle_starttag(self, _tag, pairs):
            attrs = dict(pairs)
            if self.found or 'data-composition-id' not in attrs:
                return
            self.found = True
            try:
                width, height = (int(attrs.get(key, '')) for key in ('data-width', 'data-height'))
                if width > 0 and height > 0:
                    self.dimensions = width, height
            except (ValueError, TypeError):
                pass
    parser = Dimensions()
    parser.feed((source / 'index.html').read_text())
    target = RESOLUTIONS[resolution]
    native = parser.dimensions
    if native is None:
        # Some legacy compositions leave sizing to HF. Keep its direct path;
        # the actual probe below still enforces the requested final dimensions.
        return dict(mode='direct', captureResolution=resolution, target=list(target), native=None)
    width, height = native
    if target[0] * height != target[1] * width:
        raise ValueError('Requested output aspect ratio does not match the source composition')
    if target[0] >= width and target[0] % width == 0:
        return dict(mode='direct', captureResolution=resolution, target=list(target), native=list(native))
    if width >= target[0]:
        return dict(mode='native-downsample', captureResolution=None, target=list(target), native=list(native))
    compatible = [(w * h, name) for name, (w, h) in RESOLUTIONS.items()
                  if w >= target[0] and w * height == h * width and w % width == 0]
    if compatible:
        return dict(mode='supersample-downsample', captureResolution=min(compatible)[1], target=list(target), native=list(native))
    return dict(mode='native-upscale', captureResolution=None, target=list(target), native=list(native),
                warning='No supported integer-scale capture preset; final output is upscaled from native pixels')


def capture(args, root):
    """Shared UI/Agent capture and optional final resize, outside source files."""
    source, output = inside(root, args.source), inside(root, args.output)
    if output.exists():
        raise ValueError('Capture output already exists; choose a fresh temporary output')
    if output.suffix.lower() != '.mp4' or not 1 <= args.fps <= 120:
        raise ValueError('Capture requires an MP4 output and FPS in [1, 120]')
    plan = capture_plan(source, args.resolution)
    executable = Path(os.environ['YINGYA_NODE_MODULES']) / '.bin/hyperframes'
    deadline, parent_pid, interrupted = time.monotonic() + args.timeout, os.getppid(), False
    child, output_owned = None, False
    def interrupt(_signum, _frame):
        nonlocal interrupted
        interrupted = True

    def run(command, *, collect=False, limit=None):
        nonlocal child
        # A dedicated group lets TERM/timeout/parent loss terminate HF and its
        # browser/encoder descendants, rather than only the Python wrapper.
        child = subprocess.Popen(command, cwd=source, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE if collect else None,
                                 stderr=subprocess.PIPE if collect else None,
                                 text=collect, start_new_session=True)
        end = min(deadline, time.monotonic() + limit) if limit else deadline
        try:
            while True:
                if interrupted or os.getppid() != parent_pid:
                    stop(child, grace=1, kill_remaining=True)
                    raise VerificationCancelled('Capture cancelled or its owner exited')
                if time.monotonic() >= end:
                    stop(child, grace=1, kill_remaining=True)
                    raise subprocess.TimeoutExpired(command, args.timeout)
                try:
                    if collect:
                        stdout, stderr = child.communicate(timeout=.1)
                        result = subprocess.CompletedProcess(command, child.returncode, stdout, stderr)
                    else:
                        result = subprocess.CompletedProcess(command, child.wait(timeout=.1))
                    if result.returncode:
                        raise subprocess.CalledProcessError(result.returncode, command,
                            output=result.stdout, stderr=result.stderr)
                    return result
                except subprocess.TimeoutExpired as error:
                    if error.cmd is command and time.monotonic() >= end:
                        raise
        finally:
            if child.poll() is None or child.returncode:
                stop(child, grace=1, kill_remaining=True)
            if collect:
                child.communicate()
            child = None

    def probe(path):
        result = run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)], collect=True, limit=30)
        media = json.loads(result.stdout)
        video = next((s for s in media.get('streams', []) if s.get('codec_type') == 'video'), None)
        if not video:
            raise ValueError('Capture produced no readable video stream')
        rate = video.get('avg_frame_rate', '0/1').split('/')
        fps = float(rate[0]) / float(rate[1]) if len(rate) == 2 and float(rate[1]) else 0
        return media, video, fps

    previous_signals = {sig: signal.signal(sig, interrupt) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        with tempfile.TemporaryDirectory(prefix='yingya-capture-') as work:
            original = Path(work) / 'captured.mp4'
            command = [str(executable), 'render', '--output', str(original), '--quality', args.quality, '--fps', str(args.fps)]
            if plan['captureResolution']:
                command += ['--resolution', plan['captureResolution']]
            print('[Yingya capture plan] ' + json.dumps(plan), flush=True)
            run(command)
            captured_media, captured_video, captured_fps = probe(original)
            if abs(captured_fps - args.fps) > .001:
                raise ValueError('Captured FPS differs from requested FPS')
            capture_size = [captured_video['width'], captured_video['height']]
            expected_capture = list(RESOLUTIONS[plan['captureResolution']]) if plan['captureResolution'] else plan['native']
            if expected_capture and capture_size != expected_capture:
                raise ValueError('Actual capture dimensions differ from the selected capture plan')
            finished = original
            if capture_size != plan['target']:
                if capture_size[0] * plan['target'][1] != capture_size[1] * plan['target'][0]:
                    raise ValueError('Actual capture aspect ratio differs from requested output')
                finished = Path(work) / 'resized.mp4'
                width, height = plan['target']
                run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(original), '-map', '0:v:0', '-map', '0:a?',
                     '-vf', f'scale={width}:{height}:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium',
                     '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', str(finished)])
            final_media, final_video, final_fps = probe(finished)
            before_audio = [s for s in captured_media['streams'] if s.get('codec_type') == 'audio']
            after_audio = [s for s in final_media['streams'] if s.get('codec_type') == 'audio']
            duration = float(captured_video.get('duration', captured_media.get('format', {}).get('duration', 0)))
            final_duration = float(final_video.get('duration', final_media.get('format', {}).get('duration', 0)))
            if ([final_video['width'], final_video['height']] != plan['target'] or abs(final_fps - args.fps) > .001
                    or not math.isfinite(duration) or duration <= 0 or not math.isfinite(final_duration)
                    or abs(final_duration - duration) > 1 / args.fps + .001 or len(before_audio) != len(after_audio)):
                raise ValueError('Final output dimensions, FPS, duration or audio count changed unexpectedly')
            audio_hashes = []
            if finished != original:
                for index in range(len(before_audio)):
                    def packet_hash(file):
                        result = run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(file), '-map', f'0:a:{index}',
                                      '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-'], collect=True, limit=120)
                        value = result.stdout.strip()
                        if not re.fullmatch(r'SHA256=[a-fA-F0-9]{64}', value):
                            raise ValueError('Cannot verify copied audio packets')
                        return value[7:].lower()
                    before_hash, after_hash = packet_hash(original), packet_hash(finished)
                    if before_hash != after_hash:
                        raise ValueError('Audio packets changed during output resizing')
                    audio_hashes.append(before_hash)
            if interrupted or os.getppid() != parent_pid:
                raise VerificationCancelled('Capture cancelled before publication')
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open('xb') as destination, finished.open('rb') as result:
                output_owned = True
                shutil.copyfileobj(result, destination)
                destination.flush()
                os.fsync(destination.fileno())
            if interrupted or os.getppid() != parent_pid:
                raise VerificationCancelled('Capture cancelled during publication')
            emit({'yingyaCapture': dict(schemaVersion=1, **plan, captureSize=capture_size,
                outputSize=plan['target'], fps=final_fps, durationSeconds=final_duration,
                capturedAudioCount=len(before_audio), outputAudioCount=len(after_audio),
                audioPolicy='stream-copy' if finished != original else 'unchanged',
                copiedAudioPacketSha256=audio_hashes, outputSha256=digest(output))})
            return 0
    except BaseException:
        if output_owned:
            output.unlink(missing_ok=True)
        raise
    finally:
        if child is not None:
            stop(child, grace=1, kill_remaining=True)
        for sig, handler in previous_signals.items():
            signal.signal(sig, handler)


class VerificationCancelled(ValueError):
    pass


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def save(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def within(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def inside(root, value):
    path = (root / value).resolve()
    if not within(path, root):
        raise ValueError('path must stay inside the project: ' + value)
    return path


def fingerprint(source, output):
    # Hash dependencies, not workflow journals, reports, or prior deliveries.
    ignored_dirs = {'.git', 'node_modules', '.hyperframes', '__pycache__',
                    'renders', 'snapshots'}
    ignored_files = {'project.json', 'events.jsonl', 'messages.json', 'queue.json',
                     'check.json', 'source-fingerprint.json', 'manifest.json'}
    files = {}
    for directory, dirs, names in os.walk(source, followlinks=False):
        base = Path(directory)
        dirs[:] = sorted(d for d in dirs if d not in ignored_dirs and
                         not (base.name == '.yingya' and d in
                              {'versions', 'reports', 'exports', 'production-jobs'}))
        for name in sorted(names):
            path = base / name
            if (name in ignored_files or name.startswith('check-') or path.resolve() == output
                    or re.fullmatch(r'\..+\.[a-f0-9]{32}\.[^/]+', name)):
                continue
            if '.yingya' in path.relative_to(source).parts:
                # Runtime state is mutable independently of composition inputs.
                continue
            if not within(path.resolve(), source):
                raise ValueError('source dependency escapes source directory: ' + str(path))
            if path.is_file():
                files[str(path.relative_to(source))] = digest(path)
        for name in dirs:
            if (base / name).is_symlink():
                raise ValueError('snapshot directory symlinks are not supported: ' + str(base / name))
    if 'index.html' not in files:
        raise ValueError('source directory must contain index.html')
    requirements_path, value = requirements_input(source)
    if requirements_path is not None:
        relative = str(requirements_path.relative_to(source))
        if relative == '.yingya/manifest.json':
            # Other live manifest fields are mutable workflow state.
            files['.yingya/manifest.requirements'] = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
        else:
            # A bundle's root manifest is immutable evidence, just like an
            # explicit requirements.json. Rescue it from generic exclusions.
            files[relative] = digest(requirements_path)
    # Output/cache directories are normally excluded, but an explicitly used
    # image, stylesheet, video or imported composition is still an input.
    class References(HTMLParser):
        def __init__(self):
            super().__init__()
            self.values = []

        def handle_starttag(self, _tag, attrs):
            self.values.extend(value for key, value in attrs if value and key in
                               {'src', 'href', 'poster', 'data-composition-src'})

    pending, checked = list(files), set()
    while pending:
        relative = pending.pop()
        if relative in checked:
            continue
        checked.add(relative)
        path = source / relative
        if path.suffix.lower() not in {'.html', '.htm', '.css'}:
            continue
        text = path.read_text(errors='replace')
        parser = References()
        if path.suffix.lower() != '.css':
            parser.feed(text)
        parser.values.extend(re.findall(r'url\(\s*[\"\']?([^\"\'\)]+)', text))
        for reference in parser.values:
            url = urlsplit(reference.strip())
            if url.scheme or url.netloc or not url.path:
                continue
            dependency = (path.parent / unquote(url.path)).resolve()
            if not within(dependency, source):
                raise ValueError('referenced dependency escapes source directory: ' + reference)
            if dependency == output:
                raise ValueError('composition cannot reference its own export output')
            if dependency.is_file():
                name = str(dependency.relative_to(source))
                files[name] = digest(dependency)
                if name not in checked:
                    pending.append(name)
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(), files


class MediaDeclarations(HTMLParser):
    """Read authored nodes, not unrelated files or HTML mentioned in comments."""
    def __init__(self, text):
        super().__init__()
        self.templates, self.videos, self.audios, self.references, self.scripts = [], [], [], [], []
        self.captions = []
        self.video, self.audio = None, None
        self.script = False
        self.script_templates = []
        self.feed(text)

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if 'editorial-caption' in attrs.get('class', '').split() or 'data-editorial-caption' in attrs:
            self.captions.append(dict(attrs=attrs, templates=list(self.templates)))
        if tag == 'template':
            self.templates.append(attrs)
        if attrs.get('data-composition-src'):
            self.references.append((attrs['data-composition-src'], list(self.templates)))
        if tag == 'video':
            self.video = dict(attrs=attrs, templates=list(self.templates),
                              sources=[attrs['src']] if attrs.get('src') else [])
            self.videos.append(self.video)
        if tag == 'audio':
            self.audio = dict(attrs=attrs, templates=list(self.templates),
                              sources=[attrs['src']] if attrs.get('src') else [])
            self.audios.append(self.audio)
        if tag == 'source' and attrs.get('src'):
            media = self.video if self.video is not None else self.audio
            if media is not None:
                media['sources'].append(attrs['src'])
        if tag == 'script':
            self.script = True
            self.script_templates = list(self.templates)

    def handle_endtag(self, tag):
        if tag == 'template' and self.templates:
            self.templates.pop()
        if tag == 'video':
            self.video = None
        if tag == 'audio':
            self.audio = None
        if tag == 'script':
            self.script = False

    def handle_data(self, value):
        if self.script:
            self.scripts.append((value, self.script_templates))


def source_media(source):
    """Follow composition imports and explicitly consumed slots from index.html.

    Native composition files wrap their live markup in an unnamed template.
    Named host slots count only when a reachable component consumes that slot.
    Runtime-only JavaScript media is not inferred from arbitrary strings; the
    optional source-bindings contract provides stronger coverage for that case.
    """
    documents, slots = {}, set()

    def active(templates, component):
        return all(t.get('data-slot') in slots if t.get('data-slot') else component
                   for t in templates)

    def read(path, component):
        if path not in documents:
            if not within(path, source):
                raise ValueError('composition reference escapes source directory')
            documents[path] = (MediaDeclarations(path.read_text()), component)

    read(source / 'index.html', False)
    while True:
        before = (len(documents), len(slots))
        for path, (parsed, component) in list(documents.items()):
            for script, templates in parsed.scripts:
                if active(templates, component):
                    slots.update(re.findall(r'template\[data-slot\s*=\s*[\"\']([^\"\']+)[\"\']\]', script))
            for reference, templates in parsed.references:
                url = urlsplit(reference)
                if active(templates, component) and not url.scheme and not url.netloc:
                    read((path.parent / unquote(url.path)).resolve(), True)
        if before == (len(documents), len(slots)):
            break
    videos, audios, captions = [], [], []
    for path, (parsed, component) in documents.items():
        for media_list, target in [(parsed.videos, videos), (parsed.audios, audios)]:
            for media in media_list:
                if active(media['templates'], component):
                    target.append(dict(html=str(path.relative_to(source)),
                                       id=media['attrs'].get('id'), sources=media['sources'],
                                       attributes=media['attrs']))
        for caption in parsed.captions:
            if active(caption['templates'], component):
                captions.append(dict(html=str(path.relative_to(source)), attributes=caption['attrs']))
    return dict(declaredVideoCount=len(videos), videos=videos, audios=audios,
                captions=captions,
                reachableDocuments=sorted(str(p.relative_to(source)) for p in documents))


def render_diagnostics(logs):
    """Use only this invocation's machine-readable CLI diagnostics; absent != 0."""
    compiled, extracted, job_ids, captures = [], [], set(), []
    for path in logs:
        for line in path.read_text(errors='replace').splitlines():
            start = line.find('{')
            if start < 0:
                continue
            try:
                value, _ = json.JSONDecoder().raw_decode(line[start:])
            except ValueError:
                continue
            if isinstance(value, dict) and isinstance(value.get('yingyaCapture'), dict):
                captures.append(value['yingyaCapture'])
            if not isinstance(value, dict) or not value.get('renderJobId'):
                continue
            compile_record = (value.get('phase') == 'compile' and value.get('status') == 'checkpoint'
                              or 'Compiled composition metadata' in line)
            extract_record = (value.get('phase') == 'video_extract'
                              and value.get('status') == 'checkpoint'
                              and 'extractedVideoCount' in value)
            if compile_record or extract_record:
                job_ids.add(value['renderJobId'])
            if compile_record and 'videoCount' in value:
                compiled.append(value)
            if extract_record:
                extracted.append(value)
    if len(job_ids) > 1:
        raise ValueError('本次渲染日志出现多个媒体编译任务，无法绑定唯一导出。')
    if len({json.dumps(v['videoCount'], sort_keys=True) for v in compiled}) > 1:
        raise ValueError('本次渲染日志的媒体编译数量相互矛盾。')
    if len({json.dumps(value, sort_keys=True) for value in captures}) > 1:
        raise ValueError('本次渲染日志出现多个不同的尺寸转换结果。')
    return dict(known=bool(compiled), renderJobId=next(iter(job_ids), None),
                compile=compiled[-1] if compiled else None,
                extraction=extracted[-1] if extracted else None,
                capture=captures[-1] if captures else None)


def validate_media_extraction(declarations, diagnostics):
    authored = declarations['declaredVideoCount'] > 0
    compiled = diagnostics['compile'] or {}
    extracted = diagnostics['extraction'] or {}
    count = compiled.get('videoCount')
    if authored and (not isinstance(count, int) or isinstance(count, bool)):
        raise ValueError('入口声明了源视频，但本次导出的媒体编译数量未知；不能用预览检查代替导出验收。')
    if authored and count <= 0:
        raise ValueError('入口声明了源视频，但本次导出 videoCount=0；请把素材静态接入实际渲染节点。')
    if authored and count < declarations['declaredVideoCount']:
        raise ValueError('本次导出的编译视频数量少于入口实际声明的视频节点，存在素材遗漏。')
    if isinstance(count, int) and count > 0:
        extracted_count = extracted.get('extractedVideoCount')
        total = extracted.get('totalFramesExtracted')
        coverage = extracted.get('minVideoFrameCoverageRatio')
        if (extracted.get('videoCount') != count or not isinstance(extracted_count, int)
                or extracted_count < count or not isinstance(total, (int, float)) or total <= 0):
            raise ValueError('本次导出的源视频提帧记录缺失或未覆盖全部编译视频。')
        if not isinstance(coverage, (int, float)) or not math.isfinite(coverage) or coverage < 1 - 1e-6:
            raise ValueError('本次导出的源视频提帧覆盖不完整或无法验证。')


def video_duration(path, probe, run=subprocess.run):
    """Audio/container tails must not make an unavailable video range look valid."""
    stream = next((s for s in probe.get('streams', []) if s.get('codec_type') == 'video'), None)
    if stream is None:
        raise ValueError('媒体没有可读取的视频轨。')
    try:
        duration = float(stream.get('duration', 0))
    except (TypeError, ValueError):
        duration = 0
    if math.isfinite(duration) and duration > 0:
        return duration
    result = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                             '-show_entries', 'packet=pts_time,dts_time,duration_time', '-of', 'json', str(path)],
                            capture_output=True, text=True, timeout=30)
    packets = json.loads(result.stdout).get('packets', []) if result.returncode == 0 else []
    spans = []
    for packet in packets:
        try:
            start = float(packet.get('pts_time'))
            length = float(packet.get('duration_time', 0))
            if math.isfinite(start):
                spans.append((start, length if math.isfinite(length) and length > 0 else None))
        except (TypeError, ValueError):
            continue
    if not spans or max(spans, key=lambda item: item[0])[1] is None:
        raise ValueError('视频末包时长未知，无法验证实际可用视频区间。')
    try:
        origin = float(stream.get('start_time', min(start for start, _ in spans)))
    except (TypeError, ValueError):
        origin = float('nan')
    duration = max(start + length for start, length in spans if length is not None) - origin
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('无法从视频轨或视频包验证实际可用视频时长。')
    return duration


def normalize_requirements(value):
    if not isinstance(value, dict):
        raise ValueError('制作要求必须是对象。')
    result = dict(value)
    for key, default, allowed in [
            ('durationMode', 'target', ('target', 'exact', 'max')),
            ('audioMode', 'auto', ('auto', 'preserve', 'narration', 'replace', 'mute')),
            ('subtitles', 'auto', ('auto', 'zh', 'zh-en', 'none')),
            ('music', 'auto', ('auto', 'on', 'off'))]:
        result.setdefault(key, default)
        if result[key] not in allowed:
            raise ValueError('无法识别的制作要求：' + key)
    target = result.get('targetDurationSeconds')
    if target is not None and (isinstance(target, bool) or not isinstance(target, (int, float))
                               or not math.isfinite(target) or not 1 <= target <= 3600):
        raise ValueError('目标时长必须为 1–3600 秒。')
    if result['durationMode'] != 'target' and target is None:
        raise ValueError('精确或最大时长要求必须指定目标秒数。')
    if result['audioMode'] == 'mute' and result['music'] == 'on':
        raise ValueError('静音成片与要求添加音乐冲突。')
    return result


def requirements_input(source):
    # Only source-owned files: current project requirements must never overwrite
    # an older version's frozen requirements (or legacy absence thereof).
    for relative in ('.yingya/requirements.json', '.yingya/manifest.json', 'manifest.json'):
        path = source / relative
        if not path.is_file():
            continue
        if not within(path.resolve(), source):
            raise ValueError('requirements dependency escapes source directory')
        value = json.loads(path.read_text())
        if relative == '.yingya/requirements.json':
            return path, value
        if 'requirements' in value.get('outputSpec', {}):
            return path, value['outputSpec']['requirements']
    return None, {}


def project_requirements(source):
    return normalize_requirements(requirements_input(source)[1])


def frozen_requirements(root, source, bindings):
    if not bindings or 'requirements' not in bindings:
        return project_requirements(source)
    path = inside(source, bindings.get('requirementsFile', ''))
    if not path.is_file() or digest(path) != bindings.get('requirementsSha256'):
        raise ValueError('制作要求快照与源绑定清单不一致。')
    frozen = normalize_requirements(json.loads(path.read_text()))
    if frozen != normalize_requirements(bindings['requirements']):
        raise ValueError('内嵌制作要求与冻结快照不一致。')
    if source == root and frozen != project_requirements(root):
        raise ValueError('项目制作要求已变化，请重新装配后导出。')
    return frozen


def validate_requirements(source, requirements, declarations, bindings, media, duration, fps, run=subprocess.run):
    """Check observable contracts; role labels are not semantic audio approval."""
    target, mode = requirements.get('targetDurationSeconds'), requirements['durationMode']
    tolerance = 1 / fps + 1e-3
    if target is not None and ((mode == 'exact' and abs(duration - target) > tolerance)
                               or (mode == 'max' and duration > target + tolerance)):
        raise ValueError('实际成片时长不满足制作要求：' + mode)
    has_audio = any(stream.get('codec_type') == 'audio' for stream in media['streams'])
    if requirements['audioMode'] == 'mute' and has_audio:
        raise ValueError('要求静音，但实际成片仍包含音轨。')
    if requirements['subtitles'] == 'none' and declarations.get('captions'):
        raise ValueError('要求关闭新增说明字幕，但入口仍包含 editorial-caption。')
    source_assets = set(bindings.get('sourcePaths', [])) if bindings else set()
    source_hashes = set(bindings.get('sourceHashes', [])) if bindings else set()
    required = []
    if requirements['audioMode'] in ('narration', 'replace'):
        required.append('narration' if requirements['audioMode'] == 'narration' else 'replacement')
    if requirements['music'] == 'on':
        required.append('music')
    roles = {}
    for node in declarations['audios']:
        role = node['attributes'].get('data-editorial-audio-role')
        if role:
            roles.setdefault(role, []).append(node)
    if requirements['music'] == 'off' and roles.get('music'):
        raise ValueError('要求不添加音乐，但入口仍包含 music 音频节点。')
    evidence = []
    for role in required:
        if not roles.get(role) or not has_audio:
            raise ValueError('尚未完成音频制作要求：' + role + '；只有源音轨不能视为已完成。')
        assets = []
        for node in roles[role]:
            attrs = node['attributes']
            if 'muted' in attrs or not node['sources']:
                raise ValueError('要求的音频节点已静音或缺少素材：' + role)
            url = urlsplit(node['sources'][0])
            if url.scheme or url.netloc:
                raise ValueError('要求的音频必须使用可验证的项目内素材：' + role)
            asset = ((source / node['html']).parent / unquote(url.path)).resolve()
            if not within(asset, source) or not asset.is_file() or str(asset.relative_to(source)) in source_assets:
                raise ValueError('新增配音或音乐不能只复用源录屏音轨：' + role)
            asset_hash = digest(asset)
            if asset_hash in source_hashes:
                raise ValueError('新增配音或音乐不能只是源录屏的改名副本：' + role)
            try:
                start, length, offset = [float(attrs.get(key, default)) for key, default in
                                         [('data-start', 0), ('data-duration', None), ('data-media-start', 0)]]
                volume = float(attrs.get('data-volume', 1))
            except (ValueError, TypeError):
                raise ValueError('要求的音频节点缺少有效时间：' + role)
            if (not all(math.isfinite(v) for v in (start, length, offset, volume)) or start < 0 or length <= 0
                    or offset < 0 or start + length > duration + tolerance or volume <= 0):
                raise ValueError('要求的音频节点时间或音量无效：' + role)
            probe = run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(asset)],
                        capture_output=True, text=True, timeout=30)
            streams = json.loads(probe.stdout).get('streams', []) if probe.returncode == 0 else []
            audio = next((s for s in streams if s.get('codec_type') == 'audio'), None)
            if audio is None:
                raise ValueError('要求的音频素材没有可读取音轨：' + role)
            try:
                audio_duration = float(audio.get('duration', 'nan'))
                audio_start = float(audio.get('start_time', 0))
                rate = float(attrs.get('data-playback-rate', 1))
            except (ValueError, TypeError):
                audio_duration, audio_start, rate = float('nan'), float('nan'), float('nan')
            if (not math.isfinite(audio_duration) or audio_duration <= 0 or not math.isfinite(audio_start)
                    or abs(audio_start) > .001 or rate != 1 or offset + length > audio_duration + tolerance):
                raise ValueError('要求的音频时间范围不可验证；请使用零起点、1x 的 WAV/M4A 音频：' + role)
            assets.append(dict(path=str(asset.relative_to(source)), sha256=asset_hash, nodeId=node['id']))
        evidence.append(dict(role=role, structuralEvidence=assets, semanticVerified=False))
    return dict(requirements=requirements, audioWork=evidence,
                captionCheck='marked-editorial-captions-only', semanticVerified=False)


def source_bindings(root, source, declarations, run=subprocess.run):
    path = source / 'source-bindings.json'
    if not path.exists():
        return None
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or value.get('schemaVersion') != 1 or value.get('generator') != 'yingya-editorial:v1':
        raise ValueError('source-bindings.json 版本或来源无法识别。')
    entry = inside(source, value.get('entry', ''))
    scenes_file = inside(source, value.get('scenesFile', ''))
    if (entry != source / 'index.html' or not re.fullmatch(r'[a-f0-9]{64}', value.get('entrySha256', ''))
            or digest(scenes_file) != value.get('scenesSha256')):
        raise ValueError('源片段清单的入口来源或分镜证据不匹配，请重新装配。')
    current_entry_hash = digest(entry)
    if source == root and value.get('originScenesFile'):
        original = inside(root, value['originScenesFile'])
        if not original.is_file() or digest(original) != value.get('scenesSha256'):
            raise ValueError('原分镜已变化，当前源片段清单和入口尚未重新装配。')
    scenes = value.get('scenes')
    if not isinstance(scenes, list) or not scenes:
        raise ValueError('源片段清单没有有效镜头。')
    by_id = {}
    for video in declarations['videos']:
        by_id.setdefault(video['id'], []).append(video)
    seen, total, source_probes, expected_audio = set(), 0.0, {}, 0
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get('source'), dict):
            raise ValueError('源片段清单包含无效镜头记录。')
        candidates = by_id.get(scene.get('videoId'), [])
        if len(candidates) != 1 or scene.get('id') in seen:
            raise ValueError('源片段清单无法唯一对应入口中的实际视频节点。')
        seen.add(scene.get('id'))
        node = candidates[0]
        asset = inside(source, scene['source']['path'])
        if digest(asset) != scene['source'].get('sha256'):
            raise ValueError('源片段文件内容已变化，请重新分析并装配。')
        media_path = inside(source, scene['mediaSrc'])
        node_path = (source / node['html']).parent / unquote(urlsplit(node['sources'][0]).path) if node['sources'] else None
        if media_path != asset or node_path is None or node_path.resolve() != asset:
            raise ValueError('源片段清单中的素材与实际视频节点引用不匹配。')
        values = [scene.get(k) for k in ('startSeconds', 'durationSeconds', 'sourceIn', 'sourceOut')]
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in values):
            raise ValueError('源片段清单包含无效时间。')
        start, duration, source_in, source_out = values
        if (start < 0 or duration <= 0 or source_in < 0 or source_out <= source_in
                or abs(duration - (source_out - source_in)) > 1e-6 or abs(start - total) > 1e-6):
            raise ValueError('源片段区间或输出时间不连续，请重新装配。')
        for attr, expected in [('data-start', start), ('data-duration', duration), ('data-media-start', source_in), ('data-playback-rate', 1)]:
            try:
                actual = float(node['attributes'].get(attr, 1 if attr == 'data-playback-rate' else None))
            except (KeyError, ValueError, TypeError):
                actual = float('nan')
            if not math.isfinite(actual) or abs(actual - expected) > 1e-6:
                raise ValueError('视频节点的时间属性与源片段清单不一致：' + attr)
        if asset not in source_probes:
            result = run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(asset)],
                                    capture_output=True, text=True, timeout=30)
            source_probes[asset] = json.loads(result.stdout) if result.returncode == 0 else {}
        probe = source_probes[asset]
        source_duration = video_duration(asset, probe, run)
        if source_out > source_duration + 1e-3:
            raise ValueError('源片段区间超过实际源视频时长，或源视频不可读取。')
        mode = scene.get('audioMode')
        has_audio = any(s.get('codec_type') == 'audio' for s in probe.get('streams', []))
        audio_id = scene.get('audioId') or str(scene.get('id')) + '-audio'
        audio_nodes = [v for v in declarations['audios'] if v['id'] == audio_id]
        if mode not in ('preserve', 'mute') or 'muted' not in node['attributes'] or (mode == 'mute' and audio_nodes):
            raise ValueError('视频节点与源片段清单的原音保留方式不一致。')
        if mode == 'preserve' and has_audio:
            expected_audio += 1
            if len(audio_nodes) != 1:
                raise ValueError('源片段要求保留原音，但缺少对应的唯一音频节点。')
            audio = audio_nodes[0]
            audio_path = (source / audio['html']).parent / unquote(urlsplit(audio['sources'][0]).path) if audio['sources'] else None
            if audio_path is None or audio_path.resolve() != asset or 'muted' in audio['attributes']:
                raise ValueError('原音节点没有引用对应的源媒体，或已被静音。')
            for attr, expected in [('data-start', start), ('data-duration', duration), ('data-media-start', source_in), ('data-playback-rate', 1)]:
                try:
                    actual = float(audio['attributes'].get(attr, 1 if attr == 'data-playback-rate' else None))
                except (TypeError, ValueError):
                    actual = float('nan')
                if not math.isfinite(actual) or abs(actual - expected) > 1e-6:
                    raise ValueError('原音节点时间与源片段清单不一致。')
        total += duration
    if (not isinstance(value.get('durationSeconds'), (int, float)) or not math.isfinite(value['durationSeconds'])
            or abs(total - value['durationSeconds']) > 1e-6):
        raise ValueError('源片段清单的总时长不一致。')
    requirements = frozen_requirements(root, source, value)
    required_mode = 'mute' if requirements['audioMode'] in ('mute', 'replace') else requirements['audioMode']
    if required_mode in ('mute', 'preserve') and any(scene.get('audioMode') != required_mode for scene in scenes):
        raise ValueError('源片段的音频方式不满足冻结的制作要求。')
    return dict(path=str(path.relative_to(root)), sha256=digest(path), durationSeconds=total,
                requirements=requirements, sourcePaths=sorted({scene['source']['path'] for scene in scenes}),
                sourceHashes=sorted({scene['source']['sha256'] for scene in scenes}),
                overlayCaptionHidden=value.get('overlayCaptionHidden', False),
                expectedAudioCount=expected_audio, entryModified=current_entry_hash != value['entrySha256'],
                assembledEntrySha256=value['entrySha256'], currentEntrySha256=current_entry_hash,
                scenes=[{k: scene[k] for k in ('id', 'startSeconds', 'durationSeconds', 'sourceIn', 'sourceOut', 'videoId')}
                        for scene in scenes])


def verification_valid(root, job, output_hash):
    """Never bless an old check, stale video, or changed review frame as a render."""
    try:
        path = inside(root, job['renderVerification'])
        if digest(path) != job['renderVerificationSha256']:
            return False
        report = json.loads(path.read_text())
        if not (report.get('schemaVersion') == RENDER_VERIFICATION_VERSION and report.get('ok') is True
                and report.get('jobId') == job.get('renderVerificationJobId', job['id'])
                and report.get('sourceFingerprint') == job.get('sourceFingerprint')
                and report.get('outputSha256') == output_hash
                and report.get('output') == job.get('output') and report.get('frames')):
            return False
        return all(digest(inside(root, frame['path'])) == frame['sha256'] for frame in report['frames'])
    except (OSError, ValueError, KeyError, TypeError):
        return False


def verify_render(root, source, temporary, job, media, run=subprocess.run):
    declarations = source_media(source)
    diagnostics = render_diagnostics([root / job['stdout'], root / job['stderr']])
    report_path = root / '.yingya/reports' / ('render-' + job['id'] + '.json')
    frame_dir = report_path.with_suffix('')
    frame_dir.mkdir(parents=True, exist_ok=False)
    report = dict(schemaVersion=RENDER_VERIFICATION_VERSION, ok=False, jobId=job['id'],
                  requestId=job['requestId'], sourceFingerprint=job['sourceFingerprint'],
                  output=job['output'], outputSha256=digest(temporary), sourceMedia=declarations,
                  compiledMedia=diagnostics, requiresVisualReview=True, frames=[], createdAt=time.time())
    job['renderVerification'] = str(report_path.relative_to(root))
    job['renderVerificationJobId'] = job['id']
    try:
        report['sourceBindings'] = source_bindings(root, source, declarations, run)
        validate_media_extraction(declarations, diagnostics)
        stream = next(s for s in media['streams'] if s.get('codec_type') == 'video')
        duration = video_duration(temporary, media, run)
        rate = stream.get('avg_frame_rate', '0/1').split('/')
        fps = float(rate[0]) / float(rate[1]) if len(rate) == 2 and float(rate[1]) else 0
        if not math.isfinite(duration) or duration <= 0 or not math.isfinite(fps) or fps <= 0:
            raise ValueError('导出视频缺少有效时长或帧率。')
        report['media'] = dict(duration=duration, fps=fps, width=stream['width'], height=stream['height'])
        capture_evidence = diagnostics.get('capture')
        if capture_evidence is not None:
            if (capture_evidence.get('schemaVersion') != 1
                    or capture_evidence.get('outputSha256') != report['outputSha256']
                    or capture_evidence.get('outputSize') != [stream['width'], stream['height']]
                    or not isinstance(capture_evidence.get('fps'), (int, float))
                    or abs(capture_evidence['fps'] - fps) > .001
                    or capture_evidence.get('outputAudioCount') != sum(s.get('codec_type') == 'audio' for s in media['streams'])):
                raise ValueError('最终 MP4 与本次捕获/尺寸转换凭证不一致。')
            report['capture'] = capture_evidence
        if report['sourceBindings'] and abs(duration - report['sourceBindings']['durationSeconds']) > 1 / fps + 1e-3:
            raise ValueError('实际导出时长与源片段清单不一致。')
        if (report['sourceBindings'] and report['sourceBindings']['expectedAudioCount'] > 0
                and not any(s.get('codec_type') == 'audio' for s in media['streams'])):
            raise ValueError('源片段要求保留原音，但实际导出没有音轨。')
        requirements = report['sourceBindings']['requirements'] if report['sourceBindings'] else project_requirements(source)
        report['requirementsVerification'] = validate_requirements(source, requirements, declarations,
            report['sourceBindings'], media, duration, fps, run)
        decode = run(['ffmpeg', '-v', 'error', '-xerror', '-threads', '1', '-i', str(temporary),
                                 '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'], capture_output=True, text=True, timeout=120)
        report['decode'] = dict(exitCode=decode.returncode, stderr=decode.stderr[-4000:])
        if decode.returncode or decode.stderr.strip():
            raise ValueError('实际导出视频未通过完整解码；不能发布为成功成片。')
        last = max(0, duration - 1 / fps)
        times = sorted({round(min(last, duration * fraction), 6) for fraction in (0, .25, .5, .75, 1)})
        if report['sourceBindings']:
            for scene in report['sourceBindings']['scenes']:
                times.append(round(min(last, scene['startSeconds'] + scene['durationSeconds'] / 2), 6))
            times = sorted(set(times))
        for index, timestamp in enumerate(times):
            frame = frame_dir / f'frame-{index + 1:03d}.jpg'
            result = run(['ffmpeg', '-v', 'error', '-ss', str(timestamp), '-i', str(temporary),
                                     '-frames:v', '1', '-q:v', '2', '-threads', '1', str(frame)],
                                    capture_output=True, text=True, timeout=30)
            if result.returncode or not frame.is_file() or frame.stat().st_size == 0:
                raise ValueError('无法从实际导出 MP4 提取审阅帧；导出尚未验收。')
            report['frames'].append(dict(time=timestamp, path=str(frame.relative_to(root)), sha256=digest(frame)))
        report['ok'] = True
        job['outputSha256'] = report['outputSha256']
    except (OSError, ValueError, KeyError, TypeError, StopIteration, subprocess.SubprocessError) as error:
        report['error'] = str(error)
        raise
    finally:
        save(report_path, report)
        job['renderVerificationSha256'] = digest(report_path)


def records(directory, request_id=None):
    result = []
    for path in sorted(directory.glob('*.json')):
        try:
            value = json.loads(path.read_text())
            if value.get('id') == path.stem and (request_id is None or value.get('requestId') == request_id):
                result.append(value)
        except (OSError, ValueError):
            continue
    return result


def active_job(directory):
    with (directory / 'run.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return None
        except BlockingIOError:
            return (directory / 'run.lock').read_text().strip()


def stop(child, grace=5, kill_remaining=False):
    if child.poll() is None:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
    if kill_remaining:
        # A leader can exit on TERM while a browser/encoder in the same group
        # ignores it. Clean the group even after wait() reports leader exit.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def execute(args, root, directory):
    source, output = inside(root, args.source), inside(root, args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        # Reuse is allowed below; replacing an unrelated existing delivery is not.
        existing_output = digest(output)
    else:
        existing_output = None
    source_hash, files = fingerprint(source, output)
    options = [args.kind, str(source.relative_to(root)), str(output.relative_to(root)), args.quality,
               args.resolution, args.fps, args.check_args]
    if args.kind == 'render':
        options.append(RENDER_VERIFICATION_VERSION)
    key = hashlib.sha256(json.dumps([source_hash, options]).encode()).hexdigest()
    with (directory / 'run.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            emit({'status': 'busy', 'message': '原任务仍在运行，请查询 status；不要重复启动。',
                  'jobs': records(directory)})
            return 75
        cancelled = directory / ('cancel-' + args.request_id)
        if cancelled.exists():
            emit({'status': 'cancelled', 'requestId': args.request_id})
            return 130
        job_id = uuid.uuid4().hex
        lock.seek(0)
        lock.truncate()
        lock.write(job_id)
        lock.flush()
        path = directory / (job_id + '.json')
        job = dict(id=job_id, requestId=args.request_id, kind=args.kind, key=key,
                   continueWorkflow=args.continue_workflow,
                   source=str(source.relative_to(root)), sourceFingerprint=source_hash,
                   output=str(output.relative_to(root)), status='running',
                   startedAt=time.time(), updatedAt=time.time(), exitCode=None,
                   stdout=f'.yingya/production-jobs/{job_id}.stdout.log',
                   stderr=f'.yingya/production-jobs/{job_id}.stderr.log')
        for previous in records(directory):
            if (previous.get('key') == key and previous.get('status') in ('succeeded', 'publishing')
                    and existing_output and previous.get('outputSha256') == existing_output
                    and (args.kind != 'render' or verification_valid(root, previous, existing_output))):
                job.update(status='succeeded', exitCode=0, reusedFrom=previous['id'],
                           outputSha256=existing_output, message='输入与产物一致，复用已完成结果。')
                if args.kind == 'render':
                    for field in ['renderVerification', 'renderVerificationSha256', 'renderVerificationJobId']:
                        job[field] = previous[field]
                save(path, job)
                emit(job)
                return 0
        if existing_output:
            raise ValueError('output already exists without a matching successful receipt; choose a new output path')
        executable = Path(os.environ['YINGYA_NODE_MODULES']) / '.bin/hyperframes'
        temporary = output.with_name('.' + output.stem + '.' + job_id + output.suffix)
        command = [str(executable), args.kind]
        if args.kind == 'check':
            command += ['--snapshots', '--json', *args.check_args]
        else:
            command = [sys.executable, str(Path(__file__).resolve()), 'capture', '--project', str(root),
                       '--source', str(source.relative_to(root)) or '.', '--output', str(temporary.relative_to(root)),
                       '--request-id', args.request_id, '--quality', args.quality,
                       '--resolution', args.resolution, '--fps', str(args.fps), '--timeout', str(args.timeout)]
        save(path, job)
        save(directory / (job_id + '.fingerprint.json'), {'files': files})
        emit(job)  # A yielding client gets an actual job handle even with no CLI output.
        child = None
        interrupted = False

        def interrupt(_signum, _frame):
            nonlocal interrupted
            interrupted = True

        def verify_command(command, **options):
            nonlocal child
            limit = min(deadline, time.monotonic() + options.get('timeout', 30))
            child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True, stdin=subprocess.DEVNULL, start_new_session=True,
                                     pass_fds=(lock.fileno(),))
            while True:
                if interrupted or cancelled.exists():
                    stop(child)
                    child.communicate()
                    raise VerificationCancelled('用户已停止导出验收。')
                if time.monotonic() >= limit:
                    stop(child)
                    child.communicate()
                    raise subprocess.TimeoutExpired(command, options.get('timeout', 30))
                try:
                    stdout, stderr = child.communicate(timeout=min(.25, limit - time.monotonic()))
                    return subprocess.CompletedProcess(command, child.returncode, stdout, stderr)
                except subprocess.TimeoutExpired:
                    job['updatedAt'] = time.time()
                    save(path, job)

        signal.signal(signal.SIGTERM, interrupt)
        signal.signal(signal.SIGINT, interrupt)
        try:
            with (root / job['stdout']).open('wb') as stdout, (root / job['stderr']).open('wb') as stderr:
                child = subprocess.Popen(command, cwd=source, stdout=stdout, stderr=stderr,
                                         stdin=subprocess.DEVNULL, start_new_session=True,
                                         pass_fds=(lock.fileno(),))
                deadline = time.monotonic() + args.timeout
                while child.poll() is None:
                    if interrupted or cancelled.exists():
                        stop(child)
                        job.update(status='cancelled', message='用户已停止任务。')
                        break
                    if time.monotonic() >= deadline:
                        stop(child)
                        job.update(status='failed', message=f'{args.kind} 超过 {args.timeout} 秒执行上限。')
                        break
                    job['updatedAt'] = time.time()
                    save(path, job)
                    time.sleep(.5)
                job['exitCode'] = child.wait()
            if job['status'] != 'running':
                return 130 if job['status'] == 'cancelled' else 124
            if job['exitCode'] != 0:
                raise ValueError(f'HyperFrames {args.kind} 退出码 {job["exitCode"]}；详见 {job["stderr"]} 和 {job["stdout"]}')
            if fingerprint(source, output)[0] != source_hash:
                raise ValueError('运行期间源文件或依赖已变化，请检查改动后重新执行。')
            if args.kind == 'check':
                report = json.loads((root / job['stdout']).read_text())
                if not isinstance(report, dict) or report.get('ok') is not True:
                    raise ValueError('检查报告未通过；完整报告保存在 stdout 日志。')
                save(temporary, report)
            else:
                probe = verify_command(['ffprobe', '-v', 'error', '-show_streams', '-show_format',
                                        '-of', 'json', str(temporary)], capture_output=True, text=True, timeout=30)
                media = json.loads(probe.stdout) if probe.returncode == 0 else {}
                if not any(s.get('codec_type') == 'video' for s in media.get('streams', [])) or float(media.get('format', {}).get('duration', 0)) <= 0:
                    raise ValueError('渲染输出缺少可读取的视频流或有效时长。')
                verify_render(root, source, temporary, job, media, verify_command)
            if interrupted or cancelled.exists():
                job.update(status='cancelled', message='用户已停止任务。')
                return 130
            if fingerprint(source, output)[0] != source_hash:
                raise ValueError('验收期间源文件或依赖已变化，请检查改动后重新执行。')
            # Record the expected hash before rename so crash recovery can recognize
            # a completed output without rerendering or blessing unrelated media.
            job['outputSha256'] = digest(temporary)
            job['status'] = 'publishing'
            save(path, job)
            temporary.replace(output)
            job.update(status='succeeded', message='检查通过。' if args.kind == 'check'
                       else '导出及媒体提帧检查完成；请打开实际 MP4 审阅帧确认内容与可读性。')
            return 0
        except VerificationCancelled as error:
            job.update(status='cancelled', message=str(error))
            return 130
        except (OSError, ValueError, KeyError, TypeError, StopIteration, subprocess.SubprocessError) as error:
            if child is not None:
                stop(child)
            job.update(status='failed', message=str(error))
            return job.get('exitCode') or 1
        finally:
            job['updatedAt'] = time.time()
            save(path, job)
            emit(job)


def standalone(args, root):
    """UI exports share the exact verifier without starting another render job.

    The before receipt is create-once evidence. A recovered final file must have
    the same pre-render receipt, source, logs and bytes; computing a new hash
    after rendering cannot authorize an existing output.
    """
    source, output = inside(root, args.source), inside(root, args.output)
    reports = inside(root, '.yingya/reports')
    reports.mkdir(parents=True, exist_ok=True)
    before_path = reports / ('export-' + args.request_id + '-before.json')
    result_path = reports / ('export-' + args.request_id + '-result.json')
    with (reports / ('export-' + args.request_id + '.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        source_hash, files = fingerprint(source, output)
        identity = dict(requestId=args.request_id, source=str(source.relative_to(root)),
                        output=str(output.relative_to(root)))
        if args.kind == 'fingerprint':
            if before_path.exists():
                before = json.loads(before_path.read_text())
                if any(before.get(k) != v for k, v in identity.items()) or before.get('sourceFingerprint') != source_hash:
                    raise ValueError('本次导出的既有输入快照与当前源文件不一致；请创建新的导出任务。')
            else:
                if output.exists():
                    raise ValueError('既有成片缺少渲染前输入快照，不能事后创建验收凭证。')
                before = dict(schemaVersion=1, **identity, sourceFingerprint=source_hash,
                              files=files, createdAt=time.time())
                save(before_path, before)
            emit(dict(ok=True, sourceFingerprint=source_hash, before=str(before_path.relative_to(root))))
            return 0
        if not args.source_fingerprint or not args.input or not args.stdout or not args.stderr:
            raise ValueError('verify requires --source-fingerprint, --input, --stdout and --stderr')
        if not before_path.is_file():
            raise ValueError('导出缺少本任务的渲染前输入快照，无法验收或恢复。')
        before = json.loads(before_path.read_text())
        if (any(before.get(k) != v for k, v in identity.items())
                or before.get('sourceFingerprint') != args.source_fingerprint
                or source_hash != args.source_fingerprint):
            raise ValueError('渲染前后源文件指纹不一致；不能验收或恢复此导出。')
        temporary = inside(root, args.input)
        logs = {name: str(inside(root, getattr(args, name)).relative_to(root)) for name in ('stdout', 'stderr')}
        log_hashes = {name: digest(root / path) for name, path in logs.items()}
        output_hash = digest(temporary)
        if result_path.is_file():
            previous = json.loads(result_path.read_text())
            if (previous.get('sourceFingerprint') == source_hash and previous.get('logHashes') == log_hashes
                    and previous.get('stdout') == logs['stdout'] and previous.get('stderr') == logs['stderr']
                    and verification_valid(root, previous, output_hash)):
                emit(dict(ok=True, report=previous['renderVerification'], reportSha256=previous['renderVerificationSha256'],
                          sourceFingerprint=source_hash, outputSha256=output_hash, reused=True))
                return 0
        job = dict(id=uuid.uuid4().hex, **identity, sourceFingerprint=source_hash, **logs, logHashes=log_hashes)
        deadline = time.monotonic() + args.timeout
        interrupted = False

        def interrupt(_signum, _frame):
            nonlocal interrupted
            interrupted = True

        def command(argv, **options):
            child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                     stdin=subprocess.DEVNULL, start_new_session=True, pass_fds=(lock.fileno(),))
            limit = min(deadline, time.monotonic() + options.get('timeout', 30))
            while True:
                if interrupted or time.monotonic() >= limit:
                    stop(child)
                    child.communicate()
                    if interrupted:
                        raise VerificationCancelled('用户已停止导出验收。')
                    raise subprocess.TimeoutExpired(argv, args.timeout)
                try:
                    out, err = child.communicate(timeout=max(.001, min(.25, limit - time.monotonic())))
                    return subprocess.CompletedProcess(argv, child.returncode, out, err)
                except subprocess.TimeoutExpired:
                    pass

        signal.signal(signal.SIGTERM, interrupt)
        signal.signal(signal.SIGINT, interrupt)
        probe = command(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(temporary)], timeout=30)
        if probe.returncode:
            raise ValueError('实际导出文件无法读取视频信息。')
        verify_render(root, source, temporary, job, json.loads(probe.stdout), command)
        if (interrupted or fingerprint(source, output)[0] != source_hash or digest(temporary) != output_hash
                or {name: digest(root / path) for name, path in logs.items()} != log_hashes):
            raise ValueError('验收期间源文件、导出或本次日志已改变；请重新检查。')
        job['status'] = 'succeeded'
        save(result_path, job)
        emit(dict(ok=True, report=job['renderVerification'], reportSha256=job['renderVerificationSha256'],
                  sourceFingerprint=source_hash, outputSha256=output_hash, reused=False))
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['check', 'render', 'capture', 'status', 'cancel', 'fingerprint', 'verify'])
    parser.add_argument('--project', default='.')
    parser.add_argument('--request-id', required=True)
    parser.add_argument('--source', default='.')
    parser.add_argument('--output')
    parser.add_argument('--input')
    parser.add_argument('--stdout')
    parser.add_argument('--stderr')
    parser.add_argument('--source-fingerprint')
    parser.add_argument('--quality', choices=['draft', 'standard', 'high'], default='high')
    parser.add_argument('--resolution', default='landscape')
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--timeout', type=int, default=1200)
    parser.add_argument('--continue-workflow', action='store_true',
                        help='allow completion of the already-authorized production request')
    argv = sys.argv[1:]
    split = argv.index('--') if '--' in argv else len(argv)
    args = parser.parse_args(argv[:split])
    args.check_args = argv[split + 1:]
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', args.request_id):
        parser.error('invalid request ID')
    maximum_timeout = 7200 if args.kind == 'capture' else 3600
    if not 1 <= args.timeout <= maximum_timeout:
        parser.error(f'timeout must be between 1 and {maximum_timeout} seconds')
    root = Path(args.project).resolve()
    if args.kind == 'capture':
        if not args.output:
            parser.error('--output is required for capture')
        return capture(args, root)
    directory = inside(root, '.yingya/production-jobs')
    directory.mkdir(parents=True, exist_ok=True)
    if args.kind == 'cancel':
        (directory / ('cancel-' + args.request_id)).touch()
        emit({'status': 'cancelling', 'requestId': args.request_id})
        return 0
    if args.kind == 'status':
        jobs = records(directory, args.request_id)
        running = active_job(directory)
        for job in jobs:
            if job.get('status') in ('running', 'publishing') and running != job['id']:
                output = inside(root, job['output'])
                job['status'] = ('succeeded' if job.get('status') == 'publishing' and output.is_file()
                                 and digest(output) == job.get('outputSha256')
                                 and (job.get('kind') != 'render'
                                      or verification_valid(root, job, job.get('outputSha256'))) else 'lost')
                job['message'] = '结果已恢复。' if job['status'] == 'succeeded' else '执行进程已退出且没有完整结果；保留日志供检查。'
                save(directory / (job['id'] + '.json'), job)
        emit({'jobs': jobs})
        return 0
    if not args.output:
        parser.error('--output is required for check/render/fingerprint/verify')
    if args.kind in ('fingerprint', 'verify'):
        return standalone(args, root)
    if any(a in ('--output', '--no-json', '--no-snapshots') for a in args.check_args):
        parser.error('output/report flags are managed by the runner')
    return execute(args, root, directory)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, StopIteration, subprocess.SubprocessError) as error:
        if 'capture' in sys.argv[1:2]:
            print(str(error), file=sys.stderr, flush=True)
        emit({'ok': False, 'status': 'failed', 'message': str(error)})
        sys.exit(1)
