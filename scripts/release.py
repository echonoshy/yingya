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
    for name in ['src', 'web', 'skills', 'scripts', 'runtime']:
        shutil.copytree(REPO / name, root / name, ignore=shutil.ignore_patterns('node_modules', '__pycache__'))
    for name in ['Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json', 'tsconfig.json']:
        shutil.copy2(REPO / name, root / name)
    run(['python3', root / 'scripts/setup-python.py', '--resources', root,
         '--store', args.runtime / 'python'])
    run(['npm', 'ci'], cwd=root)
    run(['npm', 'run', 'typecheck'], cwd=root)
    run(['npm', 'run', 'web:build'], cwd=root)
    # Compile from the immutable sources, but share rebuildable Cargo intermediates
    # across releases. Each snapshot still owns an independent executable.
    target = args.runtime / 'release-build'
    run(['cargo', 'build', '--locked', '--release', '--target-dir', target], cwd=root)
    shutil.copy2(target / 'release/yingya-server', root / 'yingya-server')
    # Browser binaries are machine-local tooling, not mutable release source.
    (root / '.runtime').mkdir(exist_ok=True)
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
    map $uri $share_log_path {{
        ~^/s/ /s/[redacted];
        ~^/api/public/shares/ /api/public/shares/[redacted];
        default $uri;
    }}
    log_format share_safe '$remote_addr - $remote_user [$time_local] "$request_method $share_log_path $server_protocol" $status $body_bytes_sent';
    access_log "{root}/nginx-access.log" share_safe;
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
        # Error logs can include the original request URI; keep only sanitized
        # access/status logs for bearer-link routes.
        location ~ ^/(s/|api/public/shares/) {{
            error_log /dev/null;
            proxy_pass http://127.0.0.1:{api_port};
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header Connection "";
            proxy_buffering off;
            proxy_read_timeout 3600s;
            proxy_next_upstream off;
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


def release_references(text, releases):
    return set(re.findall(re.escape(str(releases) + '/') + r'([a-zA-Z0-9][a-zA-Z0-9_-]*)', text))


def release_dependencies(directory, releases):
    """Retained snapshots can share runtime dependencies through symlinks."""
    dependencies = set()
    for root, directories, files in os.walk(directory, followlinks=False):
        for name in directories + files:
            item = Path(root) / name
            if item.is_symlink():
                dependencies.update(release_references(str(item.resolve()), releases))
    return dependencies


def process_release_references(releases):
    """Protect independently launched previews/tools, including open file handles."""
    protected = set()
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            if os.geteuid() != 0 and process.stat().st_uid != os.getuid():
                continue
            # The user-session PAM helper is intentionally non-dumpable. It is an
            # OS authentication helper, not a Yingya service. Check its parent too;
            # any other inaccessible same-user process still aborts the cleanup.
            if (process / 'cmdline').read_bytes() == b'(sd-pam)\0':
                parent = re.search(r'^PPid:\s+(\d+)', (process / 'status').read_text(), re.M)
                if parent and Path(f'/proc/{parent[1]}/cmdline').read_bytes() in (
                    b'/lib/systemd/systemd\0--user\0', b'/usr/lib/systemd/systemd\0--user\0'):
                    continue
            # Privilege-separated sshd sessions also prohibit ptrace. Their child
            # shells/tools are scanned independently below. Verify a root sshd parent.
            if (process / 'comm').read_text().strip() == 'sshd':
                parent = re.search(r'^PPid:\s+(\d+)', (process / 'status').read_text(), re.M)
                if parent:
                    owner = Path('/proc') / parent[1]
                    if owner.stat().st_uid == 0 and (owner / 'comm').read_text().strip() == 'sshd':
                        continue
            for name in ['cwd', 'exe']:
                protected.update(release_references(str((process / name).resolve()), releases))
            for name in ['cmdline', 'environ', 'maps']:
                protected.update(release_references((process / name).read_bytes().decode(errors='replace'), releases))
            for descriptor in (process / 'fd').iterdir():
                protected.update(release_references(str(descriptor.resolve()), releases))
        except (FileNotFoundError, ProcessLookupError):
            continue  # A process may exit during the scan.
        except PermissionError as error:
            raise RuntimeError(f'cannot inspect process {process.name}; no releases removed') from error
    return protected


def prune_plan(args):
    state = json.loads((args.data / 'deployment/active.json').read_text())
    release = json.loads((args.releases / state['release'] / 'release.json').read_text())
    # Fail closed if the runtime registry cannot be read. Even stale worker records
    # protect their release; pruning snapshots never edits account/task state.
    registry = json.loads(subprocess.check_output([release['binary'], 'runtime-status'],
        cwd=release['resources'], env=environment(args, release), text=True))
    protected = {state['release'], state.get('previous')}
    protected.update(worker['release'] for worker in registry['workers'])
    protected.add(registry['target']['id'])
    directories = sorted(p for p in args.releases.iterdir()
        if p.is_dir() and not p.is_symlink()
        and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', p.name))
    complete = [p for p in directories if (p / 'release.json').is_file()]
    protected.update(p.name for p in complete[-args.keep:])
    protected.update(process_release_references(args.releases))
    pending = list(protected - {None})
    visited = set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        for dependency in release_dependencies(args.releases / name, args.releases):
            protected.add(dependency)
            if dependency not in visited:
                pending.append(dependency)
    return {'protected': sorted(protected - {None}),
            'remove': [p.name for p in directories if p.name not in protected]}


def prune(args):
    plan = prune_plan(args)
    print(json.dumps(plan, ensure_ascii=False, indent=2), flush=True)
    if not args.apply:
        print('Dry run; pass --apply to remove only the listed inactive snapshots.')
        return
    # The publish lock is held throughout planning/deletion. Never modify a retained
    # snapshot in place; public hashed assets, user data, models and voices stay intact.
    receipt = args.data / 'deployment' / f'cleanup-{time.time_ns()}.json'
    plan.update(completed=[], freeBytesBefore=shutil.disk_usage(args.releases).free)
    atomic_json(receipt, plan)
    for name in plan['remove']:
        directory = args.releases / name
        if directory.is_symlink() or directory.parent.resolve() != args.releases:
            raise RuntimeError('release path changed during pruning')
        shutil.rmtree(directory)
        plan['completed'].append(name)
        atomic_json(receipt, plan)
    plan['freeBytesAfter'] = shutil.disk_usage(args.releases).free
    atomic_json(receipt, plan)
    print(f"Removed {len(plan['completed'])} inactive releases; receipt: {receipt}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['build', 'activate', 'status', 'retire', 'prune'])
    parser.add_argument('release', nargs='?')
    parser.add_argument('--data', type=Path, default=REPO / 'data')
    parser.add_argument('--runtime', type=Path, default=REPO / '.runtime')
    parser.add_argument('--releases', type=Path, default=REPO / '.runtime/releases')
    parser.add_argument('--env-file', type=Path, default=REPO / '.env')
    parser.add_argument('--port', type=int, default=8797)
    parser.add_argument('--keep', type=int, default=3, help='minimum recent complete releases to retain')
    parser.add_argument('--apply', action='store_true', help='apply the inactive-release cleanup plan')
    args = parser.parse_args()
    for name in ['data', 'runtime', 'releases', 'env_file']:
        value = getattr(args, name).resolve()
        if any(c in str(value) for c in ['"', '\n', '\r', '$', ';']):
            parser.error('deployment paths contain unsupported configuration characters')
        setattr(args, name, value)
    if args.keep < 2:
        parser.error('--keep must be at least 2')
    if args.action not in ('status', 'prune') and not args.release:
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
            {'build': build, 'activate': activate, 'status': status, 'prune': prune}[args.action](args)
        except Exception:
            session = getattr(args, 'candidate_session', None)
            if session and has_session(session):
                log = subprocess.run(['tmux', 'capture-pane', '-pt', '=' + session + ':', '-S', '-200'], capture_output=True, text=True)
                (args.data / 'deployment' / f'{args.release}-failed.log').write_text(log.stdout)
                run(['tmux', 'send-keys', '-t', '=' + session + ':', 'C-c'])
            raise


if __name__ == '__main__':
    main()
