#!/usr/bin/env python3
"""Prepare a release-local loader for Remotion on Linux x64 with glibc < 2.35.

Never installs packages or modifies the system loader. The .deb checksum comes
from Ubuntu's signed jammy-security Packages index (verified 2026-09-28).
Retains libc6 copyright/notices and uses the unmodified npm renderer binaries.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

PACKAGE = 'libc6_2.35-0ubuntu3.15_amd64.deb'
SHA256 = '79e35256227e16a607c154cdeb8d76ff12d20e31de286ea7fd9ad3b96fe0452d'
MIRRORS = ['https://archive.ubuntu.com/ubuntu', 'https://mirrors.aliyun.com/ubuntu']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--store', type=Path)
    args = parser.parse_args()
    resources = args.resources.resolve()
    libc, version = platform.libc_ver()
    if platform.system() != 'Linux' or platform.machine() != 'x86_64' or libc != 'glibc' or tuple(map(int, version.split('.'))) >= (2, 35):
        print('Remotion uses the native platform libraries')
        return
    store = (args.store or resources / '.runtime/remotion-downloads').resolve()
    store.mkdir(parents=True, exist_ok=True)
    archive = store / PACKAGE
    if not archive.exists() or digest(archive) != SHA256:
        with tempfile.TemporaryDirectory(prefix='remotion-download-', dir=store) as temporary:
            candidate = Path(temporary) / PACKAGE
            for mirror in MIRRORS:
                result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--max-time', '30',
                                         mirror + '/pool/main/g/glibc/' + PACKAGE, '--output', str(candidate)])
                if result.returncode == 0 and digest(candidate) == SHA256:
                    candidate.replace(archive)
                    break
            else:
                raise RuntimeError('Unable to obtain the pinned, verified Remotion libc6 package')
    destination = resources / 'runtime/remotion/native'
    receipt = destination / 'runtime.json'
    if receipt.exists() and json.loads(receipt.read_text()).get('sha256') == SHA256:
        print('Remotion isolated loader already prepared')
        return
    if destination.exists():
        raise RuntimeError('Refusing to overwrite a different native runtime; use a fresh release')
    with tempfile.TemporaryDirectory(prefix='remotion-native-', dir=destination.parent) as temporary:
        staging = Path(temporary)
        subprocess.run(['dpkg-deb', '-x', str(archive), str(staging / 'libc6')], check=True)
        (staging / 'bin').mkdir()
        for name in ['remotion', 'ffmpeg', 'ffprobe']:
            wrapper = staging / 'bin' / name
            wrapper.write_text('''#!/bin/sh
set -eu
yingya_bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
yingya_resources=$(CDPATH= cd -- "$yingya_bin_dir/../../../.." && pwd)
yingya_lib="$yingya_bin_dir/../libc6/lib/x86_64-linux-gnu"
yingya_package="$yingya_resources/node_modules/@remotion/compositor-linux-x64-gnu"
exec "$yingya_lib/ld-linux-x86-64.so.2" --library-path "$yingya_lib:$yingya_package" "$yingya_package/''' + name + '''" "$@"
''')
            wrapper.chmod(0o755)
        (staging / 'runtime.json').write_text(json.dumps({'schemaVersion': 1, 'package': PACKAGE, 'sha256': SHA256,
            'source': MIRRORS[0] + '/pool/main/g/glibc/' + PACKAGE,
            'sourceCode': 'https://archive.ubuntu.com/ubuntu/pool/main/g/glibc/glibc_2.35.orig.tar.xz',
            'patches': 'https://archive.ubuntu.com/ubuntu/pool/main/g/glibc/glibc_2.35-0ubuntu3.15.debian.tar.xz'}, indent=2))
        shutil.copytree(staging, destination)
    subprocess.run([str(destination / 'bin/ffprobe'), '-version'], check=True, stdout=subprocess.DEVNULL)
    print('Remotion isolated loader prepared; system glibc unchanged')


if __name__ == '__main__':
    main()
