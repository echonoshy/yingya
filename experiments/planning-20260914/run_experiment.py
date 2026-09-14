#!/usr/bin/env python3
"""Fresh, tool-free model calls for a paired planning experiment.

Credentials are read only in memory from Yingya's existing Codex authentication;
never persisted in experiment inputs, outputs, logs, or command arguments.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import uuid

import requests

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
MODEL = "gpt-6-astra"
EFFORT = "medium"
CASES = {
    "grid_long": {
        "prompt": "做一个60秒的无声科普动画，给新手解释什么是网格交易策略。要有图表和简单公式，但别纠结细节，要讲得生动。",
        "facts": "仅固定教学示例：区间80至120元，五条价格线80、90、100、110、120，四个间隔，间距(120−80)/4=10元。用价格100→90→100→90→100演示90买1份、100卖同一份的两轮局部交易；每轮未扣成本的价差为10元。不是完整账户模拟。买单需要现金，卖单需要已有持仓。交易成本会减少价差。价格跌破区间时可能持仓承压，持续上涨时可能提前卖出；局部成交有价差不等于整个账户盈利。所有数字均为虚构教学示例，非行情或收益预测，不提供投资建议。可以自主选择讲述角度和组织顺序。",
        "spec": {"durationSeconds": 60, "width": 1280, "height": 720, "fps": 30},
        "style": "浅米白 #F6F4EE 画布、近黑蓝 #172D43 正文、蓝色 #175DB5 买入、橙色 #A94A19 卖出；中文 Noto Sans SC；原创可编辑图表与文字。",
    },
    "grid": {
        "prompt": "做一个24秒的无声动画，给新手讲清楚网格交易里一次低买高卖是怎么发生的。用具体图表，简洁但生动。",
        "facts": "固定教学示例，不是行情或投资建议：只演示一个网格的一次完整交易。价格路径100→90→100元；初始现金100元、持仓0份；到90元买1份，到100元卖出该1份。忽略手续费和滑点，最终现金110元、持仓0份；价差10元并非保证收益，不展开完整账户或其他网格。不新增事实或改动数值。",
        "spec": {"durationSeconds": 24, "width": 1280, "height": 720, "fps": 30},
        "style": "浅米白 #F6F4EE 画布、近黑蓝 #172D43 正文、蓝色 #175DB5 买入、橙色 #A94A19 卖出；中文 Noto Sans SC；原创可编辑图表与文字。",
    },
    "drawing": {
        "prompt": "做一个30秒的无声动画，让小学生觉得画画有趣，看完想拿起画笔。",
        "facts": "目标是激发兴趣，不是教授绘画技巧；不要增加比赛、奖杯、知识测验或练习任务。没有提供图片；可用原创程序化图形。",
        "spec": {"durationSeconds": 30, "width": 720, "height": 1280, "fps": 30},
        "style": "奶油白纸面、深蓝轮廓、珊瑚橙和浅蓝；中文 Noto Sans SC；统一笔触、亲切简洁。",
    },
    "loop": {
        "prompt": "用“映芽”两个字和一个小圆点做个4秒无声循环动画，轻快一点，不加其他文案。",
        "facts": "仅两个汉字和一个圆点；无图像、旁白、音乐或字幕需求。首尾视觉状态要一致。",
        "spec": {"durationSeconds": 4, "width": 720, "height": 720, "fps": 30},
        "style": "暖白 #F6F4EE 背景，近黑 #172D43 文字，珊瑚橙 #C54C35 圆点；Noto Sans SC。",
    },
}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def infer(instructions, content, out):
    out.mkdir(parents=True, exist_ok=True)
    if (out / "response.json").exists():
        raise RuntimeError(f"Refusing to overwrite existing result: {out}")
    auth_path = Path(os.environ.get("YINGYA_EXPERIMENT_AUTH", str(REPO / ".runtime/codex-home/auth.json")))
    auth = json.loads(auth_path.read_text())
    key = auth.get("OPENAI_API_KEY")
    tokens = auth.get("tokens") or {}
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    if key:
        endpoint = "https://api.openai.com/v1/responses"
        headers["Authorization"] = "Bearer " + key
    else:
        endpoint = "https://chatgpt.com/backend-api/codex/responses"
        headers["Authorization"] = "Bearer " + tokens["access_token"]
        if tokens.get("account_id"):
            headers["chatgpt-account-id"] = tokens["account_id"]
        headers["originator"] = "codex_cli_rs"
        headers["session_id"] = str(uuid.uuid4())
    body = {
        "model": MODEL,
        "instructions": instructions,
        "input": [{"role": "user", "content": content}],
        "tools": [],
        "tool_choice": "none",
        "parallel_tool_calls": False,
        "reasoning": {"effort": EFFORT},
        "store": False,
        "stream": True,
    }
    write_json(out / "request.json", body)
    started = time.monotonic()
    result = None
    streamed_items = []
    text_deltas = []
    stream_file = (out / "stream.jsonl").open("w")
    with requests.post(endpoint, headers=headers, json=body, stream=True, timeout=(20, 240)) as response:
        if not response.ok:
            write_json(out / "error.json", {"status": response.status_code, "message": response.text[:1500]})
            raise RuntimeError(f"Model HTTP {response.status_code}; see {out / 'error.json'}")
        for line in response.iter_lines():
            if time.monotonic() - started > 600:
                raise TimeoutError("Experiment request exceeded ten minutes")
            if not line.startswith(b"data: "):
                continue
            data = line[6:]
            if data == b"[DONE]":
                break
            event = json.loads(data)
            stream_file.write(json.dumps(event, ensure_ascii=False) + "\n")
            stream_file.flush()
            if event.get("type") == "response.output_item.done":
                streamed_items.append(event["item"])
            elif event.get("type") == "response.output_text.delta":
                text_deltas.append(event.get("delta", ""))
            if event.get("type") == "response.completed":
                result = event["response"]
            elif event.get("type") in {"error", "response.failed", "response.incomplete"}:
                write_json(out / "error.json", event)
                raise RuntimeError(f"Model generation failed; see {out / 'error.json'}")
    stream_file.close()
    if result is None:
        raise RuntimeError("No completed response returned")
    write_json(out / "response.json", result)
    write_json(out / "streamed-items.json", streamed_items)
    write_json(out / "metrics.json", {
        "model": result.get("model"), "effort": EFFORT,
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "usage": result.get("usage"),
        "instructionsSha256": hashlib.sha256(instructions.encode()).hexdigest(),
    })
    text = "\n".join(c.get("text", "") for item in (result.get("output") or streamed_items)
                     if item.get("type") == "message" for c in item.get("content", [])
                     if c.get("type") == "output_text")
    if not text:
        text = "".join(text_deltas)
    (out / "output.txt").write_text(text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned[cleaned.index("\n") + 1:].rsplit("```", 1)[0]
        value = json.loads(cleaned)
    write_json(out / "artifact.json", value)
    print(json.dumps({"out": str(out), "elapsedSeconds": round(time.monotonic() - started, 2),
                      "usage": result.get("usage")}, ensure_ascii=False), flush=True)
    return value


def plan(variant, case):
    rules = ROOT / "rules" / variant
    instructions = "你是映芽的视频规划模型。以下是本次唯一使用的制作规则。\n"
    for name in ["SKILL.md", "references/planning.md"]:
        instructions += "\nFILE " + name + "\n" + (rules / name).read_text()
    if variant == "candidate":
        instructions += "\nFILE references/visual-story.md\n" + (rules / "references/visual-story.md").read_text()
    instructions += "\n本轮是离线规划试验：所有输入在用户消息中；不调用工具，不安装依赖，不生成素材或视频。只返回一个合法JSON对象，包含planMd字符串、scenes根数组、designMd字符串。scenes兼容规则中的字段，可保留必要的扩展字段。planMd是可供用户审阅的简洁但具体方案，designMd记录本次既定视觉风格。无需真实写文件或manifest。"
    case_input = dict(CASES[case])
    case_input["capabilities"] = "已验证本地HyperFrames 0.8.30、GSAP、Chrome、FFmpeg和Noto Sans SC可用。无声、纯代码图形路线，不依赖网络、TTS、照片、生成图片或其他服务。"
    out = ROOT / "results" / case / variant / "plan"
    value = infer(instructions, [{"type": "input_text", "text": json.dumps(case_input, ensure_ascii=False)}], out)
    (out / "plan.md").write_text(value["planMd"])
    (out / "DESIGN.md").write_text(value["designMd"])
    write_json(out / "scenes.json", value["scenes"])


def build(variant):
    source = ROOT / "results" / "grid" / variant / "plan"
    plan_value = json.loads((source / "artifact.json").read_text())
    instructions = """你是HyperFrames动画制作模型。本轮是独立的离线制作请求。
