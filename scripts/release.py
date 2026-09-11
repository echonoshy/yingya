#!/usr/bin/env python3
"""Build immutable releases and switch a tmux-managed, single-host deployment."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import time
import urllib.request
import uuid

REPO = Path(__file__).resolve().parents[1]


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.flush()
        os.fsync(file.fileno())
    temporary.replace(path)


def has_session(name):
    return subprocess.run(['tmux', 'has-session', '-t', '=' + name], capture_output=True).returncode == 0


def start_session(name, cwd, env, command, port):
    if has_session(name):
        raise RuntimeError(f'tmux={name} already exists; inspect it before replacing it')
    args = ['tmux', 'new-session', '-d', '-s', name, '-c', str(cwd)]
    for key, value in env.items():
        if key not in ('TMUX', 'TMUX_PANE'):
            args += ['-e', f'{key}={value}']
    run(args + [str(a) for a in command])
    subprocess.run(['tmux', 'set-option', '-t', name, '@yingya-port', str(port)], check=False, stderr=subprocess.DEVNULL)
    print(f'Started: tmux={name} port={port}', flush=True)


def get(url):
    # Never send loopback health probes through an inherited external proxy.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=2) as response:
        return response.read()


def wait_ready(port, release):
    for _ in range(120):
        try:
            get(f'http://127.0.0.1:{port}/ready')
            if json.loads(get(f'http://127.0.0.1:{port}/health'))['release'] == release:
                return
        except (OSError, ValueError):
            pass
        time.sleep(.25)
    raise RuntimeError(f'new API failed readiness on port {port}; traffic was not switched')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def environment(args, release):
    env = dict(os.environ)
    env.update(YINGYA_MODE='gateway', YINGYA_RELEASE_ID=release['id'],
               YINGYA_RESOURCE_DIR=release['resources'], YINGYA_APP_DATA_DIR=str(args.data),
               YINGYA_RUNTIME_DIR=str(args.runtime), YINGYA_CODEX_HOME=str(args.runtime / 'codex-home'),
               YINGYA_ENV_FILE=str(args.env_file))
    return env


def build(args):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', args.release):
        raise RuntimeError('release ID must contain 1-64 letters, digits, underscores or hyphens')
    root = args.releases / args.release
    root.mkdir(parents=True, exist_ok=False)
    # Snapshot the current worktree (including authorized, uncommitted changes),
    # then build there. Running workers never read changing source/dependencies.
    for name in ['src', 'web', 'skills', 'scripts']:
        shutil.copytree(REPO / name, root / name, ignore=shutil.ignore_patterns('node_modules', '__pycache__'))
    for name in ['Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json', 'tsconfig.json']:
        shutil.copy2(REPO / name, root / name)
    run(['npm', 'ci'], cwd=root)
    run(['npm', 'run', 'typecheck'], cwd=root)
    run(['npm', 'run', 'web:build'], cwd=root)
    run(['cargo', 'build', '--locked', '--release'], cwd=root)
    shutil.copy2(root / 'target/release/yingya-server', root / 'yingya-server')
    # Browser binaries are machine-local tooling, not mutable release source.
    (root / '.runtime').mkdir()
    (root / '.runtime/hyperframes-home').symlink_to(args.runtime / 'hyperframes-home', target_is_directory=True)
    manifest = {'id': args.release, 'binary': str(root / 'yingya-server'), 'resources': str(root)}
    atomic_json(root / 'release.json', manifest)
    print(root / 'release.json')


def nginx_config(root, port, api_port):
    # Paths are quoted and config metacharacters rejected by main().
    return f'''daemon off;
worker_processes 1;
pid "{root}/nginx.pid";
error_log "{root}/nginx-error.log";
events {{ worker_connections 4096; }}
http {{
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log "{root}/nginx-access.log";
    client_body_temp_path "{root}/body";
    proxy_temp_path "{root}/proxy";
    fastcgi_temp_path "{root}/fastcgi";
    uwsgi_temp_path "{root}/uwsgi";
    scgi_temp_path "{root}/scgi";
    server {{
        listen 127.0.0.1:{port};
        client_max_body_size 25m;
        location /static/ {{
            alias "{root}/static/";
            add_header Cache-Control "public, max-age=31536000, immutable";
        }}
        location / {{
            proxy_pass http://127.0.0.1:{api_port};
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header Connection "";
            proxy_buffering off;
            proxy_read_timeout 3600s;
            proxy_next_upstream off;
        }}
    }}
}}
'''


def process_identity(pid):
    try:
        # Linux /proc start time distinguishes a process from a later reused PID.
        value = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
        return {'pid': int(pid), 'start': value}
    except (OSError, IndexError):
        return None


def proxy_workers(root):
    pid = int((root / 'nginx.pid').read_text())
    return [identity for child in Path(f'/proc/{pid}/task/{pid}/children').read_text().split()
            if (identity := process_identity(child)) is not None]


def retire(args):
    root = args.data / 'deployment'
    record = json.loads((root / f'retire-{args.release}.json').read_text())
    while any(process_identity(p['pid']) == p for p in record['proxy_workers']):
        time.sleep(1)
    with (root / 'publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        active = json.loads((root / 'active.json').read_text())
        session = record['api_session']
        if active['api_session'] == session or not has_session(session):
            return
        pane = subprocess.check_output(['tmux', 'display-message', '-p', '-t', '=' + session + ':', '#{pane_pid}'], text=True).strip()
        if process_identity(pane) != record['api_process']:
            return
        run(['tmux', 'send-keys', '-t', '=' + session + ':', 'C-c'])
        print(f"Retiring: tmux={session} port={record['api_port']}; all old proxy connections finished")


def activate(args):
    release_path = args.releases / args.release / 'release.json'
    release = json.loads(release_path.read_text())
    if release['id'] != args.release:
        raise RuntimeError('release manifest identity mismatch')
    root = args.data / 'deployment'
    state_path = root / 'active.json'
    previous = json.loads(state_path.read_text()) if state_path.exists() else None
    if previous and previous['release'] == args.release:
        wait_ready(previous['api_port'], args.release)
        print(f"Already active: tmux={previous['api_session']} port={previous['api_port']}")
        return
    if previous and previous['port'] != args.port:
        raise RuntimeError('entry port cannot change during rolling activation')
    namespace = hashlib.sha256(str(args.data).encode()).hexdigest()[:8]
    nginx_session = f'yingya-entry-{namespace}'
    if not previous:
        with socket.socket() as sock:
            # Refuse to touch an existing development backend or unrelated listener.
            sock.bind(('127.0.0.1', args.port))
        if has_session(nginx_session):
            raise RuntimeError(f'tmux={nginx_session} exists without deployment state; inspect it first')
    api_session = f'yingya-api-{namespace}-{args.release}'
    reused = has_session(api_session)
    api_port = int(subprocess.check_output(['tmux','show-options','-qv','-t',api_session,'@yingya-port'],text=True)) if reused else free_port()
    env = environment(args, release)
    env['YINGYA_ADDR'] = f'127.0.0.1:{api_port}'
    if not reused:
        start_session(api_session, release['resources'], env, [release['binary']], api_port)
        args.candidate_session = api_session
    # Candidate failures leave the old entry and worker target untouched.
    wait_ready(api_port, args.release)
    for path in ['static', 'body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']:
        (root / path).mkdir(exist_ok=True)
    for source in (Path(release['resources']) / 'web-dist/static').rglob('*'):
        if source.is_file():
            dest = root / 'static' / source.relative_to(Path(release['resources']) / 'web-dist/static')
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists() and source.read_bytes() != dest.read_bytes():
                raise RuntimeError(f'immutable static asset collision: {dest.name}')
            if not dest.exists():
                temporary = dest.with_suffix(dest.suffix + '.tmp')
                shutil.copy2(source, temporary)
                temporary.replace(dest)
    config = root / 'nginx.conf'
    candidate = root / 'nginx.candidate.conf'
    candidate.write_text(nginx_config(root, args.port, api_port))
    run(['nginx', '-t', '-p', str(root) + '/', '-c', candidate])
    old_config = config.read_bytes() if config.exists() else None
    old_target_path = root / 'previous-target.json'
    # target snapshot supports rollback if switching the entry fails.
    import sqlite3
    with sqlite3.connect(root / 'registry.sqlite') as db:
        old_target = json.loads(db.execute('SELECT payload FROM target WHERE id=1').fetchone()[0])
    atomic_json(old_target_path, old_target)
    old_workers = proxy_workers(root) if previous else []
    candidate.replace(config)
    try:
        if previous:
            run(['nginx', '-p', str(root) + '/', '-c', config, '-s', 'reload'])
        else:
            start_session(nginx_session, REPO, env, ['nginx', '-p', str(root) + '/', '-c', config], args.port)
        wait_ready(args.port, args.release)
        run([release['binary'], 'runtime-target', release_path], cwd=release['resources'], env=env, stdout=subprocess.DEVNULL)
    except Exception:
        if old_config is not None:
            config.write_bytes(old_config)
            run(['nginx', '-p', str(root) + '/', '-c', config, '-s', 'reload'])
        elif has_session(nginx_session):
            run(['nginx', '-p', str(root) + '/', '-c', config, '-s', 'quit'])
        run([release['binary'], 'runtime-target', old_target_path], cwd=release['resources'], env=env, stdout=subprocess.DEVNULL)
        raise
    current = {'release': args.release, 'api_port': api_port, 'api_session': api_session,
               'entry_session': nginx_session, 'port': args.port, 'previous': previous['release'] if previous else None}
    atomic_json(state_path, current)
    args.candidate_session = None
    if previous and has_session(previous['api_session']):
        # nginx -s reload returning (or one new response) does not mean every old
        # worker has finished. Keep its upstream API alive until connections drain.
        retirement = uuid.uuid4().hex
        pane = subprocess.check_output(['tmux', 'display-message', '-p', '-t', '=' + previous['api_session'] + ':', '#{pane_pid}'], text=True).strip()
        atomic_json(root / f'retire-{retirement}.json', {
            'api_session': previous['api_session'], 'api_port': previous['api_port'],
            'api_process': process_identity(pane), 'proxy_workers': old_workers})
        start_session(f'yingya-retire-{namespace}-{retirement[:8]}', REPO, env,
            ['python3', Path(__file__).resolve(), 'retire', retirement, '--data', args.data], 0)
    print(f"Active: release={args.release} tmux={nginx_session} port={args.port}; tmux={api_session} port={api_port}")
    print('Workers finish their current work, then move to the active release. Old release files are retained.')


def status(args):
    root = args.data / 'deployment'
    state = json.loads((root / 'active.json').read_text())
    print(json.dumps(state, ensure_ascii=False, indent=2))
    release = json.loads((args.releases / state['release'] / 'release.json').read_text())
    run([release['binary'], 'runtime-status'], cwd=release['resources'], env=environment(args, release))
    for session in [state['entry_session'], state['api_session']]:
        print(f'tmux={session} exists={has_session(session)}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['build', 'activate', 'status', 'retire'])
    parser.add_argument('release', nargs='?')
    parser.add_argument('--data', type=Path, default=REPO / 'data')
    parser.add_argument('--runtime', type=Path, default=REPO / '.runtime')
    parser.add_argument('--releases', type=Path, default=REPO / '.runtime/releases')
    parser.add_argument('--env-file', type=Path, default=REPO / '.env')
    parser.add_argument('--port', type=int, default=8797)
    args = parser.parse_args()
    for name in ['data', 'runtime', 'releases', 'env_file']:
        value = getattr(args, name).resolve()
        if any(c in str(value) for c in ['"', '\n', '\r', '$', ';']):
            parser.error('deployment paths contain unsupported configuration characters')
        setattr(args, name, value)
    if args.action != 'status' and not args.release:
        parser.error('release ID is required')
    if args.release and not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', args.release):
        parser.error('invalid release ID')
    (args.data / 'deployment').mkdir(parents=True, exist_ok=True)
    if args.action == 'retire':
        retire(args)
        return
    with (args.data / 'deployment/publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            {'build': build, 'activate': activate, 'status': status}[args.action](args)
        except Exception:
            session = getattr(args, 'candidate_session', None)
            if session and has_session(session):
                log = subprocess.run(['tmux', 'capture-pane', '-pt', '=' + session + ':', '-S', '-200'], capture_output=True, text=True)
                (args.data / 'deployment' / f'{args.release}-failed.log').write_text(log.stdout)
                run(['tmux', 'send-keys', '-t', '=' + session + ':', 'C-c'])
            raise


if __name__ == '__main__':
    main()
