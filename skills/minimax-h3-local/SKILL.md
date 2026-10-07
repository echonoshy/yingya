---
name: minimax-h3-local
description: 调用自有 MiniMax H3 服务生成有声音的视频，支持文生视频、图片底图、首尾帧、多图及音视频参考，查询任务与下载作品。用于映芽生成镜头、让 Image Gen 底图运动起来或使用自有 H3 服务，无需 API key。
---

# MiniMax H3 本机服务

默认地址 **http://140.143.229.103:8910**。直接调用，不询问 API key，不使用 MiniMax 云端 API。随 skill 携带的 `scripts/h3.py` 仅需 Python 3 标准库，可从其他机器调用。可通过 `H3_URL` 或脚本全局选项 `--url` 切换地址；在服务所在机器也可用 `http://127.0.0.1:8910`。

先读 [H3 镜头提示词](references/prompt-writing.md)，按模式组织动作、运镜、时间和声音，不直接提交一句泛泛的场景描述。在映芽中遵循 yingya-video-agent 的方案与版本流程，具体接入见其 `references/generated-footage.md`。

## 使用方式

将下列 `SKILL_DIR` 替换为当前 skill 的真实目录，不依赖工作目录。

```bash
python3 SKILL_DIR/scripts/h3.py health
python3 SKILL_DIR/scripts/h3.py capabilities
python3 SKILL_DIR/scripts/h3.py generate --prompt '日落时分的海岸，镜头缓慢推进，浪声轻柔。' --duration 6
python3 SKILL_DIR/scripts/h3.py generate --prompt '保持底图人物和场景，人物抬头微笑，镜头缓慢推进。' --first-frame /path/start.png
python3 SKILL_DIR/scripts/h3.py generate --prompt '平滑运镜连接起始和结束画面。' --first-frame /path/start.png --last-frame /path/end.png
python3 SKILL_DIR/scripts/h3.py generate --mode reference --prompt '使用 <Image 1> 的人物和 <Image 2> 的场景，人物向镜头走来。' --reference /path/person.png --reference /path/scene.jpg
python3 SKILL_DIR/scripts/h3.py generate --mode reference --prompt-file /path/prompt.txt --reference /path/person.png --reference /path/motion.mp4 --reference /path/voice.wav
python3 SKILL_DIR/scripts/h3.py status JOB_ID
python3 SKILL_DIR/scripts/h3.py list
python3 SKILL_DIR/scripts/h3.py download JOB_ID --output /path/result.mp4
python3 SKILL_DIR/scripts/h3.py download JOB_ID --frame last --output /path/continuation.jpg
python3 SKILL_DIR/scripts/h3.py cancel JOB_ID
```

上传请求允许最多 10 分钟等待响应；弱网大图可能先花时间上传。生成默认异步返回任务 ID。记录 ID，再轮询 `status`，直到 `completed`、`failed` 或 `cancelled`。长任务可用 `generate ... --wait --output /path/result.mp4`；默认等待上限 4 小时。等待超时或客户端断线不等于任务失败，先查原 ID，避免重复提交。服务器串行排队，模型切换可能需数分钟；取消仅支持尚未开始的任务。

## 模式选择

- **文生视频**：不上传文件，`--mode text` 或默认自动选择。
- **图片作为底图 / 图生视频**：`--first-frame` 将图片固定为首帧；`--last-frame` 控制尾帧；可以只提供尾帧，也可以同时给首尾帧。画面比例跟随底图。
- **角色、产品、风格、场景、动作或音色参考**：`--mode reference` 加可重复的 `--reference`，使用 Ref2VA。参考图片不自动固定为首帧。不要把全参考与首尾帧混在一个请求。
- **续写作品**：下载生成结果的 last frame，再作为下一次任务的 first frame。说明这是以尾帧续写，不承诺整个视频的长期角色一致性。

先查 health 的 `models` 字段和 capabilities 的模式、限制及 profile。`downloaded` 为真即可提交对应模型任务，即使 `online` 暂为假，服务也会自动加载。若模型未下载好，说明真实状态，不把示例视频当作本次结果。

## 输入和输出限制

目标时长 4–15 秒（内部帧对齐可能略长，实际规格见任务 output 字段）、短边 768p、24 FPS、32 kHz 立体声音频。参数：`--duration`、`--ratio`（21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16）、`--steps 5..50`、`--seed 0..2147483647`、`--quality high|lossless`；默认 6 秒、seed 42；steps、quality、flow shift 不传时使用服务当前 profile（2026-09-30 为 turbo8：8 步、视频 flow shift 6、音频 3、lossless）。不要给 turbo 模型套用旧 30 步/shift 12 默认值。`high` 使用模型缓存优化，`lossless` 使用完整计算，不是视频编码的“无损压缩”。

图片 JPEG/PNG/WebP，每张 ≤10MB，边长 256–5760，宽高比 0.4–2.5。全参考最多 9 张图、3 段视频、3 段音频，总计 ≤12 个；视频/音频每段 2–15 秒，同类总长 ≤15 秒，每文件 ≤100MB。音频必须和图片或视频一起提供。单次上传请求合计最多 320MB。素材按各类型上传顺序编号：`<Image 1>`、`<Video 1>` 等。有声视频的内嵌音轨先占用 `<Audio N>`，独立音频从其后继续编号；不确定时用 ffprobe 检查视频是否有音轨。

提示词与原创示例见 [写作指南](references/prompt-writing.md)。客户端遵循环境中的 HTTP(S) 代理，映芽沙箱必须保留其网关代理；不要关闭代理或尝试连接宿主机回环地址。映芽任务只查询已记录的本项目任务 ID，不调用共享服务的 `list`。

官方 Context-IR 和 H3-Regenerate-2K 未开源；该服务不提供这两个云端模块，不声称能本地生成原生 2K。

## HTTP 接口

`POST /api/jobs` 支持 JSON（无素材）或 multipart。multipart 字段：`config`（JSON 字符串）、`first_frame`、`last_frame`、可重复的 `references`。config 字段与客户端对应：`prompt, mode, duration, aspect_ratio, steps, seed, quality, flow_shift, audio_flow_shift`。

`GET /api/health`、`GET /api/capabilities`、`GET /api/jobs`、`GET /api/jobs/{id}`、`GET /api/jobs/{id}/video`、`GET /api/jobs/{id}/frame/first|last`、`POST /api/jobs/{id}/cancel`。视频链接为相对路径，要拼接服务根地址。只在任务完成后报告生成成功，给出可访问的视频链接或下载文件。
