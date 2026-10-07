#!/usr/bin/env python3
"""Provision a versioned offline CPU speech model for all Yingya sandboxes."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import urllib.request

REPO = Path(__file__).resolve().parents[1]


def digest(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def provision(resources, store):
    spec = resources / 'runtime/captions'
    lock = spec / 'requirements.lock'
    model = json.loads((spec / 'model.json').read_text())
    fingerprint = hashlib.sha256(lock.read_bytes() + (spec / 'model.json').read_bytes()
                                 + b'python3.12-cpu-int8-v1' + platform.machine().encode()).hexdigest()[:16]
    store.mkdir(parents=True, exist_ok=True)
    target = store / fingerprint
    with (store / 'setup.lock').open('a') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        ready = target / 'ready.json'
        if not ready.is_file():
            target.mkdir(exist_ok=True)
            env = dict(os.environ, UV_PYTHON_INSTALL_DIR=str(target / 'interpreters'),
                       UV_PYTHON_BIN_DIR=str(target / 'bin'), UV_LINK_MODE='copy')
            uv = shutil.which('uv')
            if not uv:
                raise RuntimeError('uv is required to provision offline captions')
            subprocess.run([uv, 'python', 'install', '3.12', '--no-bin'], env=env, check=True)
            if not (target / 'venv/bin/python').exists():
                subprocess.run([uv, 'venv', '--managed-python', '--python', '3.12', str(target / 'venv')], env=env, check=True)
            subprocess.run([uv, 'pip', 'sync', '--python', str(target / 'venv/bin/python'),
                            '--require-hashes', str(lock)], env=env, check=True)
            directory = target / 'model'
            directory.mkdir(exist_ok=True)
            for name, expected in model['files'].items():
                file = directory / name
                if file.is_file() and digest(file) == expected:
                    continue
                temporary = file.with_suffix('.download')
                url = f"https://huggingface.co/{model['repository']}/resolve/{model['revision']}/{name}?download=true"
                print(f'Downloading pinned captions model: {name}', flush=True)
                with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as output:
                    shutil.copyfileobj(response, output, 1024 * 1024)
                if digest(temporary) != expected:
                    temporary.unlink()
                    raise RuntimeError(f'Captions model hash mismatch: {name}')
                temporary.replace(file)
            subprocess.run([str(target / 'venv/bin/python'), '-c',
                            'from faster_whisper import WhisperModel; import sys; WhisperModel(sys.argv[1], device="cpu", compute_type="int8", cpu_threads=2, local_files_only=True)',
                            str(directory)], env=dict(env, PYTHONDONTWRITEBYTECODE='1'), check=True)
            ready.write_text(json.dumps({'fingerprint': fingerprint, **model}))
        link = resources / '.runtime/captions-runtime'
        link.parent.mkdir(parents=True, exist_ok=True)
        temporary = link.with_name('captions-runtime.next')
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(target, target_is_directory=True)
        temporary.replace(link)
    print(f'Offline captions: {target}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, default=REPO)
    parser.add_argument('--store', type=Path, default=REPO / '.runtime/captions')
    args = parser.parse_args()
    provision(args.resources.resolve(), args.store.resolve())
