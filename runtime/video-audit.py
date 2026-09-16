#!/usr/bin/env python3
"""Read-only delivery checks, independent of the authoring agent and its claims.

Uses stdlib + ffmpeg/ffprobe. It does not prove semantic or word-level alignment;
it rejects incomplete checks, broken media windows and gross blank/silent output.
"""
import argparse
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit


class AuditError(Exception):
    pass


def number(value, default=0):
    result = float(value if value is not None else default)
    if not math.isfinite(result):
        raise AuditError("时间必须是有限数值")
    return result


class Composition(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.nodes = []
        self.stack = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        offset = sum(number(a.get('data-start')) for _, a in self.stack
                     if 'data-composition-id' in a)
        self.nodes.append((tag, attrs, offset))
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                       'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.stack.append((tag, attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)


def local_path(root, value):
    url = urlsplit(value)
    if url.scheme or url.netloc or not url.path:
        raise AuditError(f"验收需要可读取的本地媒体：{value}")
    path = (root / unquote(url.path)).resolve()
    if root.resolve() not in path.parents or not path.is_file():
        raise AuditError(f"版本缺少本地依赖或路径超出版本目录：{value}")
    return path


def run(args, timeout=120):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    if result.returncode:
        raise AuditError(f"媒体解码失败：{result.stderr.decode(errors='replace')[-500:]}")
    return result


def probe(path):
    return json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format',
                           '-of', 'json', str(path)], 30).stdout)


def report_issues(report, moving):
    issues = []
    if report.get('ok') is not True:
        issues.append('HyperFrames 质量检查未通过')
    for gate in ['lint', 'runtime', 'layout', 'contrast']:
        section = report.get(gate, {})
        if section.get('ok') is not True or section.get('errorCount') != 0:
            issues.append(f'质量报告缺少通过的 {gate} 检查')
    if report.get('contrast', {}).get('enabled') is not True:
        issues.append('对比度检查未启用')
    if moving:
        motion = report.get('motion', {})
        if (motion.get('enabled') is not True or motion.get('ok') is not True
                or not motion.get('samples') or motion.get('errorCount') != 0):
            issues.append('多场景/动画视频必须启用并通过动效断言；不能删除 motion 文件跳过检查')
    return issues


