#!/usr/bin/env python3
"""Portable Python 3 client for H3 Studio; no API key or third-party dependency."""
import argparse
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = os.environ.get('H3_URL', 'http://140.143.229.103:8910')
# Respect the per-user sandbox proxy; direct connections cannot leave its namespace.
http = urllib.request.build_opener()


def request(base, path, data=None, content_type=None, timeout=120):
    headers = {'Content-Type': content_type} if content_type else {}
    req = urllib.request.Request(base.rstrip('/')+path, data=data, headers=headers)
    try:
        return http.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read(4000).decode(errors="replace")}') from e


def get_json(base, path, **kwargs):
    with request(base, path, **kwargs) as r:
        return json.load(r)


def multipart(config, uploads):
    boundary='----h3client'+uuid.uuid4().hex
    chunks=[f'--{boundary}\r\nContent-Disposition: form-data; name="config"\r\n\r\n{json.dumps(config,ensure_ascii=False)}\r\n'.encode()]
    for field, filename in uploads:
        path=Path(filename)
        if not path.is_file(): raise ValueError(f'File not found: {path}')
        content_type=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        name=path.name.replace('"','_').replace('\r','_').replace('\n','_')
        chunks += [f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{name}"\r\nContent-Type: {content_type}\r\n\r\n'.encode(),path.read_bytes(),b'\r\n']
    chunks.append(f'--{boundary}--\r\n'.encode())
    return b''.join(chunks),'multipart/form-data; boundary='+boundary


def download(base, job_id, output, frame=None):
    path=f'/api/jobs/{job_id}/frame/{frame}' if frame else f'/api/jobs/{job_id}/video'
    output=Path(output)
    if output.exists(): raise ValueError(f'Output exists; choose a new path: {output}')
    output.parent.mkdir(parents=True,exist_ok=True)
    temp=output.with_name(output.name+'.part')
    try:
        with request(base,path) as r, temp.open('xb') as f:
            while True:
                chunk=r.read(1024*1024)
                if not chunk:break
                f.write(chunk)
        temp.replace(output)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    return str(output.resolve())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default=BASE,help='H3 Studio base URL (or H3_URL)')
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('health'); sub.add_parser('list'); sub.add_parser('capabilities')
    for name in ('status','cancel'):
        p=sub.add_parser(name); p.add_argument('id')
    p=sub.add_parser('download'); p.add_argument('id'); p.add_argument('--output',required=True); p.add_argument('--frame',choices=['first','last'])
    p=sub.add_parser('generate')
    group=p.add_mutually_exclusive_group(required=True); group.add_argument('--prompt'); group.add_argument('--prompt-file')
    p.add_argument('--mode',choices=['auto','text','frames','reference'],default='auto')
    p.add_argument('--first-frame'); p.add_argument('--last-frame'); p.add_argument('--reference',action='append',default=[])
    p.add_argument('--duration',type=float,default=6); p.add_argument('--ratio',default='16:9',choices=['21:9','16:9','4:3','1:1','3:4','9:16'])
    p.add_argument('--steps',type=int); p.add_argument('--seed',type=int,default=42)
    p.add_argument('--quality',choices=['high','lossless'])
    p.add_argument('--flow-shift',type=float); p.add_argument('--audio-flow-shift',type=float)
    p.add_argument('--wait',action='store_true'); p.add_argument('--timeout',type=int,default=14400); p.add_argument('--output')
    args=parser.parse_args(); base=args.url.rstrip('/')
    if args.command in ('health','list','capabilities'):
        result=get_json(base, '/api/'+('jobs' if args.command=='list' else args.command))
    elif args.command=='status':result=get_json(base,f'/api/jobs/{args.id}')
    elif args.command=='cancel':result=get_json(base,f'/api/jobs/{args.id}/cancel',data=b'')
    elif args.command=='download':result={'saved':download(base,args.id,args.output,args.frame)}
    else:
        if args.output and not args.wait: parser.error('--output requires --wait; otherwise use download with the job ID')
        if args.reference and (args.first_frame or args.last_frame):parser.error('References and fixed frames use different modes; do not combine them')
        if not 4 <= args.duration <= 15: parser.error('--duration must be between 4 and 15 seconds')
        if args.steps is not None and not 5 <= args.steps <= 50: parser.error('--steps must be between 5 and 50')
        if not 0 <= args.seed <= 2147483647: parser.error('--seed must be between 0 and 2147483647')
        has_frames = bool(args.first_frame or args.last_frame)
        if args.mode == 'text' and (has_frames or args.reference): parser.error('text mode cannot use media')
        if args.mode == 'frames' and (not has_frames or args.reference): parser.error('frames mode requires first/last frames only')
        if args.mode == 'reference' and (not args.reference or has_frames): parser.error('reference mode requires references only')
        config=dict(prompt=Path(args.prompt_file).read_text(encoding='utf-8') if args.prompt_file else args.prompt,
                    mode=args.mode, duration=args.duration, aspect_ratio=args.ratio, steps=args.steps,
                    seed=args.seed, quality=args.quality,flow_shift=args.flow_shift,audio_flow_shift=args.audio_flow_shift)
        if not config['prompt'].strip(): parser.error('prompt must not be empty')
        # The service profile owns sampler defaults (currently turbo8).
        config = {key: value for key, value in config.items() if value is not None}
        uploads=[]
        if args.first_frame: uploads.append(('first_frame',args.first_frame))
        if args.last_frame: uploads.append(('last_frame',args.last_frame))
        uploads += [('references',x) for x in args.reference]
        data,content_type=multipart(config,uploads)
        # The sandbox streams media through its gateway; large uploads can take
        # several minutes before the service acknowledges a job.
        try:
            result=get_json(base,'/api/jobs',data=data,content_type=content_type,timeout=600)
        except OSError as error:
            raise RuntimeError('Submission response unavailable; server acceptance is unknown. Do not resubmit automatically. ' + str(error)) from error
        print(json.dumps({'id':result['id'],'status':result['status'],'status_url':base+'/api/jobs/'+result['id']},ensure_ascii=False),flush=True)
        if not args.wait:return
        deadline=time.monotonic()+args.timeout
        last_status=None
        while result['status'] in ('queued','loading','generating'):
            if time.monotonic()>deadline:raise RuntimeError(f"Wait timed out. Job {result['id']} continues on server; use status/download. Do not resubmit.")
            if result['status']!=last_status:
                print(result['status'],file=sys.stderr,flush=True);last_status=result['status']
            time.sleep(5)
            result=get_json(base,'/api/jobs/'+result['id'])
        if result['status']!='completed':raise RuntimeError(result.get('error',result['status']))
        result['download_url']=base+result['video_url']
        if args.output:result['saved']=download(base,result['id'],args.output)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:main()
    except (RuntimeError,ValueError,OSError) as e:
        print(str(e),file=sys.stderr);sys.exit(1)
