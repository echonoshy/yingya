#!/usr/bin/env python3
"""Durable local HyperFrames jobs. No provider calls, daemon, or media audit."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid


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
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(), files


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


def stop(child):
    if child.poll() is not None:
        return
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()


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
                    and existing_output and previous.get('outputSha256') == existing_output):
                job.update(status='succeeded', exitCode=0, reusedFrom=previous['id'],
                           outputSha256=existing_output, message='输入与产物一致，复用已完成结果。')
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
            command += ['--output', str(temporary), '--quality', args.quality,
                        '--resolution', args.resolution, '--fps', str(args.fps)]
        save(path, job)
        save(directory / (job_id + '.fingerprint.json'), {'files': files})
        emit(job)  # A yielding client gets an actual job handle even with no CLI output.
        child = None
        interrupted = False

        def interrupt(_signum, _frame):
            nonlocal interrupted
            interrupted = True

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
                probe = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format',
                                        '-of', 'json', str(temporary)], capture_output=True, text=True, timeout=30)
                media = json.loads(probe.stdout) if probe.returncode == 0 else {}
                if not any(s.get('codec_type') == 'video' for s in media.get('streams', [])) or float(media.get('format', {}).get('duration', 0)) <= 0:
                    raise ValueError('渲染输出缺少可读取的视频流或有效时长。')
            # Record the expected hash before rename so crash recovery can recognize
            # a completed output without rerendering or blessing unrelated media.
            job['outputSha256'] = digest(temporary)
            job['status'] = 'publishing'
            save(path, job)
            temporary.replace(output)
            job.update(status='succeeded', message='检查通过。' if args.kind == 'check' else '渲染完成。')
            return 0
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            if child is not None:
                stop(child)
            job.update(status='failed', message=str(error))
            return job.get('exitCode') or 1
        finally:
            job['updatedAt'] = time.time()
            save(path, job)
            emit(job)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['check', 'render', 'status', 'cancel'])
    parser.add_argument('--project', default='.')
    parser.add_argument('--request-id', required=True)
    parser.add_argument('--source', default='.')
    parser.add_argument('--output')
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
    if not 1 <= args.timeout <= 3600:
        parser.error('timeout must be between 1 and 3600 seconds')
    root = Path(args.project).resolve()
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
                                 and digest(output) == job.get('outputSha256') else 'lost')
                job['message'] = '结果已恢复。' if job['status'] == 'succeeded' else '执行进程已退出且没有完整结果；保留日志供检查。'
                save(directory / (job['id'] + '.json'), job)
        emit({'jobs': jobs})
        return 0
    if not args.output:
        parser.error('--output is required for check/render')
    if any(a in ('--output', '--no-json', '--no-snapshots') for a in args.check_args):
        parser.error('output/report flags are managed by the runner')
    return execute(args, root, directory)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError) as error:
        emit({'status': 'failed', 'message': str(error)})
        sys.exit(1)
