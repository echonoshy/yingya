#!/usr/bin/env python3
"""Run the same bounded HyperFrames check/render commands for both samples."""
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
HF = REPO / "node_modules/.bin/hyperframes"


def run(variant):
    video = ROOT / "results/grid" / variant / "video"
    env = dict(os.environ)
    env.update(HYPERFRAMES_NO_UPDATE_CHECK="1", PRODUCER_BROWSER_GPU_MODE="software")
    report = {"variant": variant, "startedAt": time.time(), "stage": "check"}
    state = video / "run-state.json"
    state.write_text(json.dumps(report, indent=2))
    with (video / "check.json").open("w") as out, (video / "check.stderr.log").open("w") as err:
        result = subprocess.run([str(HF), "check", str(video), "--snapshots", "--json",
                                 "--at", "0.25,1,3,5,7,9,11,13,15,17,19,21,23.5",
                                 "--no-browser-gpu"], cwd=REPO, env=env, stdout=out, stderr=err, timeout=300)
    report["checkExitCode"] = result.returncode
    check = json.loads((video / "check.json").read_text())
    report["checkOk"] = check.get("ok")
    if result.returncode != 0 or check.get("ok") is not True:
        report["stage"] = "check-failed"
        state.write_text(json.dumps(report, indent=2))
        print(json.dumps(report), flush=True)
        return False
    report["stage"] = "render"
    state.write_text(json.dumps(report, indent=2))
    output = video / "draft.mp4"
    with (video / "render.log").open("w") as log:
        result = subprocess.run([str(HF), "render", str(video), "--output", str(output),
                                 "--quality", "draft", "--fps", "30", "--workers", "1",
                                 "--no-browser-gpu", "--no-best-effort", "--strict"],
                                cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=900)
    report["renderExitCode"] = result.returncode
    report["stage"] = "rendered" if result.returncode == 0 else "render-failed"
    report["elapsedSeconds"] = round(time.time() - report["startedAt"], 2)
    if result.returncode == 0:
        probe = subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)], text=True)
        (video / "probe.json").write_text(probe)
        decoded = subprocess.run(["ffmpeg", "-v", "error", "-i", str(output), "-f", "null", "-"], capture_output=True, text=True, timeout=120)
        (video / "decode.log").write_text(decoded.stderr)
        report["decodeExitCode"] = decoded.returncode
        p = json.loads(probe)
        streams = p["streams"]
        vs = [s for s in streams if s["codec_type"] == "video"]
        report["specOk"] = (len(vs) == 1 and vs[0]["width"] == 1280 and vs[0]["height"] == 720
                            and vs[0]["avg_frame_rate"] == "30/1"
                            and abs(float(p["format"]["duration"]) - 24) < .04
                            and not any(s["codec_type"] == "audio" for s in streams))
    state.write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)
    return (result.returncode == 0 and report.get("decodeExitCode") == 0
            and report.get("specOk") is True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("variants", nargs="*", default=["baseline", "candidate"])
    args = parser.parse_args()
    outcomes = []
    for variant in args.variants:
        if variant not in {"baseline", "candidate"}:
            parser.error("Unknown variant")
        outcomes.append(run(variant))
    raise SystemExit(0 if all(outcomes) else 1)