根据提供的已确认plan、scenes和DESIGN完整实现24秒无声动画。忠实执行该方案，不重新策划或加新的视觉创意，不参考其他版本。你没有工具；只返回合法JSON对象，包含html字符串、motionAssertions对象、implementationNotes字符串。HTML必须能直接交给HyperFrames 0.8.30渲染。
共同的实现约束：
- 1280×720，30fps，24秒。root的data-composition-id=main、data-start=0、data-duration=24、data-width=1280、data-height=720、data-fps=30。
- 已有本地assets/gsap.min.js；用script加载。已有字体assets/NotoSansCJK-Regular.ttc和assets/NotoSansCJK-Bold.ttc；@font-face命名为YingyaSans并分别设置400和700，不联网。
- 遵循提供的DESIGN。文字内容用DOM，图表/关系对象用SVG，可通过GSAP动画SVG属性。重要文字需保持可读；不把所有内容封装成一张栅格图。
- HTML/CSS先定义清楚的可读布局，之后动画到该布局。采用共同坐标系画组合图形。
- 所有动画在一个同步构建的gsap.timeline({paused:true})，注册window.__timelines.main。时间使用绝对秒；无CSS animation、setTimeout、Math.random、无限repeat、播放媒体调用。
- 需要重叠的图层使用不同data-track-index。保留scenes的稳定id；连续画面可以共享跨场景对象，但记录如何关联scene id。
- 不能依赖只执行一次的onStart/onComplete回调更新数值，因为渲染会随机seek。状态变化用时间线set/fromTo；不同文本状态可用独立DOM加时间线切换。让forward/backward seek呈现相同状态。
- 不修改交易事实、不重复执行买卖、不产生新资产；不要显示缺失图片。
- 使用该方案自己的动作安排，包括它选择的停顿。不要为了检查工具强行持续运动。
- motionAssertions采用{duration:24,assertions:[...]}，只使用真实selector的appearsBy和staysInFrame验证重要内容；不虚构断言。可用格式：{kind:'appearsBy',selector:'#id',bySec:8}、{kind:'staysInFrame',selector:'#id'}。
- 输出完整HTML；不使用markdown代码围栏。
"""
    value = infer(instructions, [{"type": "input_text", "text": json.dumps({
        "approvedPlan": plan_value, "fixedInput": CASES["grid"]
    }, ensure_ascii=False)}], ROOT / "results" / "grid" / variant / "build")
    out = ROOT / "results" / "grid" / variant / "video"
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text(value["html"])
    (out / "index.motion.json").write_text(json.dumps(value["motionAssertions"], ensure_ascii=False, indent=2))
    (out / "DESIGN.md").write_text(plan_value["designMd"])
    write_json(out / "hyperframes.json", {"paths": {"blocks": "compositions", "components": "compositions/components", "assets": "assets"}})
    import shutil
    shutil.copytree(ROOT / "assets", out / "assets", dirs_exist_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("variant", choices=["baseline", "candidate"])
    parser.add_argument("case", choices=list(CASES))
    parser.add_argument("--build", action="store_true")
    args = parser.parse_args()
    if args.build:
        if args.case != "grid":
            parser.error("Only the grid case is built in this experiment")
        build(args.variant)
    else:
        plan(args.variant, args.case)


if __name__ == "__main__":
    main()
