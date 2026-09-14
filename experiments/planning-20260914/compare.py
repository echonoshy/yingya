#!/usr/bin/env python3
"""Create matched-time review images and a side-by-side video from real renders."""
from pathlib import Path
import json
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
for variant in ["baseline", "candidate"]:
    state = json.loads((ROOT / "results/grid" / variant / "video/run-state.json").read_text())
    if not (state.get("stage") == "rendered" and state.get("checkOk") is True
            and state.get("specOk") is True and state.get("decodeExitCode") == 0):
        raise RuntimeError(f"{variant} has not finished a verified render")
OUT = ROOT / "artifacts"
OUT.mkdir(exist_ok=True)
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
TIMES = [.25, 5, 9, 13, 17, 23.5]
WIDTH, HEIGHT = 384, 216
sheet = Image.new("RGB", (len(TIMES) * WIDTH, 2 * (HEIGHT + 52)), "#F6F4EE")
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype(FONT, 23)

for row, variant in enumerate(["baseline", "candidate"]):
    source = ROOT / "results/grid" / variant / "video/draft.mp4"
    for col, seconds in enumerate(TIMES):
        target = OUT / f"{variant}-{seconds:g}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(seconds), "-i", str(source),
                        "-frames:v", "1", str(target)], check=True)
        im = Image.open(target).convert("RGB")
        im.thumbnail((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
        x, y = col * WIDTH, row * (HEIGHT + 52)
        draw.text((x + 12, y + 11), f"{'旧规则' if variant == 'baseline' else '试验规则'} · {seconds:g}s", fill="#172D43", font=font)
        sheet.paste(im, (x, y + 52))
sheet.save(OUT / "comparison-frames.png")

event_times = {
    "baseline": [11.3, 11.5, 11.7, 11.9, 12.1],
    "candidate": [13.3, 13.5, 13.9, 14.3, 14.6],
}
events = Image.new("RGB", (5 * WIDTH, 2 * (HEIGHT + 52)), "#F6F4EE")
event_draw = ImageDraw.Draw(events)
for row, (variant, times) in enumerate(event_times.items()):
    source = ROOT / "results/grid" / variant / "video/draft.mp4"
    for col, seconds in enumerate(times):
        target = OUT / f"{variant}-transfer-{seconds:g}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(seconds), "-i", str(source),
                        "-frames:v", "1", str(target)], check=True)
        im = Image.open(target).convert("RGB")
        im.thumbnail((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
        x, y = col * WIDTH, row * (HEIGHT + 52)
        event_draw.text((x + 12, y + 11), f"{'旧规则' if variant == 'baseline' else '试验规则'} · {seconds:g}s", fill="#172D43", font=font)
        events.paste(im, (x, y + 52))
events.save(OUT / "transfer-frames.png")

paths = [ROOT / "results/grid" / v / "video/draft.mp4" for v in ["baseline", "candidate"]]
filters = []
for index, label in enumerate(["旧规则", "试验规则"]):
    filters.append(f"[{index}:v]pad=1280:800:0:80:color=0xF6F4EE,drawtext=fontfile={FONT}:text='{label}':fontcolor=0x172D43:fontsize=36:x=48:y=20[v{index}]")
filters.append("[v0][v1]hstack=inputs=2[out]")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(paths[0]), "-i", str(paths[1]),
                "-filter_complex", ";".join(filters), "-map", "[out]", "-c:v", "libx264",
                "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                str(OUT / "comparison.mp4")], check=True)

summary = {"cases": {}, "modelTokensIncludingTransportFailures": 0}
for case in ["grid", "drawing", "loop", "grid_long"]:
    summary["cases"][case] = {}
    for variant in ["baseline", "candidate"]:
        p = ROOT / "results" / case / variant / "plan"
        artifact = json.loads((p / "artifact.json").read_text())
        metrics = json.loads((p / "metrics.json").read_text())
        scenes = artifact["scenes"]
        summary["cases"][case][variant] = {
            "sceneCount": len(scenes),
            "planCharacters": len(artifact["planMd"]),
            "sceneCharacters": len(json.dumps(scenes, ensure_ascii=False)),
            "durationSeconds": max(s["startSeconds"] + s["durationSeconds"] for s in scenes),
            "elapsedSeconds": metrics["elapsedSeconds"],
            "inputTokens": metrics["usage"]["input_tokens"],
            "outputTokens": metrics["usage"]["output_tokens"],
        }
for p in ROOT.glob("**/metrics.json"):
    summary["modelTokensIncludingTransportFailures"] += json.loads(p.read_text())["usage"]["total_tokens"]
(ROOT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(summary, ensure_ascii=False, indent=2))
