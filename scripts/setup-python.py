#!/usr/bin/env python3
"""Provision one versioned, shared Python environment for all user sandboxes."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[1]
IMPORTS = "requests,httpx,bs4,lxml.etree,PIL,numpy,pandas,scipy,matplotlib,pypdf,docx,pptx,openpyxl"


def provision(resources, store):
    spec = resources / 'runtime/python'
    version = (spec / 'python-version').read_text().strip()
    lock = spec / 'requirements.lock'
    fingerprint = hashlib.sha256(version.encode() + lock.read_bytes()
                                 + platform.machine().encode() + platform.system().encode()).hexdigest()[:16]
    store.mkdir(parents=True, exist_ok=True)
    target = store / fingerprint
    with (store / 'setup.lock').open('a') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        if not (target / 'ready.json').is_file():
            if target.exists():
                shutil.rmtree(target)  # Only incomplete, unpublished installations.
            target.mkdir()
            env = dict(os.environ, UV_PYTHON_INSTALL_DIR=str(target / 'interpreters'),
                       UV_PYTHON_BIN_DIR=str(target / 'bin'), UV_LINK_MODE='copy')
            uv = shutil.which('uv')
            if not uv:
                raise RuntimeError('uv is required on the host to provision shared Python')
            def run(*args):
                subprocess.run([uv, *map(str, args)], env=env, check=True)
            run('python', 'install', version, '--no-bin')
            run('venv', '--managed-python', '--python', version, target / 'venv')
            run('pip', 'sync', '--python', target / 'venv/bin/python', '--require-hashes', lock)
            subprocess.run([str(target / 'venv/bin/python'), '-c',
                            f'import {IMPORTS}; import sys; assert sys.version_info[:2] == (3, 12)'],
                           env=dict(env, PYTHONDONTWRITEBYTECODE='1'), check=True)
            (target / 'ready.json').write_text(json.dumps({'python': version, 'fingerprint': fingerprint}))
        link = resources / '.runtime/python-runtime'
        link.parent.mkdir(parents=True, exist_ok=True)
        temporary = link.with_name('python-runtime.next')
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(target, target_is_directory=True)
        temporary.replace(link)
    print(f'Shared Python {version}: {target}; release link: {link}')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, default=REPO)
    parser.add_argument('--store', type=Path, default=REPO / '.runtime/python')
    args = parser.parse_args()
    provision(args.resources.resolve(), args.store.resolve())
