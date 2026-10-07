"""Project-local, non-overwriting media-tool I/O shared by captions and audio."""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile


def project_file(project, relative, exists=True):
    root = Path(project).resolve(strict=True)
    value = Path(relative)
    if value.is_absolute() or '..' in value.parts or not value.parts or '\\' in str(relative):
        raise ValueError('Use a project-relative path without traversal')
    current = root
    for part in value.parts:
        current /= part
        if current.is_symlink():
            raise ValueError('Media inputs and outputs must not use symlinks')
    if exists and not current.is_file():
        raise ValueError(f'Missing project file: {relative}')
    return current


def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def run(args, timeout=600):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise ValueError(result.stderr[-3000:] or f'{args[0]} exited {result.returncode}')
    return result


def probe(file):
    result = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).stdout)
    duration = float(result.get('format', {}).get('duration', 0))
    if not math.isfinite(duration) or not 0 < duration <= 3600:
        raise ValueError('Expected finite media duration between 0 and 3600 seconds')
    if not any(s.get('codec_type') == 'audio' for s in result['streams']):
        raise ValueError('Source has no audio stream')
    return duration


def publish(temporary, output):
    # Same-filesystem hard link makes publication atomic and refuses an existing
    # path even if another process created it while processing the media.
    os.link(temporary, output)


def write_json(output, value):
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.media-', suffix='.json', dir=output.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write('\n')
        publish(temporary, output)
    finally:
        os.unlink(temporary)