def audit(source, report_path=None, video=None):
    issues = []
    entry = source / 'index.html'
    text = entry.read_text()
    nodes = Composition(text).nodes
    for tag, attrs, _ in nodes:
        reference = attrs.get('src') or (attrs.get('href') if tag == 'link' else None)
        if reference and not urlsplit(reference).scheme and not reference.startswith('//'):
            local_path(source, reference)
    roots = [a for _, a, offset in nodes if 'data-composition-id' in a and offset == 0]
    if not roots:
        raise AuditError('缺少视频 composition 根节点')
    duration = number(roots[0].get('data-duration'))
    if duration <= 0:
        raise AuditError('交付版本必须声明有效的总时长')
    scenes_path = source / 'scenes.json'
    scenes = json.loads(scenes_path.read_text()) if scenes_path.exists() else []
    if isinstance(scenes, dict):
        scenes = scenes.get('scenes', [])
    narrated = any(isinstance(s, dict) and isinstance(s.get('narration'), str)
                   and s['narration'].strip() for s in scenes)
    scene_nodes = [a for tag, a, _ in nodes if tag not in {'audio', 'video'}
                   and 'data-composition-id' not in a and 'data-duration' in a]
    moving = len(scenes) > 1 or len(scene_nodes) > 1 or 'gsap.timeline' in text
    if moving:
        try:
            motion = json.loads((source / 'index.motion.json').read_text())
            assertions = motion.get('assertions', [])
            if not assertions or not all(isinstance(a, dict) and a.get('kind') for a in assertions):
                issues.append('动效断言为空或格式无效，请按 CLI schema 修正')
        except (ValueError, OSError):
            issues.append('多场景/动画源缺少有效的 index.motion.json，旧的通过报告不能替代断言文件')
    if (len(scenes) > 1 or len(scene_nodes) > 1) and any('data-no-timeline' in a for a in roots):
        issues.append('多场景视频不能用 data-no-timeline 绕过时间轴；请恢复场景切换')
    if report_path is not None:
        try:
            report = json.loads(report_path.read_text())
            issues.extend(report_issues(report, moving))
        except (ValueError, OSError):
            issues.append('缺少完整 JSON 质量报告；请将 stderr 日志与 JSON 分开保存')
    audio_windows = []
    for tag, attrs, offset in nodes:
        if tag != 'audio':
            continue
        path = local_path(source, attrs.get('src', ''))
        info = probe(path)
        actual = number(info['format'].get('duration'))
        start = offset + number(attrs.get('data-start'))
        trim = number(attrs.get('data-media-start'))
        length = number(attrs.get('data-duration'), actual - trim)
        if not attrs.get('id') or 'data-start' not in attrs:
            issues.append(f'{path.name} 缺少 id 或明确的播放起点')
        if start < 0 or trim < 0 or length <= 0 or start + length > duration + .15:
            issues.append(f'{path.name} 播放区间超出视频时间轴')
        if 'loop' not in attrs and trim + length > actual + .25:
            issues.append(f'{path.name} 声明播放 {length:.2f} 秒，但可用音频只有 {actual-trim:.2f} 秒')
        is_voice = narrated and (len([n for n in nodes if n[0] == 'audio']) == 1
                                or not re.search(r'bgm|music|sfx|soundtrack|ambien', str(path), re.I))
        if is_voice:
            if trim == 0 and actual - length > max(.5, actual * .1):
                issues.append(f'{path.name} 旁白从 {actual:.2f} 秒截成 {length:.2f} 秒；请按实测时长对齐')
            audio_windows.append((start, min(start + length, start + actual - trim)))
    if narrated and not audio_windows:
        issues.append('分镜包含旁白，但交付源没有可验证的旁白音轨')
    ordered = sorted(audio_windows)
    for left, right in zip(ordered, ordered[1:]):
        if left[1] - right[0] > .25:
            issues.append(f'旁白音轨在 {right[0]:.2f} 秒发生重叠，请检查全局偏移')
            break
    metrics = {'duration': duration, 'narrationWindows': audio_windows}
    if video is not None:
        info = probe(video)
        streams = info.get('streams', [])
        video_stream = next((s for s in streams if s.get('codec_type') == 'video'), None)
        actual = number(info['format'].get('duration'))
        if not video_stream:
            raise AuditError('成片没有视频轨道')
        if abs(actual - duration) > max(.25, duration * .005):
            issues.append(f'成片时长 {actual:.2f} 秒与源时间轴 {duration:.2f} 秒不一致')
        # Sample decoded frames, rather than trusting author-supplied screenshots.
        frames = run(['ffmpeg', '-v', 'error', '-threads', '1', '-i', str(video),
                      '-an', '-vf', 'fps=1,scale=64:36', '-pix_fmt', 'gray',
                      '-f', 'rawvideo', '-']).stdout
        size = 64 * 36
        blank = longest = 0
        for i in range(0, len(frames) - size + 1, size):
            frame = frames[i:i + size]
            mean = sum(frame) / size
            variance = sum((p - mean) ** 2 for p in frame) / size
            blank = blank + 1 if variance < 2 else 0
            longest = max(longest, blank)
        metrics['longestUniformFrameSeconds'] = longest
        if longest >= max(4, duration * .15):
            issues.append(f'成片连续约 {longest} 秒为纯色空白画面，请检查隐藏状态与场景切换')
        if narrated:
            if not any(s.get('codec_type') == 'audio' for s in streams):
                issues.append('成片缺少预期旁白音轨')
            else:
                result = run(['ffmpeg', '-hide_banner', '-threads', '1', '-i', str(video),
                              '-vn', '-af', 'silencedetect=noise=-50dB:d=1', '-f', 'null', '-'])
                log = result.stderr.decode(errors='replace')
                starts = [float(s) for s in re.findall(r'silence_start: ([\d.]+)', log)]
                ends = [float(s) for s in re.findall(r'silence_end: ([\d.]+)', log)]
                longest_missing = 0
                for start, end in zip(starts, ends):
                    overlap = sum(max(0, min(end, b) - max(start, a)) for a, b in audio_windows)
                    longest_missing = max(longest_missing, overlap)
                metrics['longestMissingNarrationSeconds'] = longest_missing
                if longest_missing >= 3:
                    issues.append(f'预期旁白区间内约 {longest_missing:.1f} 秒静音，请检查混音与音轨')
    return {'ok': not issues, 'issues': issues, 'metrics': metrics}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--video', type=Path)
    args = parser.parse_args()
    try:
        result = audit(args.source.resolve(), args.report, args.video)
    except (AuditError, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        result = {'ok': False, 'issues': [str(error)]}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
