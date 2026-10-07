#!/usr/bin/env python3
"""Encode homepage films as one fast-start stream (1440p for the main film, 1080p for examples) and a WebP poster."""
import argparse
import hashlib
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

FILMS = {
    'intro-1': ('intro-1.mp4', 13.7),
    'demo-1': ('demo-1.mp4', 28),
    'demo-2': ('demo-2.mp4', 18),
    'demo-3': ('demo-3.mp4', 3.8),
    'demo-4': ('demo-4.mp4', 6.3),
    'demo-5': ('demo-5.mp4', 5.8),
    'demo-6': ('demo-6.mp4', 18.75),
    'demo-7': ('YingYa-1.mp4', 9.5),
    'demo-8': ('yingya-2.mp4', 18.5),
    'demo-9': ('YingYa-Cloud-Express.mp4', 6),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'web/src/assets/showcase')
    parser.add_argument('--clips', nargs='+', choices=FILMS, default=list(FILMS))
    args = parser.parse_args()
    for name in args.clips:
        if not (args.source / FILMS[name][0]).is_file():
            parser.error(f'Missing source: {args.source / FILMS[name][0]}')
    args.output.mkdir(parents=True, exist_ok=True)

    def encode(name):
        filename, frame = FILMS[name]
        source = args.source / filename
        main_film = name == 'intro-1'
        height, fps = (1440, 60) if main_film else (1080, 30)
        target = args.output / f'{name}-{height}.mp4'
        poster = args.output / f'{name}.webp'
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source),
            '-map', '0:v:0', '-map', '0:a:0?', '-vf', f'scale=-2:{height},fps={fps}',
            '-c:v', 'libx264', '-threads', '3', '-preset', 'slow' if main_film else 'medium', '-crf', '22' if main_film else '24',
            '-maxrate', '5000k' if main_film else '3200k', '-bufsize', '18000k' if main_film else '6400k', '-pix_fmt', 'yuv420p',
            '-g', str(fps * 2), '-c:a', 'aac', '-b:a', '128k' if main_film else '96k', '-movflags', '+faststart',
            '-y', str(target),
        ], check=True)
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(frame),
            '-i', str(source), '-frames:v', '1', '-vf',
            'scale=2560:-1' if main_film else 'scale=800:-1',
            '-c:v', 'libwebp', '-quality', '88' if main_film else '82', '-y', str(poster),
        ], check=True)
        print(f'{target.name}: {target.stat().st_size} bytes', flush=True)
        return name, {
            'original': source.stat().st_size,
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            f'{height}p': target.stat().st_size,
            'frameRate': fps,
            'poster': poster.stat().st_size,
        }

    report_path = args.output / 'encoding.json'
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        report.update(pool.map(encode, args.clips))
    report_path.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
